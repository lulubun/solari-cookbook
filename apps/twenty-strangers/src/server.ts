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
import { SITE_TYPES, siteTypeById } from "./site-types.js"
import { RunQueue } from "./queue.js"
import { SlidingWindow } from "./ratelimit.js"
import { validateTarget, robotsAllows, UnsafeTargetError } from "./safety.js"
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
  res.json(
    rosterFor(international).map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      blurb: p.blurb,
      device: p.device,
      locale: p.locale,
      proxyCountry: p.proxyCountry,
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
  const ndjson = getReplay(req.params.sessionId)
  if (!ndjson) {
    res.status(404).json({ error: "No replay held for that session." })
    return
  }
  const events: unknown[] = []
  for (const line of ndjson.split("\n")) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A truncated trailing line is normal; skip it.
    }
  }
  res.json(events)
})

/** The player page itself. The id lives in the path, read by the client. */
app.get("/replay/:sessionId", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "replay.html"))
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
  })
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: "/ws" })

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
      if (runId) return send({ type: "fatal", message: "A run is already in progress on this connection." })

      // --- validate the target -------------------------------------------
      let target: Awaited<ReturnType<typeof validateTarget>>
      try {
        target = await validateTarget(msg.target ?? "")
      } catch (err) {
        return send({
          type: "fatal",
          message: err instanceof UnsafeTargetError ? err.message : "Could not check that URL.",
        })
      }

      // Both are required. Without an objective the personas wander and the
      // report is mush; without a site type they judge a florist by SaaS
      // standards. Enforced here rather than trusted to the form.
      const objective = (msg.objective ?? "").trim()
      if (objective.length < 3) {
        return send({
          type: "fatal",
          message: "Tell the strangers what they should be trying to do — that's what makes the report useful.",
        })
      }
      const site = siteTypeById(String(msg.siteType ?? ""))
      if (!site) {
        return send({ type: "fatal", message: "Pick what kind of site this is." })
      }

      const robots = await robotsAllows(target)
      if (!robots.allowed) {
        return send({ type: "fatal", message: robots.reason ?? "robots.txt disallows automated visits." })
      }

      // --- credentials: bring-your-own, or the house ----------------------
      const byo = Boolean(msg.solariApiKey && msg.anthropicApiKey)
      let creds: Credentials | null
      if (byo) {
        creds = {
          solariApiKey: String(msg.solariApiKey),
          anthropicApiKey: String(msg.anthropicApiKey),
          bringYourOwn: true,
        }
      } else {
        creds = houseCredentials()
        if (!creds) {
          return send({
            type: "fatal",
            message:
              "The demo has no keys configured. Add your own Solari and Anthropic keys to run a swarm.",
          })
        }
      }

      // --- budget guards (house-funded runs only) -------------------------
      if (!creds.bringYourOwn && !config.mock) {
        const reason =
          global.check("global") ??
          perIp.check(ip) ??
          perTarget.check(target.hostname)
        if (reason) return send({ type: "fatal", message: reason })
        if (queue.isFull) {
          return send({
            type: "fatal",
            message: "The queue is full right now. Try again shortly, or run it with your own keys.",
          })
        }
      }

      if (creds.bringYourOwn && byoActive >= BYO_CEILING) {
        return send({ type: "fatal", message: "Too many self-funded runs in flight. Try again in a minute." })
      }

      // --- go --------------------------------------------------------------
      runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      controller = new AbortController()

      const swarmSize = Math.min(
        Math.max(1, Number(msg.swarmSize) || config.swarm.size),
        PERSONAS.length,
      )
      const request = {
        target: target.url,
        objective: objective.slice(0, 300),
        siteType: site.id,
        international: msg.international !== false,
        swarmSize,
      }
      const mode = config.mock ? mockMode(runId) : swarmMode(creds, runId)

      if (!creds.bringYourOwn && !config.mock) {
        global.record("global")
        perIp.record(ip)
        perTarget.record(target.hostname)
      }

      // Whole-run watchdog, independent of anything the engine does.
      const watchdog = setTimeout(() => controller?.abort(), config.swarm.runTimeoutMs)

      try {
        if (creds.bringYourOwn) {
          byoActive++
          await mode.run(request, send, controller.signal)
        } else {
          await queue.enqueue(runId, request, mode, send, controller)
        }
      } catch (err) {
        send({
          type: "fatal",
          message: err instanceof Error ? err.message : "The run failed.",
        })
      } finally {
        clearTimeout(watchdog)
        if (creds.bringYourOwn) byoActive--
        runId = null
        controller = null
      }
    })()
  })

  ws.on("close", () => {
    // A visitor who closes the tab should not keep twenty browsers running.
    if (runId) queue.cancel(runId)
    controller?.abort()
  })
})

server.listen(config.port, () => {
  const mode = config.mock ? "MOCK (no keys, no spend)" : "live"
  console.log(`Twenty Strangers listening on :${config.port} — ${mode}`)
  if (!config.mock && !houseCredentials()) {
    console.log("No house keys set; visitors must bring their own.")
  }
})
