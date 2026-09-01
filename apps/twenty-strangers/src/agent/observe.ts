/**
 * Turning a page into something a model can reason about cheaply.
 *
 * Screenshots are the obvious choice and the wrong one here: twenty personas
 * times a dozen steps times an image is where the budget goes to die. Instead
 * each step sends a compact, ref-tagged outline of what is actually visible —
 * roughly 60x cheaper than an image and, for questions like "can I find the
 * pricing", strictly more reliable.
 *
 * Each interactive element is stamped with `data-ts-ref` so the action layer
 * can address it later without brittle text selectors.
 */

import type { Page } from "patchright-core"

export interface Observation {
  url: string
  title: string
  /** Compact outline, one element per line, refs where actionable. */
  outline: string
  /** True when the page appears to be blocked by a consent wall. */
  consentWallLikely: boolean
  /** Vertical scroll progress 0..1, so the model knows there is more below. */
  scrollProgress: number
}

const MAX_ELEMENTS = 70
const MAX_TEXT_CHARS = 160

/** Runs inside the page. Keep it dependency-free and defensive. */
function collect(maxElements: number, maxTextChars: number) {
  const out: Array<{ ref: number | null; role: string; name: string }> = []
  let ref = 0

  // Clear refs from the previous step so stale ones can never be actioned.
  document.querySelectorAll("[data-ts-ref]").forEach((el) => el.removeAttribute("data-ts-ref"))

  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    if (r.bottom < 0 || r.top > (window.innerHeight || 0) * 3) return false
    const s = window.getComputedStyle(el)
    if (s.visibility === "hidden" || s.display === "none") return false
    if (Number(s.opacity) < 0.05) return false
    return true
  }

  const label = (el: Element): string => {
    const aria = el.getAttribute("aria-label")
    if (aria) return aria
    const alt = el.getAttribute("alt")
    if (alt) return alt
    const val = (el as HTMLInputElement).value
    const ph = el.getAttribute("placeholder")
    const text = (el.textContent || "").replace(/\s+/g, " ").trim()
    return (text || ph || val || "").slice(0, maxTextChars)
  }

  const interactiveSel =
    'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [onclick], summary'

  // Headings and landmarks first — this is how a skimmer or a keyboard user
  // actually perceives the page, and it is what the model needs for structure.
  document.querySelectorAll("h1, h2, h3").forEach((el) => {
    if (out.length >= maxElements) return
    if (!isVisible(el)) return
    const name = label(el)
    if (name) out.push({ ref: null, role: el.tagName.toLowerCase(), name })
  })

  document.querySelectorAll(interactiveSel).forEach((el) => {
    if (out.length >= maxElements) return
    if (!isVisible(el)) return
    const name = label(el)
    if (!name) return
    const tag = el.tagName.toLowerCase()
    let role = el.getAttribute("role") || tag
    if (tag === "a") role = "link"
    if (tag === "input") role = `input:${(el.getAttribute("type") || "text")}`
    el.setAttribute("data-ts-ref", String(++ref))
    out.push({ ref, role, name })
  })

  // A little body copy so "is this explained in plain language" is answerable.
  const paras: string[] = []
  document.querySelectorAll("p, li").forEach((el) => {
    if (paras.length >= 12) return
    if (!isVisible(el)) return
    const t = (el.textContent || "").replace(/\s+/g, " ").trim()
    if (t.length > 40) paras.push(t.slice(0, maxTextChars))
  })

  const doc = document.documentElement
  const scrollable = Math.max(1, doc.scrollHeight - window.innerHeight)
  const scrollProgress = Math.min(1, Math.max(0, window.scrollY / scrollable))

  const bodyText = (document.body?.innerText || "").toLowerCase()
  const consentWallLikely =
    /cookie|consent|gdpr|privacy preferences|we value your privacy/.test(bodyText.slice(0, 2500)) &&
    /accept|agree|reject|manage/.test(bodyText.slice(0, 2500))

  return {
    title: document.title || "",
    elements: out,
    paragraphs: paras,
    scrollProgress,
    consentWallLikely,
  }
}

export async function observe(page: Page): Promise<Observation> {
  const raw = await page.evaluate(
    ([maxEls, maxChars]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__tsCollect(maxEls, maxChars)
    },
    [MAX_ELEMENTS, MAX_TEXT_CHARS] as const,
  ).catch(async () => {
    // First call on a fresh document: install the collector, then retry.
    await page.addInitScript(`globalThis.__tsCollect = ${collect.toString()}`)
    await page.evaluate(`globalThis.__tsCollect = ${collect.toString()}`)
    return page.evaluate(
      ([maxEls, maxChars]) => (globalThis as any).__tsCollect(maxEls, maxChars),
      [MAX_ELEMENTS, MAX_TEXT_CHARS] as const,
    )
  })

  const r = raw as ReturnType<typeof collect>

  const lines: string[] = []
  for (const el of r.elements) {
    const name = el.name.replace(/\s+/g, " ").trim()
    if (!name) continue
    lines.push(el.ref === null ? `${el.role} "${name}"` : `[${el.ref}] ${el.role} "${name}"`)
  }
  if (r.paragraphs.length) {
    lines.push("", "--- body copy ---")
    for (const p of r.paragraphs) lines.push(p)
  }

  return {
    url: page.url(),
    title: r.title,
    outline: lines.join("\n").slice(0, 6000),
    consentWallLikely: r.consentWallLikely,
    scrollProgress: r.scrollProgress,
  }
}
