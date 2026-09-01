/**
 * Mock mode: a full run with no keys, no browsers, and no spend.
 *
 * This exists for three reasons, in order of how much they matter:
 *   1. The UI is the hard part and iterating on it should not cost money.
 *   2. A public demo needs a "show me what this looks like" path for visitors
 *      who arrive when the daily budget is spent.
 *   3. It proves the UI is a pure function of the event stream — the same
 *      events drive a real run and a canned one.
 */

import type { Emit, RunMode, RunReport, RunRequest, PersonaResult, Friction } from "./types.js"
import { pickSwarm } from "../personas.js"
import { siteTypeById } from "../site-types.js"

const SCRIPT: Record<string, { completed: boolean; stoppedAt: string; quote: string; frictions: Friction[] }> = {
  "impatient-mobile": {
    completed: false,
    stoppedAt: "the hero section",
    quote: "Three scrolls in and I still don't know what you sell.",
    frictions: [{ kind: "clarity", detail: "The headline is a slogan, not a description", severity: "major" }],
  },
  "skeptical-cfo": {
    completed: false,
    stoppedAt: "the pricing page",
    quote: "Every tier says 'Contact us'. That's not pricing, that's a phone tree.",
    frictions: [{ kind: "findability", detail: "No actual numbers anywhere on the pricing page", severity: "blocker" }],
  },
  "careful-reader": {
    completed: true,
    stoppedAt: "the product page",
    quote: "I got there eventually, but I had to read four paragraphs to learn what one sentence could have told me.",
    frictions: [{ kind: "clarity", detail: "Value proposition buried below three paragraphs of preamble", severity: "minor" }],
  },
  "german-visitor": {
    completed: false,
    stoppedAt: "the cookie banner",
    quote: "Accepting was one button. Rejecting was four clicks and a toggle list.",
    frictions: [
      { kind: "consent", detail: "Reject-all is not offered at the same level as accept-all", severity: "blocker" },
      { kind: "clarity", detail: "Prices shown without VAT indication for EU visitors", severity: "major" },
    ],
  },
  "keyboard-only": {
    completed: false,
    stoppedAt: "the navigation bar",
    quote: "I tabbed eleven times and never saw where the focus was.",
    frictions: [
      { kind: "access", detail: "No visible focus indicator on primary navigation", severity: "blocker" },
      { kind: "access", detail: "No skip-to-content link", severity: "major" },
    ],
  },
  "confused-newcomer": {
    completed: false,
    stoppedAt: "the features section",
    quote: "I counted six words I'd have to google before I could tell if I need this.",
    frictions: [{ kind: "clarity", detail: "Heavy jargon with no plain-language explanation", severity: "major" }],
  },
  "comparison-shopper": {
    completed: false,
    stoppedAt: "the homepage",
    quote: "Everything here is something your competitors also claim.",
    frictions: [{ kind: "trust", detail: "No differentiation or comparison content", severity: "major" }],
  },
  "privacy-hawk": {
    completed: true,
    stoppedAt: "the privacy policy",
    quote: "Found it in the footer, in grey, at eleven pixels — but it was actually readable.",
    frictions: [{ kind: "findability", detail: "Privacy policy only reachable from footer", severity: "minor" }],
  },
  "deal-hunter": {
    completed: true,
    stoppedAt: "the free tier",
    quote: "Free tier was right there on the pricing page. No notes.",
    frictions: [],
  },
  "enterprise-buyer": {
    completed: false,
    stoppedAt: "looking for a security page",
    quote: "No SOC 2, no SSO mention, no uptime page. I can't take this to procurement.",
    frictions: [{ kind: "trust", detail: "No compliance or security documentation", severity: "blocker" }],
  },
  "slow-mobile": {
    completed: false,
    stoppedAt: "a blank screen",
    quote: "I stared at a white page for nine seconds and then I left.",
    frictions: [{ kind: "performance", detail: "Nothing renders before JS loads", severity: "blocker" }],
  },
  developer: {
    completed: true,
    stoppedAt: "the docs",
    quote: "Docs link in the top nav, code sample on the first page. Thank you.",
    frictions: [],
  },
  "job-seeker": {
    completed: false,
    stoppedAt: "the footer",
    quote: "There's an About page with no people on it.",
    frictions: [{ kind: "dead-end", detail: "No careers or team page", severity: "minor" }],
  },
  "needs-help": {
    completed: false,
    stoppedAt: "a contact form",
    quote: "A form with no reply-time promise is a wishing well.",
    frictions: [{ kind: "dead-end", detail: "No support channel with a stated response time", severity: "major" }],
  },
  skimmer: {
    completed: false,
    stoppedAt: "the bottom of the page",
    quote: "Four headings, all adjectives. I learned nothing.",
    frictions: [{ kind: "clarity", detail: "Headings carry no concrete information", severity: "major" }],
  },
  "tablet-user": {
    completed: true,
    stoppedAt: "the pricing table",
    quote: "The pricing table needed sideways scrolling, but I got there.",
    frictions: [{ kind: "layout", detail: "Pricing table overflows horizontally at 1024px", severity: "minor" }],
  },
  "japanese-visitor": {
    completed: false,
    stoppedAt: "the pricing page",
    quote: "Prices in dollars only, and no word on whether you serve my country.",
    frictions: [{ kind: "clarity", detail: "No regional availability or currency information", severity: "major" }],
  },
  "low-vision": {
    completed: false,
    stoppedAt: "the features grid",
    quote: "At 200% the columns overlapped and the grey text vanished into the background.",
    frictions: [
      { kind: "layout", detail: "Grid overlaps at high zoom", severity: "major" },
      { kind: "access", detail: "Body text contrast below 4.5:1", severity: "major" },
    ],
  },
  "returning-user": {
    completed: true,
    stoppedAt: "the login page",
    quote: "Sign in was tucked next to a much louder Get Started, but I found it.",
    frictions: [{ kind: "findability", detail: "Login de-emphasised relative to signup", severity: "minor" }],
  },
  analyst: {
    completed: false,
    stoppedAt: "the About page",
    quote: "No founders, no location, no dates. I can't write a sentence I could stand behind.",
    frictions: [{ kind: "trust", detail: "No verifiable company facts published", severity: "major" }],
  },
}

