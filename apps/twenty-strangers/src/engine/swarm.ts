/**
 * Swarm mode: twenty personas, one site, all at once.
 *
 * The fan-out is the product. Twenty concurrent browsers is the entire
 * Starter-plan quota, so this deliberately runs at the ceiling and treats
 * `ConcurrencyLimitExceeded` as an expected condition rather than a crash: a
 * persona that cannot get a slot waits and retries instead of failing the run.
 *
 * Agent Arena, when it lands, is a sibling of this file — same fan-out, same
 * event stream, different scoring — which is why `RunMode` exists.
 */

import { setMaxListeners } from "node:events"
import { Solari, SolariError } from "@solarisdk/browser"
import type { Emit, RunMode, RunReport, RunRequest, PersonaResult } from "./types.js"
import type { Credentials } from "../config.js"
import { config } from "../config.js"
import { pickSwarm } from "../personas.js"
import { runPersona } from "./persona-run.js"
import { TokenMeter, makeClient } from "../agent/llm.js"
import { buildThemes, completionRate, erroredCount } from "../report/aggregate.js"

export function swarmMode(creds: Credentials, runId: string): RunMode {
  return {
    name: "swarm",
    async run(req: RunRequest, emit: Emit, signal: AbortSignal): Promise<RunReport> {
      const personas = pickSwarm(req.swarmSize)

      // Twenty personas each hold one in-flight model request against this
      // single signal, so twenty concurrent abort listeners is correct rather
      // than a leak — but it trips Node's default warning at ten. Raise the
      // ceiling on this signal only.
      setMaxListeners(0, signal)

      const startedAt = new Date().toISOString()
      const t0 = Date.now()

      emit({
        type: "run:started",
        runId,
        target: req.target,
        objective: req.objective,
        personas,
      })

      const solari = new Solari({ apiKey: creds.solariApiKey })
      const anthropic = makeClient(creds.anthropicApiKey, config.anthropicWorkspaceId)
      const meter = new TokenMeter()

      // One slot per allowed concurrent browser. Personas take a slot, run,
      // and hand it back — so a swarm larger than the plan ceiling still works,
      // it just runs in waves.
      const ceiling = Math.min(config.swarm.maxConcurrentBrowsers, personas.length)
      let cursor = 0
      const results: PersonaResult[] = []

      const worker = async (): Promise<void> => {
        for (;;) {
          if (signal.aborted) return
          const index = cursor++
          const persona = personas[index]
          if (!persona) return

          const result = await withConcurrencyRetry(signal, () =>
            runPersona({
              solari,
              anthropic,
              model: config.browseModel,
              persona,
              target: req.target,
              objective: req.objective,
              maxSteps: config.swarm.maxStepsPerPersona,
              timeoutMs: config.swarm.personaTimeoutMs,
              meter,
              emit,
              signal,
            }),
          )
          results.push(result)
        }
      }

      try {
        await Promise.all(Array.from({ length: ceiling }, () => worker()))
      } finally {
        // Required: the client holds a loopback proxy open for the retry path,
        // and that handle keeps the event loop alive.
        await solari.close().catch(() => {})
      }

      // Restore the authored order so the report reads like the persona list
      // rather than whichever browser happened to finish first.
      results.sort(
        (a, b) =>
          personas.findIndex((p) => p.id === a.persona.id) -
          personas.findIndex((p) => p.id === b.persona.id),
      )

      const durationMs = Date.now() - t0
      const browserHours = results.reduce((s, r) => s + r.durationMs / 3_600_000, 0)

      const report: RunReport = {
        runId,
        target: req.target,
        objective: req.objective,
        startedAt,
        durationMs,
        completionRate: completionRate(results),
        errored: erroredCount(results),
        results,
        themes: buildThemes(results),
        cost: {
          browserHours,
          estimatedUsd:
            browserHours * config.pricing.browserUsdPerHour + meter.estimateUsd(),
        },
      }

      emit({ type: "run:done", report })
      return report
    },
  }
}

/**
 * A busy plan is a normal Tuesday, not an error. Back off and try again rather
 * than dropping the persona from the swarm.
 */
async function withConcurrencyRetry<T>(
  signal: AbortSignal,
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    if (signal.aborted) throw new Error("cancelled")
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const code = err instanceof SolariError ? err.code : undefined
      if (code !== "ConcurrencyLimitExceeded") throw err
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
    }
  }
  throw lastErr
}
