/** Does the Starter plan really give us twenty browsers at once? */
import "dotenv/config"
import { Solari, SolariError } from "@solarisdk/browser"

const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })
const N = 20
const t0 = Date.now()
let ok = 0, rejected = 0, failed = 0
const launchMs: number[] = []

try {
  await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      let browser
      const s = Date.now()
      try {
        browser = await solari.launch({ retries: 1 })
        launchMs.push(Date.now() - s)
      } catch (e) {
        if (e instanceof SolariError && e.code === "ConcurrencyLimitExceeded") rejected++
        else { failed++; console.log(`  w${i}:`, String(e).slice(0, 110)) }
        return
      }
      try {
        const page = await browser.newPage()
        await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30_000 })
        await page.title()
        ok++
      } catch (e) {
        failed++
        console.log(`  w${i} nav:`, String(e).slice(0, 110))
      } finally {
        await browser.close()
      }
    }),
  )
} finally {
  await solari.close()
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
launchMs.sort((a, b) => a - b)
console.log(`\n${ok}/${N} succeeded · ${rejected} concurrency-rejected · ${failed} failed · ${secs}s wall clock`)
if (launchMs.length) {
  console.log(`launch latency: p50 ${launchMs[Math.floor(launchMs.length / 2)]}ms · max ${launchMs[launchMs.length - 1]}ms`)
}
const browserHours = (Number(secs) / 3600) * ok
console.log(`≈ ${(browserHours * 0.10).toFixed(4)} USD of browser time`)
