/**
 * Browser swarm — many pages at once, and what to do when the plan says no.
 *
 * Fanning out is the whole reason to run browsers in someone else's cloud: the
 * wall-clock cost of twenty pages is the cost of the slowest one, not the sum.
 * The interesting part is not `Promise.all` — it is the two things that bite
 * once you actually run at the ceiling:
 *
 *   1. `ConcurrencyLimitExceeded` is a NORMAL condition, not a bug. Your plan
 *      has a fixed number of concurrent sessions, and a swarm sized to that
 *      ceiling will occasionally race itself — especially while earlier
 *      sessions are still releasing. Back off and retry; don't drop the work.
 *
 *   2. A worker pool beats `Promise.all` over every task. With a pool the
 *      target list can be longer than the ceiling and the swarm runs in waves.
 *      With `Promise.all` you either stay under the limit or spend the run
 *      fighting for slots.
 *
 * Each worker holds one session slot, uses it, and hands it back.
 */
import { Solari, SolariError } from "@solarisdk/browser"

const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })

const TARGETS = [
  "https://example.com",
  "https://example.org",
  "https://example.net",
  "https://info.cern.ch",
  "https://www.rfc-editor.org/rfc/rfc2324",
  "https://httpbin.org/html",
]

/** Keep this at or below your plan's concurrent-session limit. */
const CONCURRENCY = 3

interface Result {
  url: string
  title?: string
  error?: string
}

async function visit(url: string): Promise<Result> {
  // One session per visit. `browser.close()` releases the slot, which is what
  // lets the next worker in — skip it and the slot stays held until the plan
  // deadline, even though your code has moved on.
  const browser = await solari.launch({ retries: 1 })
  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 })
    return { url, title: await page.title() }
  } finally {
    await browser.close()
  }
}

/** A busy plan is a normal Tuesday. Wait and try again. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // Only concurrency pressure is worth retrying; a bad URL never improves.
      if (!(err instanceof SolariError) || err.code !== "ConcurrencyLimitExceeded") throw err
      const backoff = 1500 * (i + 1)
      console.log(`  plan is busy, retrying in ${backoff}ms`)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw lastErr
}

const started = Date.now()
const results: Result[] = []
let cursor = 0

// The pool: each worker pulls the next target until the list is exhausted, so
// TARGETS can be far longer than CONCURRENCY with no extra bookkeeping.
async function worker(id: number): Promise<void> {
  for (;;) {
    const url = TARGETS[cursor++]
    if (!url) return
    try {
      const r = await withRetry(() => visit(url))
      console.log(`[worker ${id}] ${r.title}`)
      results.push(r)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`[worker ${id}] ${url} failed: ${message}`)
      results.push({ url, error: message })
    }
  }
}

try {
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, TARGETS.length) }, (_, i) => worker(i + 1)),
  )

  const ok = results.filter((r) => !r.error).length
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n${ok}/${results.length} pages in ${seconds}s at concurrency ${CONCURRENCY}`)
} finally {
  // Required in Node: the client keeps a loopback proxy open for the
  // connection-retry path, and that handle keeps the event loop alive.
  await solari.close()
}
