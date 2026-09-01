/**
 * Live run through the real engine. Same code path the server uses — this
 * script only supplies credentials and prints the event stream to a terminal
 * instead of a websocket.
 *
 *   npx tsx scripts/live-swarm.ts <url> [swarmSize]
 */
import "dotenv/config"
import { swarmMode } from "../src/engine/swarm.js"
import type { RunEvent } from "../src/engine/types.js"

const target = process.argv[2] ?? "https://getsolari.com"
const size = Number(process.argv[3] ?? 3)

const creds = {
  solariApiKey: process.env.SOLARI_API_KEY!,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  bringYourOwn: false,
}

const names = new Map<string, string>()
let frames = 0

const emit = (e: RunEvent): void => {
  switch (e.type) {
    case "run:started":
      for (const p of e.personas) names.set(p.id, `${p.emoji} ${p.name}`)
      console.log(`\nrunning ${e.personas.length} personas against ${e.target}\n`)
      break
    case "persona:frame":
      frames++
      break
    case "persona:step":
      console.log(`  ${names.get(e.personaId)} · step ${e.step}: ${e.action}`)
      break
    case "persona:done": {
      const v = e.result.verdict
      console.log(
        `\n  ${names.get(e.personaId)} — ${v.completed ? "GOT THERE" : "GAVE UP"} at ${v.stoppedAt} (${e.result.steps} steps, ${(e.result.durationMs / 1000).toFixed(1)}s)`,
      )
      console.log(`     "${v.quote}"`)
      for (const f of v.frictions) console.log(`     · [${f.severity}/${f.kind}] ${f.detail}`)
      if (e.result.error) console.log(`     !! ${e.result.error}`)
      if (e.result.replayUrl) console.log(`     replay ok`)
      console.log()
      break
    }
    case "run:done": {
      const r = e.report
      console.log("=".repeat(66))
      console.log(`completion: ${Math.round(r.completionRate * 100)}%  ·  ${(r.durationMs / 1000).toFixed(1)}s  ·  $${r.cost.estimatedUsd.toFixed(3)}  ·  ${frames} live frames`)
      console.log(`replays: ${r.results.filter((x) => x.replayUrl).length}/${r.results.length}`)
      console.log("\nthemes:")
      for (const t of r.themes) console.log(`  ${t.raisedBy.length}x [${t.severity}] ${t.headline} — ${t.raisedBy.join(", ")}`)
      break
    }
    case "run:error":
      console.log("RUN ERROR:", e.message)
      break
  }
}

const mode = swarmMode(creds, `live_${Date.now().toString(36)}`)
await mode.run({ target, objective: "", swarmSize: size }, emit, new AbortController().signal)
process.exit(0)
