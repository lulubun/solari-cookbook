import "dotenv/config"
import { Solari } from "@solarisdk/browser"
const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })
const browser = await solari.launch({ retries: 1 })
try {
  const page = await browser.newPage()
  await page.goto("https://getsolari.com", { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.waitForTimeout(1500)
  const links = await page.evaluate(`
    Array.from(document.querySelectorAll('a')).map(a => ({
      text: (a.textContent||'').replace(/\\s+/g,' ').trim(),
      href: a.getAttribute('href')
    })).filter(l => l.text)
  `) as Array<{text:string; href:string|null}>
  console.log("nav-ish links on getsolari.com:")
  for (const l of links.slice(0, 25)) console.log(`  ${JSON.stringify(l.text).padEnd(28)} → ${l.href}`)
  const about = links.filter(l => /about/i.test(l.text))
  console.log("\nABOUT links:", JSON.stringify(about))
} finally {
  await browser.close()
  await solari.close()
}
