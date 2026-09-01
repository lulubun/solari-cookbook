/**
 * One persona, one cloud browser, start to finish.
 *
 * Notable Solari details encoded here:
 *   - `proxy` and `captcha` both REQUIRE `stealth: true`. A proxied request
 *     from an obviously-automated browser is the pairing that gets blocked, so
 *     the two travel together or not at all.
 *   - `browser.close()` releases the session. The replay only exists AFTER
 *     that release, and lands a second or three later — hence the poll.
 *   - Recording is per session, not per account: without `recording: true` at
 *     launch, the replay endpoint 404s forever.
 *
 * The live thumbnail comes from CDP's screencast rather than repeated
 * `page.screenshot()` calls — the browser pushes frames as they change
 * instead of us paying a round trip per frame, which matters when twenty of
 * these run at once.
 */

import { gunzipSync } from "node:zlib"
import type Anthropic from "@anthropic-ai/sdk"
import type { Solari } from "@solarisdk/browser"
import type { Persona } from "../personas.js"
import type { PersonaResult, Emit } from "./types.js"
import type { SiteType } from "../site-types.js"
import { needsStealth } from "../personas.js"
import { runPersonaLoop } from "../agent/loop.js"
import { TokenMeter } from "../agent/llm.js"
import { USER_AGENT_TOKEN } from "../safety.js"
import { annotateReplay, storeReplay } from "../replay-cache.js"

const FRAME_INTERVAL_MS = 700

export interface PersonaRunOptions {
  solari: Solari
  anthropic: Anthropic
  model: string
  persona: Persona
  target: string
  objective: string
  site: SiteType
  maxSteps: number
  timeoutMs: number
  meter: TokenMeter
  emit: Emit
  signal: AbortSignal
}

export async function runPersona(opts: PersonaRunOptions): Promise<PersonaResult> {
  const { persona, emit, solari, signal } = opts
  const started = Date.now()
  const deadline = started + opts.timeoutMs

  emit({ type: "persona:started", personaId: persona.id })

  const stealth = needsStealth(persona)
  let browser: Awaited<ReturnType<Solari["launch"]>> | null = null
  let sessionId: string | undefined

  try {
    browser = await solari.launch({
      recording: true,
      stealth,
      // Proxy requires stealth; only the geo personas pay for it.
      ...(persona.proxyCountry ? { proxy: { country: persona.proxyCountry } } : {}),
      retries: 1,
    })
    sessionId = browser.id

    const context = await browser.newContext({
      viewport: { width: persona.device.width, height: persona.device.height },
      deviceScaleFactor: persona.device.deviceScaleFactor ?? 1,
      isMobile: persona.device.isMobile,
      hasTouch: persona.device.isMobile,
      locale: persona.locale,
      // Line Intl/Date up with the egress country when we have one.
      ...(browser.proxy?.timezoneId ? { timezoneId: browser.proxy.timezoneId } : {}),
      extraHTTPHeaders: { "x-automated-by": USER_AGENT_TOKEN },
    })

    const page = await context.newPage()

    // Live thumbnail. Best-effort: if screencast is unavailable the run still
    // works, it just isn't watchable.
    let lastFrame = 0
    try {
      const cdp = await context.newCDPSession(page)
      cdp.on("Page.screencastFrame", (frame: { data: string; sessionId: number }) => {
        void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {})
        const now = Date.now()
        if (now - lastFrame < FRAME_INTERVAL_MS) return
        lastFrame = now
        emit({ type: "persona:frame", personaId: persona.id, jpegBase64: frame.data })
      })
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 45,
        maxWidth: 400,
        maxHeight: 260,
        everyNthFrame: 2,
      })
    } catch {
      // No live view for this persona; carry on.
    }

    const stepLog: Array<{ n: number; action: string; atMs: number }> = []
    const visitStart = Date.now()

    await page.goto(opts.target, { waitUntil: "domcontentloaded", timeout: 30_000 })

    const { verdict, steps } = await runPersonaLoop(page, {
      client: opts.anthropic,
      model: opts.model,
      persona,
      objective: opts.objective,
      target: opts.target,
      site: opts.site,
      maxSteps: opts.maxSteps,
      deadline,
      meter: opts.meter,
      signal,
      onStep: (step, thought, action) => {
        stepLog.push({ n: step, action, atMs: Date.now() - visitStart })
        emit({ type: "persona:step", personaId: persona.id, step, thought, action })
      },
    })

    // Release before asking for the replay — the recording is only finalised
    // once the session is released.
    await browser.close()
    browser = null

    const replayUrl = sessionId ? await captureReplay(solari, sessionId) : undefined
    if (sessionId && replayUrl) {
      annotateReplay(sessionId, {
        personaName: persona.name,
        emoji: persona.emoji,
        mission: persona.mission,
        quote: verdict.quote,
        stoppedAt: verdict.stoppedAt,
        completed: verdict.completed,
        steps: stepLog,
      })
    }

    const result: PersonaResult = {
      persona,
      verdict,
      steps,
      durationMs: Date.now() - started,
      ...(replayUrl ? { replayUrl } : {}),
    }
    emit({ type: "persona:done", personaId: persona.id, result })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const result: PersonaResult = {
      persona,
      verdict: {
        completed: false,
        stoppedAt: "never got started",
        quote: "I couldn't even get the page to load.",
        frictions: [{ kind: "performance", detail: message.slice(0, 200), severity: "blocker" }],
      },
      steps: 0,
      durationMs: Date.now() - started,
      error: message,
    }
    emit({ type: "persona:done", personaId: persona.id, result })
    return result
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

/**
 * Pull the replay down and keep it, returning a URL to our own player.
 *
 * The replay lands a beat after release, so this polls. We download the
 * NDJSON rather than handing out Solari's presigned link because that link
 * serves a gzipped file with download headers — the browser saves a
 * `.ndjson.gz` nobody can open instead of playing it.
 */
async function captureReplay(solari: Solari, sessionId: string): Promise<string | undefined> {
  let lastError = "never became available"
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1200))
    try {
      const bytes = await solari.sessions.downloadReplay(sessionId)
      if (!bytes || bytes.length === 0) {
        lastError = "empty response"
        continue
      }
      const text = decodeReplay(bytes)
      if (!text.trim()) {
        lastError = "decoded to nothing"
        continue
      }
      if (storeReplay(sessionId, text)) {
        return `/replay/${encodeURIComponent(sessionId)}`
      }
      lastError = "too large to cache"
      return undefined
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  // A missing replay is not worth failing a visit over, but silently dropping
  // it means never finding out why the button is missing.
  console.warn(`replay unavailable for ${sessionId.slice(-12)}: ${lastError}`)
  return undefined
}

/** The endpoint may hand back gzip or plain NDJSON depending on the path. */
function decodeReplay(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes)
  // gzip magic
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return gunzipSync(buf).toString("utf8")
    } catch {
      return ""
    }
  }
  return buf.toString("utf8")
}
