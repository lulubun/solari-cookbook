/**
 * Record a real run and freeze it as the sample.
 *
 * The sample used to be invented. A recording of an actual run against an
 * actual site is better in every way: the findings are real, the thumbnails
 * are the pages the personas really saw, and nothing has to be labelled as
 * fabricated because nothing is.
 *
 * Captures the entire event stream with relative timings, thins the screencast
 * frames to keep the file sane, and keeps one session replay so the sample can
 * demonstrate that feature too.
 *
 *   npx tsx scripts/record-sample.ts <url> <siteType> "<objective>"
 */
import "dotenv/config"
import { writeFileSync } from "node:fs"
import { swarmMode } from "../src/engine/swarm.js"
import { getReplay } from "../src/replay-cache.js"
import type { RunEvent } from "../src/engine/types.js"

const target = process.argv[2] ?? "https://laurabatson.dev"
const siteType = process.argv[3] ?? "portfolio"
const objective = process.argv[4] ?? "work out who this person is and what she can do"

/** Frames per persona to keep. Enough to feel alive, small enough to ship. */
const FRAMES_PER_PERSONA = 5

const creds = {
  solariApiKey: process.env.SOLARI_API_KEY!,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  bringYourOwn: false,
}

interface Recorded {
  atMs: number
  event: RunEvent
}

const t0 = Date.now()
const recorded: Recorded[] = []
let done = 0

const emit = (event: RunEvent): void => {
  recorded.push({ atMs: Date.now() - t0, event })
  if (event.type === "persona:done") {
    done++
    process.stdout.write(`\r  ${done}/20 finished…`)
  }
}

console.log(`recording a real run against ${target} (${siteType})\n`)
const report = await swarmMode(creds, `sample_${Date.now().toString(36)}`).run(
  { target, objective, siteType, international: true, swarmSize: 20 },
  emit,
  new AbortController().signal,
)
console.log("\n")

// --- thin the frames --------------------------------------------------------
const framesByPersona = new Map<string, Recorded[]>()
for (const r of recorded) {
  if (r.event.type !== "persona:frame") continue
  const list = framesByPersona.get(r.event.personaId) ?? []
  list.push(r)
  framesByPersona.set(r.event.personaId, list)
}

const keep = new Set<Recorded>()
for (const [, list] of framesByPersona) {
  if (list.length <= FRAMES_PER_PERSONA) {
    for (const f of list) keep.add(f)
    continue
  }
  // Evenly spaced, always including the last — the last frame is where the
  // persona ended up, which is the one worth freezing on.
  const stride = (list.length - 1) / (FRAMES_PER_PERSONA - 1)
  for (let i = 0; i < FRAMES_PER_PERSONA; i++) {
    const f = list[Math.round(i * stride)]
    if (f) keep.add(f)
  }
}

const thinned = recorded.filter((r) => r.event.type !== "persona:frame" || keep.has(r))

// --- keep one replay so the sample can show that feature too -----------------
let sampleReplay: { sessionId: string; ndjson: string; personaName: string } | null = null
for (const result of report.results) {
  if (!result.replayUrl) continue
  const sessionId = decodeURIComponent(result.replayUrl.replace("/replay/", ""))
  const held = getReplay(sessionId)
  if (held && held.ndjson.length > 2000 && held.ndjson.length < 900_000) {
    sampleReplay = { sessionId, ndjson: held.ndjson, personaName: result.persona.name }
    break
  }
}

const out = {
  recordedAt: new Date().toISOString(),
  target,
  siteType,
  objective,
  events: thinned,
  replay: sampleReplay,
}

const path = "src/sample-run.json"
writeFileSync(path, JSON.stringify(out))
const mb = (Buffer.byteLength(JSON.stringify(out)) / 1024 / 1024).toFixed(2)

const framesKept = thinned.filter((r) => r.event.type === "persona:frame").length
const framesTotal = recorded.filter((r) => r.event.type === "persona:frame").length

console.log(`completion : ${Math.round(report.completionRate * 100)}%`)
console.log(`errored    : ${report.errored} · not-applicable: ${report.notApplicable}`)
console.log(`duration   : ${(report.durationMs / 1000).toFixed(1)}s`)
console.log(`cost       : $${report.cost.estimatedUsd.toFixed(3)}`)
console.log(`frames     : kept ${framesKept} of ${framesTotal}`)
console.log(`replay     : ${sampleReplay ? `${sampleReplay.personaName} (${(sampleReplay.ndjson.length / 1024).toFixed(0)}KB)` : "none captured"}`)
console.log(`written    : ${path} (${mb} MB)`)
console.log(`\nthemes:`)
for (const t of report.themes) console.log(`  ${t.raisedBy.length}x [${t.severity}] ${t.headline}`)
process.exit(0)
