/**
 * Live smoke test for the Solari half of the pipeline — no LLM involved.
 *
 * Exercises exactly the calls persona-run.ts makes, in the same order, so the
 * risky untested path (launch → context → screencast → observe → release →
 * replay) is proven before a real swarm spends real money.
 *
 * Deliberately cheap: a handful of short sessions, every one closed in a
 * finally block.
 */
import "dotenv/config"
import { Solari, SolariError } from "@solarisdk/browser"
import { observe } from "../src/agent/observe.js"

const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })
const log = (...a: unknown[]) => console.log(...a)

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

async function test1PlainLaunch(): Promise<void> {
  log("\n[1] plain launch → context → observe → release → replay")
  const t0 = Date.now()
  const browser = await solari.launch({ recording: true, retries: 1 })
  const sessionId = browser.id
  check("launched", true, `${sessionId} in ${Date.now() - t0}ms`)

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: "en-US",
      extraHTTPHeaders: { "x-automated-by": "TwentyStrangersBot" },
    })
    check("newContext with mobile viewport", true)

    const page = await context.newPage()

    let frames = 0
    try {
      const cdp = await context.newCDPSession(page)
      cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number }) => {
        frames++
        void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
      })
      await cdp.send("Page.startScreencast", {
        format: "jpeg", quality: 45, maxWidth: 400, maxHeight: 260, everyNthFrame: 2,
      })
      check("startScreencast accepted", true)
    } catch (e) {
      check("startScreencast accepted", false, String(e).slice(0, 120))
    }

    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30_000 })
    check("navigated", true, page.url())

    const obs = await observe(page)
    check("observe() returned an outline", obs.outline.length > 0, `${obs.outline.length} chars, title "${obs.title}"`)
    log("      outline preview:", JSON.stringify(obs.outline.slice(0, 110)))

    await page.waitForTimeout(2500)
    check("screencast produced frames", frames > 0, `${frames} frames`)
  } finally {
    await browser.close()
  }

  log("      polling for replay…")
  let replay: string | undefined
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1200))
    try {
      const { url } = await solari.sessions.getReplayUrl(sessionId)
      if (url) { replay = url; break }
    } catch { /* not ready */ }
  }
  check("replay URL available", Boolean(replay), replay ? `${replay.slice(0, 60)}…` : "never appeared")
}

async function test2StealthProxy(): Promise<void> {
  log("\n[2] stealth + residential proxy (the geo personas)")
  let browser
  try {
    browser = await solari.launch({ stealth: true, proxy: { country: "de" }, retries: 1 })
  } catch (e) {
    const code = e instanceof SolariError ? e.code : undefined
    check("stealth+proxy launch", false, `${code ?? ""} ${String(e).slice(0, 140)}`)
    return
  }
  try {
    check("stealth+proxy launch", true, JSON.stringify(browser.proxy))
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "de-DE",
      ...(browser.proxy?.timezoneId ? { timezoneId: browser.proxy.timezoneId } : {}),
    })
    const page = await context.newPage()
    await page.goto("https://api.ipify.org?format=json", { waitUntil: "domcontentloaded", timeout: 30_000 })
    const body = await page.locator("pre").innerText().catch(() => page.content())
    check("egress reachable through proxy", true, body.trim().slice(0, 80))
    check("timezone resolved for locale", Boolean(browser.proxy?.timezoneId), browser.proxy?.timezoneId ?? "none")
  } finally {
    await browser.close()
  }
}

async function test3Concurrency(n: number): Promise<void> {
  log(`\n[3] ${n} browsers at once (worker pool + concurrency handling)`)
  const t0 = Date.now()
  let ok = 0
  let concurrencyHits = 0

  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      let browser
      try {
        browser = await solari.launch({ retries: 1 })
      } catch (e) {
        if (e instanceof SolariError && e.code === "ConcurrencyLimitExceeded") concurrencyHits++
        else log(`      worker ${i} launch failed:`, String(e).slice(0, 100))
        return
      }
      try {
        const page = await browser.newPage()
        await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30_000 })
        await page.title()
        ok++
      } catch (e) {
        log(`      worker ${i} failed:`, String(e).slice(0, 100))
      } finally {
        await browser.close()
      }
    }),
  )
  check(`${n} concurrent sessions`, ok === n, `${ok}/${n} succeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${concurrencyHits} concurrency rejections`)
}

try {
  await test1PlainLaunch()
  await test2StealthProxy()
  await test3Concurrency(5)
} finally {
  // Required, or the process hangs forever on the loopback proxy handle.
  await solari.close()
}

log(`\n${failures === 0 ? "✅ all checks passed" : `❌ ${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
