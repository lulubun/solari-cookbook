/**
 * Does the recording actually cover the whole visit?
 *
 * Compares two ways of getting a page: a fresh context (what persona-run does,
 * because each persona needs its own viewport/locale/timezone) versus the
 * session's default context. If Solari's recorder only instruments the default
 * context, replays of persona visits would be short and miss most of the run —
 * which is exactly the symptom reported.
 */
import "dotenv/config"
import { Solari } from "@solarisdk/browser"

const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })

async function trial(label: string, useNewContext: boolean) {
  const browser = await solari.launch({ recording: true, retries: 1 })
  const sessionId = browser.id
  const t0 = Date.now()
  try {
    const ctx = useNewContext
      ? await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" })
      : browser.contexts()[0]!
    const page = useNewContext ? await ctx.newPage() : (ctx.pages()[0] ?? (await ctx.newPage()))

    await page.goto("https://books.toscrape.com", { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(1500)
    await page.mouse.wheel(0, 600); await page.waitForTimeout(1200)
    await page.locator("a").first().click({ timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(1500)
    await page.mouse.wheel(0, 400); await page.waitForTimeout(1200)
    await page.goBack().catch(() => {}); await page.waitForTimeout(1500)
  } finally {
    await browser.close()
  }
  const visitMs = Date.now() - t0

  let text = ""
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1200))
    try {
      const b = await solari.sessions.downloadReplay(sessionId)
      if (b?.length) { text = Buffer.from(b).toString("utf8"); break }
    } catch {}
  }
  const events = text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) as Array<{type:number;timestamp:number}>
  const span = events.length > 1 ? (events[events.length-1]!.timestamp - events[0]!.timestamp) : 0
  const types: Record<string, number> = {}
  for (const e of events) types[String(e.type)] = (types[String(e.type)] ?? 0) + 1

  console.log(`\n${label}`)
  console.log(`  visit    : ${(visitMs/1000).toFixed(1)}s`)
  console.log(`  replay   : ${(span/1000).toFixed(1)}s  (${events.length} events)`)
  console.log(`  coverage : ${visitMs ? ((span/visitMs)*100).toFixed(0) : "0"}% of the visit`)
  console.log(`  types    : ${JSON.stringify(types)}  [2=FullSnapshot 3=Incremental 4=Meta]`)
}

await trial("A. fresh context (what persona-run does today)", true)
await trial("B. session default context", false)
await solari.close()
