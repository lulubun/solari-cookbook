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

interface Entry {
  sessionId: string
  ndjson: string
  bytes: number
  storedAt: number
}

const entries = new Map<string, Entry>()
let totalBytes = 0

export function storeReplay(sessionId: string, ndjson: string): boolean {
  const bytes = Buffer.byteLength(ndjson, "utf8")
  if (bytes === 0 || bytes > MAX_ENTRY_BYTES) return false

  const existing = entries.get(sessionId)
  if (existing) totalBytes -= existing.bytes

  entries.set(sessionId, { sessionId, ndjson, bytes, storedAt: Date.now() })
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

export function getReplay(sessionId: string): string | undefined {
  return entries.get(sessionId)?.ndjson
}

export function replayStats(): { count: number; totalBytes: number } {
  return { count: entries.size, totalBytes }
}
