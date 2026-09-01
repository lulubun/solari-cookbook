/**
 * Turning twenty opinions into a short list of things worth fixing.
 *
 * This is deliberately deterministic rather than another model call. One
 * stranger disliking your headline is noise; eleven strangers independently
 * failing to find your pricing is a fact, and a fact deserves counting rather
 * than summarising. It is also free and instant, which matters when the whole
 * point is that a run costs pennies.
 */

import type { PersonaResult, RunReport, FrictionKind, Friction } from "../engine/types.js"

const SEVERITY_RANK: Record<Friction["severity"], number> = { blocker: 3, major: 2, minor: 1 }

const KIND_HEADLINE: Record<FrictionKind, string> = {
  findability: "People couldn't find what they came for",
  clarity: "The words didn't land",
  layout: "It broke at some screen sizes",
  access: "It couldn't be operated by everyone",
  consent: "The consent banner got in the way",
  "dead-end": "Routes that went nowhere",
  trust: "Missing credibility signals",
  performance: "Too slow, or never rendered",
}

export function buildThemes(results: PersonaResult[]): RunReport["themes"] {
  const byKind = new Map<FrictionKind, { raisedBy: Set<string>; worst: Friction["severity"] }>()

  for (const r of results) {
    for (const f of r.verdict.frictions) {
      if (!KIND_HEADLINE[f.kind]) continue
      const entry = byKind.get(f.kind) ?? { raisedBy: new Set<string>(), worst: "minor" as const }
      entry.raisedBy.add(r.persona.name)
      if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[entry.worst]) entry.worst = f.severity
      byKind.set(f.kind, entry)
    }
  }

  return [...byKind.entries()]
    .map(([kind, v]) => ({
      kind,
      severity: v.worst,
      headline: KIND_HEADLINE[kind],
      raisedBy: [...v.raisedBy].sort(),
    }))
    .sort((a, b) => {
      // Consensus first, then severity — a blocker one person hit matters less
      // than a major issue eight people hit.
      if (b.raisedBy.length !== a.raisedBy.length) return b.raisedBy.length - a.raisedBy.length
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    })
}

export function completionRate(results: PersonaResult[]): number {
  if (results.length === 0) return 0
  return results.filter((r) => r.verdict.completed).length / results.length
}
