import "dotenv/config"
import { Solari } from "@solarisdk/browser"
import { observe } from "../src/agent/observe.js"
const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })
const browser = await solari.launch({ retries: 1 })
try {
  const page = await browser.newPage()
  await page.goto("https://books.toscrape.com/catalogue/sapiens-a-brief-history-of-humankind_996/index.html", {
    waitUntil: "domcontentloaded", timeout: 30000,
  })
  const obs = await observe(page)
  console.log(obs.outline)
} finally {
  await browser.close(); await solari.close()
}