const STEP_LOGS = [
  "dismissed a cookie banner",
  'clicked "Pricing"',
  "scrolled down",
  'clicked "Product"',
  "went back",
  "scrolled down",
  'clicked "Docs"',
]

export function mockMode(runId: string): RunMode {
  return {
    name: "swarm-mock",
    async run(req: RunRequest, emit: Emit, signal: AbortSignal): Promise<RunReport> {
      const personas = pickSwarm(req.swarmSize, req.international, siteTypeById(req.siteType))
      const startedAt = new Date().toISOString()
      const t0 = Date.now()

      emit({
        type: "run:started",
        runId,
        target: req.target,
        objective: req.objective,
        siteType: req.siteType,
        international: req.international,
        personas,
      })

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const results: PersonaResult[] = []

      await Promise.all(
        personas.map(async (persona, i) => {
          await sleep(200 + i * 120)
          if (signal.aborted) return
          emit({ type: "persona:started", personaId: persona.id })

          const steps = 3 + (i % 4)
          for (let s = 1; s <= steps; s++) {
            await sleep(700 + Math.random() * 900)
            if (signal.aborted) return
            emit({
              type: "persona:step",
              personaId: persona.id,
              step: s,
              thought: "",
              action: STEP_LOGS[(i + s) % STEP_LOGS.length] ?? "looked around",
            })
          }

          const scripted = SCRIPT[persona.id] ?? {
            completed: false,
            stoppedAt: "the homepage",
            quote: "I wasn't sure what to do next.",
            frictions: [{ kind: "clarity" as const, detail: "Unclear next step", severity: "minor" as const }],
          }

          const result: PersonaResult = {
            persona,
            verdict: scripted,
            steps,
            durationMs: 8_000 + i * 900,
          }
          results.push(result)
          emit({ type: "persona:done", personaId: persona.id, result })
        }),
      )

      results.sort(
        (a, b) =>
          personas.findIndex((p) => p.id === a.persona.id) -
          personas.findIndex((p) => p.id === b.persona.id),
      )

      const { buildThemes, completionRate, erroredCount } = await import("../report/aggregate.js")
      const browserHours = results.reduce((s, r) => s + r.durationMs / 3_600_000, 0)

      const report: RunReport = {
        runId,
        target: req.target,
        objective: req.objective,
        siteType: req.siteType,
        international: req.international,
        startedAt,
        durationMs: Date.now() - t0,
        completionRate: completionRate(results),
        errored: erroredCount(results),
        results,
        themes: buildThemes(results),
        cost: { browserHours, estimatedUsd: browserHours * 0.1 },
      }
      emit({ type: "run:done", report })
      return report
    },
  }
}
