/**
 * In-memory sliding-window limits.
 *
 * In-memory is the right call for a single-process demo: the limits exist to
 * protect a $20 credit balance, not to survive a determined adversary. If this
 * ever runs on more than one instance, swap the Map for Redis and nothing else
 * changes.
 */

interface Window {
  hits: number[]
}

const DAY_MS = 24 * 60 * 60 * 1000

export class SlidingWindow {
  private readonly windows = new Map<string, Window>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = DAY_MS,
  ) {}

  /** Returns null when allowed, or a human-readable reason when not. */
  check(key: string): string | null {
    const now = Date.now()
    const w = this.windows.get(key) ?? { hits: [] }
    w.hits = w.hits.filter((t) => now - t < this.windowMs)
    this.windows.set(key, w)
    if (w.hits.length >= this.limit) {
      const oldest = w.hits[0] ?? now
      const mins = Math.ceil((this.windowMs - (now - oldest)) / 60_000)
      return `Limit reached (${this.limit} per day). Try again in about ${mins} minute${mins === 1 ? "" : "s"}, or use your own API keys.`
    }
    return null
  }

  /** How many are left in the window, so the UI can say so before you click. */
  remaining(key: string): number {
    const now = Date.now()
    const w = this.windows.get(key)
    if (!w) return this.limit
    const live = w.hits.filter((t) => now - t < this.windowMs)
    return Math.max(0, this.limit - live.length)
  }

  record(key: string): void {
    const w = this.windows.get(key) ?? { hits: [] }
    w.hits.push(Date.now())
    this.windows.set(key, w)
  }

  /** Periodic cleanup so the map doesn't grow without bound. */
  sweep(): void {
    const now = Date.now()
    for (const [k, w] of this.windows) {
      w.hits = w.hits.filter((t) => now - t < this.windowMs)
      if (w.hits.length === 0) this.windows.delete(k)
    }
  }
}
