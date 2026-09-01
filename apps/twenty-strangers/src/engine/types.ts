/**
 * The wire model.
 *
 * Everything the server knows about a run reaches the browser as one of these
 * events, in order. The UI is a pure function of the event stream, which means
 * a run can be recorded to a file and replayed into the same UI later — that
 * is how mock mode and the shareable "watch this run again" view both work.
 */

import type { Persona } from "../personas.js"

export type FrictionKind =
  | "findability"   // the thing exists but could not be found
  | "clarity"       // the words did not explain the thing
  | "layout"        // it rendered wrong at this size
  | "access"        // could not be operated (keyboard, contrast, tap target)
  | "consent"       // cookie / GDPR obstruction
  | "dead-end"      // a route that went nowhere
  | "trust"         // missing proof, policy, or credibility signal
  | "performance"   // too slow, or never rendered

export interface Friction {
  kind: FrictionKind
  /** One sentence, in the persona's voice. */
  detail: string
  severity: "blocker" | "major" | "minor"
}

export interface Verdict {
  /** Did they achieve their mission? */
  completed: boolean
  /** Where they stopped, in their own words. */
  stoppedAt: string
  /** The one quotable line. This is what people screenshot. */
  quote: string
  frictions: Friction[]
}

export interface PersonaResult {
  persona: Persona
  verdict: Verdict
  steps: number
  durationMs: number
  /** Solari session replay, available a beat after the session is released. */
  replayUrl?: string
  /** Present when the persona crashed rather than gave up. */
  error?: string
}

export interface RunReport {
  runId: string
  target: string
  objective: string
  siteType: string
  international: boolean
  startedAt: string
  durationMs: number
  /** Share of personas that ACTUALLY VISITED and got what they came for.
   *  Personas whose browser or model call failed are excluded from the
   *  denominator — an infrastructure failure is not a finding about the site. */
  completionRate: number
  /** Personas that never got to judge the site. Reported, never counted. */
  errored: number
  results: PersonaResult[]
  /** Frictions clustered across personas — the actually actionable output. */
  themes: Array<{
    kind: FrictionKind
    severity: Friction["severity"]
    headline: string
    raisedBy: string[]
  }>
  cost: {
    browserHours: number
    estimatedUsd: number
  }
}

export type RunEvent =
  | { type: "run:queued"; runId: string; position: number; etaSeconds: number }
  | {
      type: "run:started"
      runId: string
      target: string
      objective: string
      siteType: string
      personas: Persona[]
    }
  | { type: "persona:started"; personaId: string }
  | { type: "persona:frame"; personaId: string; jpegBase64: string }
  | { type: "persona:step"; personaId: string; step: number; thought: string; action: string }
  | { type: "persona:done"; personaId: string; result: PersonaResult }
  | { type: "run:done"; report: RunReport }
  | { type: "run:error"; message: string }

export type Emit = (e: RunEvent) => void

export interface RunRequest {
  target: string
  /** Required. Without it the personas wander; with it they have a job. */
  objective: string
  /** Required. Id from SITE_TYPES — decides how every persona behaves. */
  siteType: string
  /** Send the three visitors from abroad, or swap in domestic alternates. */
  international: boolean
  swarmSize: number
}

/**
 * A run mode is the pluggable unit. `swarm` (twenty personas, one site) ships
 * now; `arena` (several models, one task, head to head) reuses the same
 * fan-out, live grid, and event stream with different scoring.
 */
export interface RunMode {
  name: string
  run(req: RunRequest, emit: Emit, signal: AbortSignal): Promise<RunReport>
}
