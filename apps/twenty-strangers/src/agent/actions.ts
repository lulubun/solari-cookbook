/**
 * The action space, and the enforcement that keeps it honest.
 *
 * The personas are explorers, not operators. They can look, scroll, follow
 * links, use the keyboard, and type into search boxes. They cannot buy, send,
 * delete, publish, or submit — and that is enforced here rather than asked for
 * in the prompt, because a model told "please don't click Buy" will eventually
 * click Buy.
 *
 * A refused click is not an error. It is usually the correct end of the
 * journey: the persona reached the point of no return, which is exactly what
 * we wanted to measure.
 */

import type { Page } from "patchright-core"
import type Anthropic from "@anthropic-ai/sdk"
import { isIrreversibleLabel, scrubTypedText } from "../safety.js"

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "click",
    description:
      "Click a link or button by its ref number from the page outline. Use this to navigate.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "number", description: "The [n] ref from the outline." },
        label: { type: "string", description: "The visible text, for the log." },
      },
      required: ["ref", "label"],
    },
  },
  {
    name: "type",
    description:
      "Type into a text field by ref. Only for search boxes and filters. Never enter personal data.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "number" },
        text: { type: "string" },
        submit: { type: "boolean", description: "Press Enter afterwards." },
      },
      required: ["ref", "text"],
    },
  },
  {
    name: "scroll",
    description: "Scroll the page to see more.",
    input_schema: {
      type: "object",
      properties: { direction: { type: "string", enum: ["down", "up"] } },
      required: ["direction"],
    },
  },
  {
    name: "press",
    description:
      "Press a key. Use Tab / Shift+Tab / Enter to navigate by keyboard, or Escape to dismiss an overlay.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string", description: "e.g. Tab, Shift+Tab, Enter, Escape" } },
      required: ["key"],
    },
  },
  { name: "back", description: "Go back to the previous page.", input_schema: { type: "object", properties: {} } },
  {
    name: "finish",
    description:
      "Stop and deliver your verdict. Call this as soon as you have your answer, or as soon as you have decided to give up.",
    input_schema: {
      type: "object",
      properties: {
        completed: { type: "boolean", description: "Did you achieve your mission?" },
        not_applicable: {
          type: "boolean",
          description:
            "Set true if what you came looking for is not something this KIND of site would " +
            "have — e.g. looking for a company's funding on an individual's personal site. " +
            "This is not a fault in the site and will not be counted against it. Do NOT set " +
            "it merely because you could not find something the site plausibly should have.",
        },
        stopped_at: { type: "string", description: "Where you stopped, in one short phrase." },
        quote: {
          type: "string",
          description:
            "One vivid sentence in your own voice summing up the experience. This is the line that gets quoted.",
        },
        frictions: {
          type: "array",
          description:
            "Specific things that got in your way. Empty if genuinely none. Phrase each " +
            "as what YOU experienced or could not find — never as an absolute claim that " +
            "something does not exist on the site, which you cannot know from one short visit.",
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["findability", "clarity", "layout", "access", "consent", "dead-end", "trust", "performance"],
              },
              detail: { type: "string" },
              severity: { type: "string", enum: ["blocker", "major", "minor"] },
            },
            required: ["kind", "detail", "severity"],
          },
        },
      },
      required: ["completed", "stopped_at", "quote", "frictions"],
    },
  },
]

export interface ActionOutcome {
  /** Fed back to the model as the tool result. */
  result: string
  /** Human-readable one-liner for the live step log. */
  log: string
  /** Set when the persona hit the point of no return. */
  hitGuardRail?: boolean
}

