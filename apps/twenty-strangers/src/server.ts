/**
 * Twenty Strangers — server.
 *
 * A long-lived Node process: a swarm holds twenty browsers open for a couple
 * of minutes and streams frames the whole time, which is the exact shape
 * serverless is worst at. Express serves the page, one websocket per visitor
 * carries the run.
 */

import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import { WebSocketServer, type WebSocket } from "ws"

import { config, houseCredentials, type Credentials } from "./config.js"
import { PERSONAS, DOMESTIC_ALTERNATES, rosterFor } from "./personas.js"
import { RATIONALE } from "./persona-rationale.js"
import { SITE_TYPES, siteTypeById } from "./site-types.js"
import { RunQueue } from "./queue.js"
import { SlidingWindow } from "./ratelimit.js"
import { validateTarget, robotsAllows, UnsafeTargetError } from "./safety.js"
import { createAccessCodeStore } from "./access-codes.js"
import { Billing } from "./billing.js"
import { getReplay, replayStats } from "./replay-cache.js"
import { swarmMode } from "./engine/swarm.js"
import { mockMode } from "./engine/mock.js"
import type { RunEvent } from "./engine/types.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json({ limit: "64kb" }))
// Cache hard in production, not at all in development — a stale app.js after
// an edit costs more time than the bytes ever save.
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    etag: true,
  }),
)

app.get("/api/personas", (req, res) => {
  // `?international=0` shows the roster a domestic run would actually use.
  const international = req.query.international !== "0"
  const site = siteTypeById(String(req.query.siteType ?? ""))
  res.json(
    rosterFor(international, site).map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      blurb: p.blurb,
      device: p.device,
      locale: p.locale,
      proxyCountry: p.proxyCountry,
      patience: p.patience,
      rationale: RATIONALE[p.id] ?? null,
      // Which kinds of site this person turns up on at all. Answers the
      // obvious follow-up to "why are they here" — "and when are they not".
      appearsOn: SITE_TYPES.filter((t) =>
        rosterFor(international, t).some((q) => q.id === p.id),
      ).map((t) => t.label),
    })),
  )
})

/**
 * The captured rrweb events for one session, as JSON the player can consume.
 *
 * Only sessions this process actually ran are in the cache, so there is
 * nothing to enumerate — an unknown id is simply a miss.
 */
app.get("/api/replay/:sessionId", (req, res) => {
  const held = getReplay(req.params.sessionId)
  if (!held) {
    res.status(404).json({ error: "No replay held for that session." })
    return
  }
  const events: unknown[] = []
  for (const line of held.ndjson.split("\n")) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A truncated trailing line is normal; skip it.
    }
  }
  res.json({ events, meta: held.meta ?? null })
})

/** The player page itself. The id lives in the path, read by the client. */
app.get("/replay/:sessionId", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "replay.html"))
})

app.get("/api/pricing", (_req, res) => {
  res.json({
    /** When false, house runs are free and rate-limited (no Stripe key set). */
    paymentRequired: billing !== null,
    priceUsd: billing?.priceUsd ?? 0,
    accessCodesEnabled: config.access.codes.length > 0,
  })
})

/**
 * Start a purchase. The target is validated BEFORE Stripe is involved, so a
 * typo'd URL never reaches a card form.
 */
app.post("/api/checkout", (req, res) => {
  void (async () => {
    if (!billing) {
      res.status(400).json({ error: "Payments are not enabled on this instance." })
      return
    }
    const body = req.body as Partial<StartMessage>

    let target: Awaited<ReturnType<typeof validateTarget>>
    try {
      target = await validateTarget(String(body.target ?? ""))
    } catch (err) {
      res.status(400).json({
        error: err instanceof UnsafeTargetError ? err.message : "Could not check that URL.",
      })
      return
    }

    const robots = await robotsAllows(target)
    if (!robots.allowed) {
      res.status(400).json({ error: robots.reason ?? "robots.txt disallows automated visits." })
      return
    }

    const objective = String(body.objective ?? "").trim()
    if (objective.length < 3) {
      res.status(400).json({ error: "Tell the strangers what they should be trying to do." })
      return
    }
    const site = siteTypeById(String(body.siteType ?? ""))
    if (!site) {
      res.status(400).json({ error: "Pick what kind of site this is." })
      return
    }

    try {
      const { url } = await billing.createCheckout({
        target: target.url,
        objective: objective.slice(0, 300),
        siteType: site.id,
        international: body.international !== false,
        swarmSize: config.swarm.size,
      })
      res.json({ url })
    } catch (err) {
      console.error("checkout failed:", err)
      res.status(502).json({ error: "Couldn't reach the payment provider. Nothing was charged." })
    }
  })()
})

