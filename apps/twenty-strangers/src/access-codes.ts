/**
 * Single-use access codes.
 *
 * A third way in, alongside paying and bringing your own keys: hand someone a
 * code and they get one run on the house keys, without ever seeing them and
 * without paying. Useful for the people you actually want to try this —
 * a reviewer, a friend's startup, whoever you are talking to at the time.
 *
 * Semantics deliberately mirror the payment flow:
 *
 *   reserve  → the code is spoken for while the run is in flight, so the same
 *              code cannot be redeemed twice concurrently
 *   burn     → the run produced a report; the code is now meaningless
 *   release  → the run failed; the code goes back, because losing your one
 *              code to our crash would be worse than the equivalent payment
 *              case, where a failed authorisation is simply voided
 *
 * Burnt codes are written to disk. In memory alone, a restart would silently
 * make every spent code live again — which for a single-use code is not a
 * small bug.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { timingSafeEqual } from "node:crypto"

export interface AccessCodeStore {
  /** Valid, unspent, and not currently in flight. */
  check(code: string): { ok: true } | { ok: false; reason: string }
  reserve(code: string): boolean
  burn(code: string): void
  release(code: string): void
  stats(): { configured: number; burnt: number; reserved: number }
}

/** Constant-time compare so a wrong code cannot be narrowed by timing. */
function sameCode(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8")
  const bb = Buffer.from(b, "utf8")
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function createAccessCodeStore(codes: string[], stateDir: string): AccessCodeStore {
  const valid = codes.map((c) => c.trim()).filter(Boolean)
  const file = path.join(stateDir, "burnt-codes.json")
  const burnt = new Set<string>()
  const reserved = new Set<string>()

  // Load previously spent codes.
  try {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
      if (Array.isArray(parsed)) for (const c of parsed) if (typeof c === "string") burnt.add(c)
    }
  } catch (err) {
    // A corrupt file must not silently resurrect every spent code.
    console.error(`Could not read ${file}; refusing to treat spent codes as unused.`, err)
    throw new Error("Access-code state is unreadable. Fix or delete burnt-codes.json to continue.")
  }

  function persist(): void {
    try {
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(file, JSON.stringify([...burnt], null, 2), "utf8")
    } catch (err) {
      console.error("Could not persist burnt access codes:", err)
    }
  }

  /** Resolve a submitted string to the configured code it matches, if any. */
  function match(submitted: string): string | null {
    for (const c of valid) if (sameCode(submitted, c)) return c
    return null
  }

  return {
    check(code) {
      const trimmed = (code ?? "").trim()
      if (!trimmed) return { ok: false, reason: "Enter your access code." }
      if (valid.length === 0) {
        return { ok: false, reason: "Access codes aren't enabled on this instance." }
      }
      const hit = match(trimmed)
      if (!hit) return { ok: false, reason: "That code isn't valid." }
      if (burnt.has(hit)) {
        return { ok: false, reason: "That code has already been used. Each code is good for one run." }
      }
      if (reserved.has(hit)) {
        return { ok: false, reason: "That code is being used right now. Wait for that run to finish." }
      }
      return { ok: true }
    },

    reserve(code) {
      const hit = match((code ?? "").trim())
      if (!hit || burnt.has(hit) || reserved.has(hit)) return false
      reserved.add(hit)
      return true
    },

    burn(code) {
      const hit = match((code ?? "").trim())
      if (!hit) return
      reserved.delete(hit)
      burnt.add(hit)
      persist()
    },

    release(code) {
      const hit = match((code ?? "").trim())
      if (!hit) return
      reserved.delete(hit)
    },

    stats() {
      return { configured: valid.length, burnt: burnt.size, reserved: reserved.size }
    },
  }
}
