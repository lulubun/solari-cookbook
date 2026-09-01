import "dotenv/config"
import { Solari } from "@solarisdk/browser"
import { gunzipSync } from "node:zlib"

const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })
const browser = await solari.launch({ recording: true, retries: 1 })
const sessionId = browser.id
try {
  const page = await browser.newPage()
  await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(800)
} finally {
  await browser.close()
}

let bytes: Uint8Array | undefined
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 1200))
  try { bytes = await solari.sessions.downloadReplay(sessionId); if (bytes?.length) break } catch {}
}
await solari.close()

if (!bytes) { console.log("no replay"); process.exit(1) }
console.log("raw bytes:", bytes.length)
console.log("magic:", Buffer.from(bytes.slice(0, 4)).toString("hex"))

let text: string
try {
  text = gunzipSync(Buffer.from(bytes)).toString("utf8")
  console.log("gunzipped to:", text.length, "chars")
} catch (e) {
  text = Buffer.from(bytes).toString("utf8")
  console.log("not gzipped; treating as plain text")
}

const lines = text.split("\n").filter(Boolean)
console.log("ndjson lines:", lines.length)
for (const l of lines.slice(0, 3)) {
  try {
    const o = JSON.parse(l)
    console.log("  keys:", Object.keys(o).join(","), "| type:", o.type, "| preview:", JSON.stringify(o).slice(0, 160))
  } catch { console.log("  unparseable:", l.slice(0, 120)) }
}
const types = new Map<string, number>()
for (const l of lines) { try { const o = JSON.parse(l); types.set(String(o.type), (types.get(String(o.type)) ?? 0) + 1) } catch {} }
console.log("event type histogram:", JSON.stringify([...types.entries()]))
