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
 *
 * The collector below is a STRING of plain JavaScript, not a TypeScript
 * function passed to `page.evaluate`. That is deliberate and hard-won: any
 * function defined in this file is compiled by tsx/esbuild first, which wraps
 * it in `__name()` helper calls. Serialising it into the page then fails with
 * `ReferenceError: __name is not defined`, because that helper only exists in
 * the Node bundle. Keeping the source as a literal string side-steps every
 * transpilation step between here and the browser.
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

interface RawObservation {
  title: string
  elements: Array<{ ref: number | null; role: string; name: string }>
  paragraphs: string[]
  scrollProgress: number
  consentWallLikely: boolean
}

const MAX_ELEMENTS = 70
const MAX_TEXT_CHARS = 160

/** Plain JS, evaluated in the page. Keep it dependency-free and defensive. */
const COLLECT_SRC = `
function (maxElements, maxTextChars) {
  var out = [];
  var ref = 0;

  // Clear refs from the previous step so stale ones can never be actioned.
  var prev = document.querySelectorAll("[data-ts-ref]");
  for (var i = 0; i < prev.length; i++) prev[i].removeAttribute("data-ts-ref");

  function isVisible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.top > (window.innerHeight || 0) * 3) return false;
    var s = window.getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    if (Number(s.opacity) < 0.05) return false;
    return true;
  }

  function label(el) {
    var aria = el.getAttribute("aria-label");
    if (aria) return aria;
    var alt = el.getAttribute("alt");
    if (alt) return alt;
    var text = (el.textContent || "").replace(/\\s+/g, " ").trim();
    var ph = el.getAttribute("placeholder");
    var val = el.value;
    return (text || ph || val || "").slice(0, maxTextChars);
  }

  // Headings first — this is how a skimmer or a keyboard user actually
  // perceives the page, and it is what the model needs for structure.
  var heads = document.querySelectorAll("h1, h2, h3");
  for (var h = 0; h < heads.length && out.length < maxElements; h++) {
    if (!isVisible(heads[h])) continue;
    var hn = label(heads[h]);
    if (hn) out.push({ ref: null, role: heads[h].tagName.toLowerCase(), name: hn });
  }

  var sel = 'a[href], button, input:not([type="hidden"]), select, textarea,'
    + ' [role="button"], [role="link"], [role="tab"], [onclick], summary';
  var items = document.querySelectorAll(sel);
  for (var k = 0; k < items.length && out.length < maxElements; k++) {
    var el = items[k];
    if (!isVisible(el)) continue;
    var name = label(el);
    if (!name) continue;
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute("role") || tag;
    if (tag === "a") role = "link";
    if (tag === "input") role = "input:" + (el.getAttribute("type") || "text");
    ref += 1;
    el.setAttribute("data-ts-ref", String(ref));
    out.push({ ref: ref, role: role, name: name });
  }

  // A little body copy so "is this explained in plain language" is answerable.
  var paras = [];
  var blocks = document.querySelectorAll("p, li");
  for (var b = 0; b < blocks.length && paras.length < 12; b++) {
    if (!isVisible(blocks[b])) continue;
    var t = (blocks[b].textContent || "").replace(/\\s+/g, " ").trim();
    if (t.length > 40) paras.push(t.slice(0, maxTextChars));
  }

  var doc = document.documentElement;
  var scrollable = Math.max(1, doc.scrollHeight - window.innerHeight);
  var progress = Math.min(1, Math.max(0, window.scrollY / scrollable));

  var head = ((document.body && document.body.innerText) || "").toLowerCase().slice(0, 2500);
  var consent = /cookie|consent|gdpr|privacy preferences|we value your privacy/.test(head)
    && /accept|agree|reject|manage/.test(head);

  return {
    title: document.title || "",
    elements: out,
    paragraphs: paras,
    scrollProgress: progress,
    consentWallLikely: consent
  };
}`

export async function observe(page: Page): Promise<Observation> {
  const raw = (await page.evaluate(
    `(${COLLECT_SRC})(${MAX_ELEMENTS}, ${MAX_TEXT_CHARS})`,
  )) as RawObservation

  const lines: string[] = []
  for (const el of raw.elements) {
    const name = el.name.replace(/\s+/g, " ").trim()
    if (!name) continue
    lines.push(el.ref === null ? `${el.role} "${name}"` : `[${el.ref}] ${el.role} "${name}"`)
  }
  if (raw.paragraphs.length) {
    lines.push("", "--- body copy ---")
    for (const p of raw.paragraphs) lines.push(p)
  }

  return {
    url: page.url(),
    title: raw.title,
    outline: lines.join("\n").slice(0, 6000),
    consentWallLikely: raw.consentWallLikely,
    scrollProgress: raw.scrollProgress,
  }
}
