/**
 * Replays, held in memory and served back as a watchable page.
 *
 * Solari's own replay URL is a presigned S3 link that serves gzipped NDJSON
 * with download headers, so clicking it hands you a `.ndjson.gz` file your
 * browser will not open. The data is rrweb, which is eminently playable — it
 * just needs a player pointed at it.
 *
 * Capturing the bytes at the end of each visit rather than proxying on demand
 * has a second benefit: a visitor running on their own API key gets a working
 * replay too, without this server ever storing their credentials.
 *
 * Bounded by total bytes, oldest evicted first. Replays are ephemeral by
 * design — Solari keeps the originals for the plan's retention window, and
 * this is only a viewer.
 */

const MAX_TOTAL_BYTES = 96 * 1024 * 1024
const MAX_ENTRY_BYTES = 12 * 1024 * 1024

/**
 * What the persona was doing, alongside what the page was doing.
 *
 * rrweb records DOM changes and nothing else, so an agent-side event — a
 * refused click, a model error, running out of patience — leaves no trace in
 * the recording at all. Watching a replay of a visit that "hit an error" shows
 * a page sitting there placidly, which reads as a broken replay rather than
 * what it is. Pairing the step log with the recording is what makes the two
 * line up.
 */
export interface ReplayMeta {
  personaName: string
  emoji: string
  mission: string
  quote: string
  stoppedAt: string
  completed: boolean
  error?: string
  /** Step log with offsets from the first recorded event. */
  steps: Array<{ n: number; action: string; atMs: number }>
}

interface Entry {
  sessionId: string
  ndjson: string
  meta?: ReplayMeta
  bytes: number
  storedAt: number
}

const entries = new Map<string, Entry>()
let totalBytes = 0

export function storeReplay(sessionId: string, ndjson: string, meta?: ReplayMeta): boolean {
  const bytes = Buffer.byteLength(ndjson, "utf8")
  if (bytes === 0 || bytes > MAX_ENTRY_BYTES) return false

  const existing = entries.get(sessionId)
  if (existing) totalBytes -= existing.bytes

  entries.set(sessionId, { sessionId, ndjson, meta, bytes, storedAt: Date.now() })
  totalBytes += bytes

  // Evict oldest until we are back under the ceiling. Map preserves insertion
  // order, so the first key is the oldest.
  while (totalBytes > MAX_TOTAL_BYTES && entries.size > 1) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    const e = entries.get(oldest)
    if (e) totalBytes -= e.bytes
    entries.delete(oldest)
  }
  return true
}

export function getReplay(sessionId: string): { ndjson: string; meta?: ReplayMeta } | undefined {
  const e = entries.get(sessionId)
  return e ? { ndjson: e.ndjson, meta: e.meta } : undefined
}

/** Attach the account of the visit once the verdict exists. */
export function annotateReplay(sessionId: string, meta: ReplayMeta): void {
  const e = entries.get(sessionId)
  if (e) e.meta = meta
}

export function replayStats(): { count: number; totalBytes: number } {
  return { count: entries.size, totalBytes }
}
