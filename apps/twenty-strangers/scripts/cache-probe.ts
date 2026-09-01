/** Same 3-persona run as the pre-caching baseline, with the meter exposed. */
import "dotenv/config"
import { swarmMode } from "../src/engine/swarm.js"
import type { RunEvent } from "../src/engine/types.js"

const creds = {
  solariApiKey: process.env.SOLARI_API_KEY!,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  bringYourOwn: false,
}
let done = 0
const emit = (e: RunEvent): void => {
  if (e.type === "persona:done") done++
  if (e.type === "run:done") {
    const r = e.report
    console.log(`\ncompletion ${Math.round(r.completionRate * 100)}%  ·  ${(r.durationMs / 1000).toFixed(1)}s  ·  $${r.cost.estimatedUsd.toFixed(4)}  ·  errored ${r.errored}`)
    console.log(`browser $${(r.cost.browserHours * 0.10).toFixed(4)}  ·  tokens $${(r.cost.estimatedUsd - r.cost.browserHours * 0.10).toFixed(4)}`)
  }
}
await swarmMode(creds, "cacheprobe").run(
  { target: "https://getsolari.com", objective: "", swarmSize: 3 },
  emit,
  new AbortController().signal,
)
process.exit(0)
