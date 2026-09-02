/**
 * Plays back a real recorded run as the sample.
 *
 * The sample used to be invented. This is a recording of an actual twenty-
 * persona run against an actual site, so the findings are real, the thumbnails
 * are pages the personas genuinely saw, and nothing has to be described as
 * fabricated because nothing is.
 *
 * Played back at a modest speed-up so nobody has to wait the full minute and a
 * half to see what the thing does. The report still carries the true duration,
 * so the number anyone reads is the real one.
 *
 * Only the one session replay that ships with the recording keeps its link —
 * the rest are dropped rather than left pointing at replays this process never
 * held, which would 404.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Emit, RunEvent, RunMode, RunReport, RunRequest } from "./engine/types.js"
import { storeReplay } from "./replay-cache.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface RecordedEvent {
  atMs: number
  event: RunEvent
}

interface Recording {
  recordedAt: string
  target: string
  siteType: string
  objective: string
  events: RecordedEvent[]
  replay: { sessionId: string; ndjson: string; personaName: string } | null
}

/**
 * Playback is compressed to roughly this long, whatever the recording took.
 *
 * Real runs vary a lot — the same site recorded twice took 42s and 160s — and
 * a demo that sometimes runs for nearly three minutes is a demo nobody
 * finishes. Deriving the rate from the recording keeps the sample watchable
 * without anyone having to remember to retune it after re-recording.
 *
 * The report still carries the true elapsed time, so every number a visitor
 * reads is the measured one.
 */
const TARGET_PLAYBACK_MS = 45_000
const MIN_SPEED = 1
const MAX_SPEED = 5

let cached: Recording | null = null

function load(): Recording | null {
  if (cached) return cached
  try {
    const raw = readFileSync(path.join(__dirname, "sample-run.json"), "utf8")
    cached = JSON.parse(raw) as Recording
    // Make the one shipped replay servable at its original URL.
    if (cached.replay) {
      storeReplay(cached.replay.sessionId, cached.replay.ndjson, {
        personaName: cached.replay.personaName,
        emoji: "🎬",
        mission: "Recorded during the sample run.",
        quote: "",
        stoppedAt: "",
        completed: true,
        steps: [],
      })
    }
    return cached
  } catch {
    return null
  }
}

export function sampleAvailable(): boolean {
  return load() !== null
}

export function sampleMeta(): { target: string; recordedAt: string } | null {
  const rec = load()
  return rec ? { target: rec.target, recordedAt: rec.recordedAt } : null
}

/** Which session replay, if any, the sample can actually serve. */
function keptReplaySessionId(rec: Recording): string | null {
  return rec.replay?.sessionId ?? null
}

export function sampleMode(): RunMode {
  return {
    name: "sample",
    async run(_req: RunRequest, emit: Emit, signal: AbortSignal): Promise<RunReport> {
      const rec = load()
      if (!rec) throw new Error("No sample recording is available on this instance.")

      const keepId = keptReplaySessionId(rec)
      const start = Date.now()
      let report: RunReport | null = null

      const recordedMs = rec.events[rec.events.length - 1]?.atMs ?? 0
      const speed = Math.min(
        MAX_SPEED,
        Math.max(MIN_SPEED, recordedMs / TARGET_PLAYBACK_MS),
      )

      for (const { atMs, event } of rec.events) {
        if (signal.aborted) break

        const due = atMs / speed
        const wait = due - (Date.now() - start)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        if (signal.aborted) break

        emit(markSample(event, keepId))
        if (event.type === "run:done") report = event.report
      }

      if (!report) throw new Error("The sample recording is incomplete.")
      return { ...report, isSample: true }
    },
  }
}

/**
 * Flag every event as a sample, and drop replay links this process cannot
 * serve. A dead "watch the replay" link in the sample would read as a broken
 * feature rather than a recording that only kept one.
 */
function markSample(event: RunEvent, keepReplayId: string | null): RunEvent {
  if (event.type === "run:started") return { ...event, isSample: true }

  if (event.type === "persona:done") {
    const url = event.result.replayUrl
    const keep =
      url && keepReplayId && decodeURIComponent(url.replace("/replay/", "")) === keepReplayId
    const result = { ...event.result }
    if (!keep) delete result.replayUrl
    return { ...event, result }
  }

  if (event.type === "run:done") {
    const results = event.report.results.map((r) => {
      const url = r.replayUrl
      const keep =
        url && keepReplayId && decodeURIComponent(url.replace("/replay/", "")) === keepReplayId
      if (keep) return r
      const copy = { ...r }
      delete copy.replayUrl
      return copy
    })
    return { ...event, report: { ...event.report, results, isSample: true } }
  }

  return event
}