async function refLocator(page: Page, ref: number) {
  return page.locator(`[data-ts-ref="${ref}"]`).first()
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

export async function executeAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<ActionOutcome> {
  switch (name) {
    case "click": {
      const ref = Number(input.ref)
      const label = String(input.label ?? "")

      if (isIrreversibleLabel(label)) {
        return {
          result:
            `Refused: "${label}" would take a real, irreversible action. You have reached the ` +
            `end of what can be tested. Treat this as the natural end of your journey and call finish.`,
          log: `refused to click "${label}" (point of no return)`,
          hitGuardRail: true,
        }
      }

      const loc = await refLocator(page, ref)

      // Some links are not supposed to navigate the current page at all, and
      // reporting them as dead is a false accusation about someone's site.
      // A `mailto:` opens a mail client; a `target="_blank"` opens a new tab.
      // In both cases this page's URL stays put, which naive before/after
      // comparison reads as "nothing happened".
      const href = await loc.getAttribute("href").catch(() => null)
      const linkTarget = await loc.getAttribute("target").catch(() => null)

      const protocolLink = href?.match(/^(mailto|tel|sms):/i)?.[1]?.toLowerCase()
      if (protocolLink) {
        const opens =
          protocolLink === "mailto" ? "the visitor's email app" : "the visitor's phone dialler"
        return {
          result:
            `"${label}" is a ${protocolLink}: link (${href}). Clicking it hands off to ${opens} ` +
            `rather than loading a web page, so nothing will change here. That is correct ` +
            `behaviour — it is NOT a broken link, and must not be reported as one. ` +
            `The contact route exists and works.`,
          log: `found ${protocolLink} link "${label}"`,
        }
      }

      const ctx = page.context()
      const tabsBefore = ctx.pages().length
      const beforeUrl = page.url()
      const beforeTitle = await page.title().catch(() => "")
      try {
        await loc.click({ timeout: 8000 })
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {})
        const afterUrl = page.url()
        const afterTitle = await page.title().catch(() => "")

        // A link that opened a new tab worked. Close it so the persona stays
        // where they were, and say plainly that it worked.
        const opened = ctx.pages().filter((pg) => pg !== page)
        if (opened.length > 0 && ctx.pages().length > tabsBefore) {
          const newest = opened[opened.length - 1]!
          const openedUrl = newest.url()
          await newest.close().catch(() => {})
          return {
            result:
              `Clicked "${label}". It opened ${openedUrl || "a new page"} in a NEW TAB, which ` +
              `is what a link like this is meant to do. The page you are on has not changed ` +
              `because the link was not supposed to change it. The link works — do not report ` +
              `it as broken.`,
            log: `opened "${label}" in a new tab`,
          }
        }

        // Tell the model what actually happened rather than letting it infer.
        // Left to guess, a persona reports ordinary internal navigation as a
        // broken link — "the links didn't take me anywhere different" — which
        // is a fabricated fault, and the most common kind here.
        let result: string
        if (afterUrl !== beforeUrl) {
          const external = originOf(afterUrl) !== originOf(beforeUrl)
          result =
            `Clicked "${label}". The page changed to ${afterUrl}` +
            (afterTitle ? ` — "${afterTitle}"` : "") +
            (external
              ? `. That left the site you were visiting.`
              : `. That is ordinary navigation within the same site, and is working correctly.`)
        } else if (afterTitle !== beforeTitle) {
          result = `Clicked "${label}". The URL is unchanged but the page content changed to "${afterTitle}".`
        } else if (linkTarget === "_blank") {
          result =
            `Clicked "${label}". It is marked to open in a new tab, so this page correctly ` +
            `did not change. Treat the link as working.`
        } else {
          result =
            `Clicked "${label}". The URL did not change (still ${afterUrl}) and the title is the same. ` +
            `Either nothing happened, or something changed further down the page — check the outline below before concluding the link is broken.`
        }
        return { result, log: `clicked "${label}"` }
      } catch {
        return {
          result: `Could not click ref ${ref} ("${label}") — it may have moved or be covered by an overlay.`,
          log: `failed to click "${label}"`,
        }
      }
    }

    case "type": {
      const ref = Number(input.ref)
      const raw = String(input.text ?? "")
      const { text, blocked } = scrubTypedText(raw)
      const loc = await refLocator(page, ref)
      try {
        await loc.fill(text, { timeout: 8000 })
        if (input.submit) {
          await loc.press("Enter", { timeout: 5000 })
          await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {})
        }
        const note = blocked
          ? " (your text looked like personal data, so a placeholder was substituted)"
          : ""
        return { result: `Typed "${text}"${note}.`, log: `typed "${text.slice(0, 40)}"` }
      } catch {
        return { result: `Could not type into ref ${ref}.`, log: `failed to type into ref ${ref}` }
      }
    }

    case "scroll": {
      const dir = input.direction === "up" ? -1 : 1
      await page.mouse.wheel(0, dir * 700)
      await page.waitForTimeout(350)
      return { result: `Scrolled ${dir > 0 ? "down" : "up"}.`, log: `scrolled ${dir > 0 ? "down" : "up"}` }
    }

    case "press": {
      const key = String(input.key ?? "Tab")
      try {
        await page.keyboard.press(key)
        await page.waitForTimeout(200)
        return { result: `Pressed ${key}.`, log: `pressed ${key}` }
      } catch {
        return { result: `Could not press ${key}.`, log: `failed to press ${key}` }
      }
    }

    case "back": {
      await page.goBack({ timeout: 8000 }).catch(() => {})
      return { result: `Went back. Now at ${page.url()}`, log: "went back" }
    }

    default:
      return { result: `Unknown action ${name}.`, log: `unknown action ${name}` }
  }
}