app.get("/api/site-types", (_req, res) => {
  res.json(SITE_TYPES.map((t) => ({ id: t.id, label: t.label, family: t.family })))
})

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mock: config.mock,
    housekeys: houseCredentials() !== null,
    queueDepth: queue.depth,
    replays: replayStats(),
    paymentRequired: billing !== null,
    accessCodes: accessCodes.stats(),
  })
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: "/ws" })

/**
 * Billing is optional. With no Stripe key the app behaves exactly as it did
 * before — free, rate-limited house runs — so the whole thing still works for
 * local development and for anyone self-hosting it.
 */
const billing =
  config.billing.stripeSecretKey && config.billing.publicBaseUrl
    ? new Billing({
        secretKey: config.billing.stripeSecretKey,
        priceUsd: config.billing.runPriceUsd,
        publicBaseUrl: config.billing.publicBaseUrl,
      })
    : null

const accessCodes = createAccessCodeStore(config.access.codes, config.access.stateDir)

/** A code is a bearer credential, so guessing at it gets throttled. */
const codeAttempts = new SlidingWindow(12, 60 * 60 * 1000)

const queue = new RunQueue(config.limits.maxQueueDepth)
const perIp = new SlidingWindow(config.limits.runsPerIpPerDay)
const perTarget = new SlidingWindow(config.limits.runsPerTargetPerDay)
const global = new SlidingWindow(config.limits.runsPerDay)
setInterval(() => {
  perIp.sweep()
  perTarget.sweep()
  global.sweep()
}, 60 * 60 * 1000).unref()

/** Bounded lane for visitors spending their own credits. */
let byoActive = 0
const BYO_CEILING = 3

interface StartMessage {
  type: "start"
  target?: string
  objective?: string
  siteType?: string
  international?: boolean
  swarmSize?: number
  /** Stripe Checkout Session id, for a run that has been paid for. */
  paymentSessionId?: string
  /** Single-use code granting one free run on the house keys. */
  accessCode?: string
  solariApiKey?: string
  anthropicApiKey?: string
}

interface CancelMessage {
  type: "cancel"
}

type ClientMessage = StartMessage | CancelMessage

wss.on("connection", (ws: WebSocket, req) => {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"

  let controller: AbortController | null = null
  let runId: string | null = null

  const send = (e: RunEvent | { type: "fatal"; message: string }): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e))
  }

  ws.on("message", (raw) => {
    void (async () => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw)) as ClientMessage
      } catch {
        return send({ type: "fatal", message: "Malformed message." })
      }

      if (msg.type === "cancel") {
        if (runId) queue.cancel(runId)
        controller?.abort()
        return
      }
      if (msg.type !== "start") return
      if (runId) {
        return send({ type: "fatal", message: "A run is already in progress on this connection." })
      }

      const byo = Boolean(msg.solariApiKey && msg.anthropicApiKey)
      const paymentSessionId = msg.paymentSessionId ? String(msg.paymentSessionId) : ""
      const accessCode = msg.accessCode ? String(msg.accessCode).trim() : ""

      let creds: Credentials | null = null
      let request: { target: string; objective: string; siteType: string; international: boolean; swarmSize: number } | null = null
      let paymentIntentId: string | null = null
      let reservedCode: string | null = null
      let rateLimited = true

      if (paymentSessionId && billing) {
        // --- paid run ------------------------------------------------------
        // Everything about the run comes from Stripe's metadata, never from
        // this message. Otherwise a visitor could pay to test their own site
        // and then point the swarm at someone else's.
        const redeemed = await billing.redeem(paymentSessionId)
        if (!redeemed.ok) return send({ type: "fatal", message: redeemed.reason })

        creds = houseCredentials()
        if (!creds) {
          return send({
            type: "fatal",
            message: "This instance has no API keys configured, so paid runs can't run. You have not been charged.",
          })
        }
        request = redeemed.request
        paymentIntentId = redeemed.paymentIntentId
        rateLimited = false // They paid. The payment is the limit.
      } else {
        // --- free run: own keys, or a house instance with billing off -------
        let target: Awaited<ReturnType<typeof validateTarget>>
        try {
          target = await validateTarget(msg.target ?? "")
        } catch (err) {
          return send({
            type: "fatal",
            message: err instanceof UnsafeTargetError ? err.message : "Could not check that URL.",
          })
        }

        const robots = await robotsAllows(target)
        if (!robots.allowed) {
          return send({ type: "fatal", message: robots.reason ?? "robots.txt disallows automated visits." })
        }

        const objective = (msg.objective ?? "").trim()
        if (objective.length < 3) {
          return send({
            type: "fatal",
            message: "Tell the strangers what they should be trying to do — that's what makes the report useful.",
          })
        }
        const site = siteTypeById(String(msg.siteType ?? ""))
        if (!site) return send({ type: "fatal", message: "Pick what kind of site this is." })

        if (accessCode) {
          // A code buys one run on the house keys. The holder never sees them.
          const throttle = codeAttempts.check(ip)
          if (throttle) {
            return send({ type: "fatal", message: "Too many code attempts. Try again later." })
          }
          const verdict = accessCodes.check(accessCode)
          if (!verdict.ok) {
            codeAttempts.record(ip)
            return send({ type: "fatal", message: verdict.reason })
          }
          if (!accessCodes.reserve(accessCode)) {
            return send({ type: "fatal", message: "That code was just used. Each code is good for one run." })
          }
          reservedCode = accessCode

          creds = houseCredentials()
          if (!creds) {
            accessCodes.release(accessCode)
            return send({
              type: "fatal",
              message: "This instance has no API keys configured, so codes can't be redeemed. Your code has not been used.",
            })
          }
          rateLimited = false // The code is the authorisation.
        } else if (byo) {
          creds = {
            solariApiKey: String(msg.solariApiKey),
            anthropicApiKey: String(msg.anthropicApiKey),
            bringYourOwn: true,
          }
          rateLimited = false // Their keys, their spend.
        } else if (billing) {
          return send({
            type: "fatal",
            message: "This run needs to be paid for, or an access code, or your own API keys.",
          })
        } else {
          creds = houseCredentials()
          if (!creds) {
            return send({
              type: "fatal",
              message: "The demo has no keys configured. Add your own Solari and Anthropic keys to run a swarm.",
            })
          }
        }

        request = {
          target: target.url,
          objective: objective.slice(0, 300),
          siteType: site.id,
          international: msg.international !== false,
          swarmSize: Math.min(
            Math.max(1, Number(msg.swarmSize) || config.swarm.size),
            PERSONAS.length,
          ),
        }
      }

      if (!creds || !request) return send({ type: "fatal", message: "Could not start that run." })

      // --- budget guards, for free house-funded runs only -------------------
      const targetHost = hostOfSafe(request.target)
      if (rateLimited && !creds.bringYourOwn && !config.mock) {
        const reason = global.check("global") ?? perIp.check(ip) ?? perTarget.check(targetHost)
        if (reason) return send({ type: "fatal", message: reason })
        if (queue.isFull) {
          return send({
            type: "fatal",
            message: "The queue is full right now. Try again shortly, or run it with your own keys.",
          })
        }
        global.record("global")
        perIp.record(ip)
        perTarget.record(targetHost)
      }

      if (creds.bringYourOwn && byoActive >= BYO_CEILING) {
        return send({ type: "fatal", message: "Too many self-funded runs in flight. Try again in a minute." })
      }

      // --- go ---------------------------------------------------------------
      runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      controller = new AbortController()

      const mode = config.mock ? mockMode(runId) : swarmMode(creds, runId)
      const watchdog = setTimeout(() => controller?.abort(), config.swarm.runTimeoutMs)

      let ranSuccessfully = false
      try {
        if (creds.bringYourOwn) {
          byoActive++
          await mode.run(request, send, controller.signal)
        } else {
          await queue.enqueue(runId, request, mode, send, controller)
        }
        ranSuccessfully = true
      } catch (err) {
        send({ type: "fatal", message: err instanceof Error ? err.message : "The run failed." })
      } finally {
        clearTimeout(watchdog)
        if (creds.bringYourOwn) byoActive--
        runId = null
        controller = null
      }

      // --- settle the code --------------------------------------------------
      // Burn only on success. A code lost to our crash has no refund path, so
      // a failed run hands it back rather than silently consuming it.
      if (reservedCode) {
        if (ranSuccessfully) {
          accessCodes.burn(reservedCode)
        } else {
          accessCodes.release(reservedCode)
          send({ type: "fatal", message: "That run failed, so your code has not been used." })
        }
      }

      // --- settle the money -------------------------------------------------
      // Capture only if the swarm actually delivered. A failed run voids the
      // authorisation, so the visitor is charged nothing and is owed no refund.
      if (paymentIntentId && billing) {
        try {
          if (ranSuccessfully) {
            await billing.capture(paymentIntentId)
          } else {
            await billing.voidAuthorization(paymentIntentId)
            send({ type: "fatal", message: "That run failed, so you have not been charged." })
          }
        } catch (err) {
          console.error("settling payment failed:", err)
        }
      }
    })()
  })

  ws.on("close", () => {
    // A visitor who closes the tab should not keep twenty browsers running.
    if (runId) queue.cancel(runId)
    controller?.abort()
  })
})

function hostOfSafe(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

server.listen(config.port, () => {
  const mode = config.mock ? "MOCK (no keys, no spend)" : "live"
  const pay = billing ? `paid runs at $${billing.priceUsd.toFixed(2)}` : "free runs (no Stripe key)"
  console.log(`Twenty Strangers listening on :${config.port} — ${mode}, ${pay}`)
  if (!config.mock && !houseCredentials()) {
    console.log("No house keys set; visitors must bring their own.")
  }
})
