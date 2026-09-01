/**
 * One stranger's visit, start to finish.
 *
 * The loop is ordinary: observe the page, ask the model for one action, run
 * it, repeat. What makes the output useful is the framing — the model is not
 * "an agent completing a task", it is a specific person with a temperament, a
 * device, and one thing they came to find out. That framing is what turns
 * "clicked 4 links" into "I could not find the price anywhere".
 *
 * Two independent budgets bound every visit: the persona's own patience (in
 * steps) and a wall-clock timeout. Whichever hits first ends the visit, and an
 * exhausted budget is itself a finding — someone who ran out of patience is a
 * person who bounced.
 */

import type Anthropic from "@anthropic-ai/sdk"
import type { Page } from "patchright-core"
import type { Persona } from "../personas.js"
import { missionFor } from "../personas.js"
import type { SiteType } from "../site-types.js"
import { absentCapabilities } from "../site-types.js"
import type { Verdict, Friction } from "../engine/types.js"
import { observe } from "./observe.js"
import { executeAction, TOOLS } from "./actions.js"
import { TokenMeter } from "./llm.js"

export interface LoopOptions {
  client: Anthropic
  model: string
  persona: Persona
  objective: string
  target: string
  site: SiteType
  maxSteps: number
  deadline: number
  meter: TokenMeter
  signal: AbortSignal
  onStep: (step: number, thought: string, action: string) => void
}

function systemPrompt(p: Persona, objective: string, target: string, site: SiteType): string {
  return [
    `You are ${p.name}. ${p.blurb}`,
    ``,
    `You have just landed on ${target} for the first time.`,
    ``,
    `WHAT KIND OF SITE THIS IS`,
    `${site.label}. People come here to ${site.primaryAction}.`,
    `Visitors to this kind of site routinely check:`,
    ...site.expectations.map((e) => `  - ${e}`),
    `Judge it as this kind of site. Do not fault a ${site.label.toLowerCase()} for`,
    `lacking things that belong on a different kind of site entirely.`,
    ...(() => {
      const absent = absentCapabilities(site)
      if (absent.length === 0) return []
      return [
        ``,
        `THIS KIND OF SITE DOES NOT HAVE:`,
        ...absent.map((a) => `  - ${a}`),
        `These are not missing. They were never expected here. Do NOT report their`,
        `absence as friction. If the thing you came for is one of them, your errand`,
        `does not apply to this site: call finish with not_applicable set to true,`,
        `an empty frictions list, and say plainly that you came to the wrong sort`,
        `of place. That is a useful, honest outcome and counts against nobody.`,
      ]
    })(),
    ``,
    `WHO YOU ARE`,
    p.temperament,
    ``,
    `WHAT YOU CAME FOR`,
    `${missionFor(p, site)}`,
    `The person who asked for this visit wants to know: ${objective}`,
    ``,
    `YOUR SITUATION`,
    `- Screen: ${p.device.width}x${p.device.height}${p.device.isMobile ? " (mobile, touch)" : " (desktop)"}`,
    `- Language: ${p.locale}`,
    p.proxyCountry ? `- You are browsing from ${p.proxyCountry.toUpperCase()}.` : ``,
    `- Your patience runs out after about ${p.patience} actions. That is realistic. Do not fight it.`,
    ``,
    `HOW TO BEHAVE`,
    `- Take ONE action at a time. Every turn you get a fresh outline of the page.`,
    `- Elements you can act on are marked [n]. Use that number as the ref.`,
    `- Stay in character. Judge the site as this person would, not as a QA engineer.`,
    `- You are exploring, not transacting. You will never buy, submit, or send anything.`,
    `- Call finish the moment you have your answer OR the moment you would genuinely give up.`,
    `- Giving up early is a valid, useful outcome. Do not pretend to succeed.`,
    ``,
    `WHAT IS NOT A FAULT`,
    `Moving from one page of a site to another page of the same site is ordinary`,
    `navigation working correctly — never report it as a dead link or a link that`,
    `"went nowhere". You are told after every click whether the page actually`,
    `changed; trust that rather than your impression. Only call a link broken when`,
    `you are told the page did not change at all. If you expected a link to lead`,
    `somewhere other than where it went, say what made you expect that — the label,`,
    `its position, an icon — because that mismatch is the real finding.`,
    ``,
    `If what you came looking for is not something this KIND of site would have at`,
    `all, that is not a fault either. Say so by setting not_applicable, and do not`,
    `list it as friction. Looking for a company's funding on one person's own site`,
    `is the wrong question, not a missing page.`,
    ``,
    `REPORT ONLY WHAT YOU SAW`,
    `You looked at a handful of pages for a few seconds. That is enough to say`,
    `what YOU could not find. It is NOT enough to say a thing does not exist.`,
    `Write "I couldn't find a way to contact support" — never "there is no`,
    `contact page". You may well have missed it, and claiming otherwise turns a`,
    `fair observation into a false accusation about someone's website.`,
    ``,
    `When you call finish, your "quote" should sound like a real person talking,`,
    `not a report. One sentence. Specific to what you actually saw.`,
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Last resort only — used when we cannot even ask for a verdict (cancelled
 * run, dead model call). Running out of patience does NOT come here; that
 * path asks the persona for a real verdict instead, because "I ran out of
 * patience" as boilerplate is the most common outcome and would otherwise be
 * the most common thing anyone reads.
 */
function fallbackVerdict(reason: string, persona: Persona): Verdict {
  return {
    completed: false,
    stoppedAt: reason,
    quote: `I gave up before I got anywhere useful.`,
    frictions: [
      {
        kind: "findability",
        detail: `${persona.name} ran out of patience before finding what they came for`,
        severity: "major",
      },
    ],
  }
}

/**
 * Ask a persona who has run out of steps for their honest verdict, forcing the
 * finish tool so we get a real answer rather than another action.
 */
async function forceVerdict(
  client: Anthropic,
  model: string,
  persona: Persona,
  objective: string,
  target: string,
  site: SiteType,
  messages: Anthropic.MessageParam[],
  meter: TokenMeter,
  signal: AbortSignal,
): Promise<Verdict | null> {
  try {
    const res = await client.messages.create(
      {
        model,
        max_tokens: 1024,
        system: systemPrompt(persona, objective, target, site),
        tools: TOOLS,
        tool_choice: { type: "tool", name: "finish" },
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "You have run out of patience. Stop exploring and give your honest verdict " +
              "now, based only on what you actually saw.",
          },
        ],
      },
      { signal },
    )
    meter.add(res.usage)
    const use = res.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
    if (!use || use.name !== "finish") return null
    const inp = use.input as {
      completed?: boolean
      not_applicable?: boolean
      stopped_at?: string
      quote?: string
      frictions?: Friction[]
    }
    return {
      completed: Boolean(inp.completed),
      notApplicable: Boolean(inp.not_applicable),
      stoppedAt: String(inp.stopped_at ?? "ran out of patience"),
      quote: String(inp.quote ?? "").trim() || "I gave up before I got anywhere useful.",
      frictions: Array.isArray(inp.frictions) ? inp.frictions : [],
    }
  } catch {
    return null
  }
}

export async function runPersonaLoop(page: Page, opts: LoopOptions): Promise<{ verdict: Verdict; steps: number }> {
  const { client, model, persona, meter, signal } = opts
  const maxSteps = Math.min(opts.maxSteps, persona.patience)

  const messages: Anthropic.MessageParam[] = []
  let step = 0

  const first = await observe(page)
  messages.push({
    role: "user",
    content:
      `You are on ${first.url} — "${first.title}"\n\n` +
      (first.consentWallLikely ? `NOTE: there appears to be a cookie or consent banner in the way.\n\n` : ``) +
      `What you can see:\n${first.outline}\n\nTake one action.`,
  })

  while (step < maxSteps) {
    if (signal.aborted) return { verdict: fallbackVerdict("the run was cancelled", persona), steps: step }
    if (Date.now() > opts.deadline) {
      return { verdict: fallbackVerdict("ran out of time on a slow page", persona), steps: step }
    }

    step++

    // The conversation is resent in full on every step, so cost grows
    // quadratically with visit length. Two cache breakpoints flatten it: the
    // system prompt never changes within a visit, and a sliding breakpoint on
    // the most recent tool result turns the whole accumulated prefix into a
    // cache read (0.1x) instead of fresh input (1x) on the following step.
    const res = await client.messages.create(
      {
        model,
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: systemPrompt(persona, opts.objective, opts.target, opts.site),
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: TOOLS,
        tool_choice: { type: "any" },
        messages,
      },
      { signal },
    )
    meter.add(res.usage)

    const toolUse = res.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
    const textBlock = res.content.find((c): c is Anthropic.TextBlock => c.type === "text")
    const thought = textBlock?.text?.trim() ?? ""

    if (!toolUse) {
      return { verdict: fallbackVerdict("stopped responding", persona), steps: step }
    }

    if (toolUse.name === "finish") {
      const inp = toolUse.input as {
        completed?: boolean
        not_applicable?: boolean
        stopped_at?: string
        quote?: string
        frictions?: Friction[]
      }
      opts.onStep(step, thought, "delivered their verdict")
      return {
        verdict: {
          completed: Boolean(inp.completed),
          notApplicable: Boolean(inp.not_applicable),
          stoppedAt: String(inp.stopped_at ?? "unclear"),
          quote: String(inp.quote ?? "").trim() || "No comment.",
          frictions: Array.isArray(inp.frictions) ? inp.frictions : [],
        },
        steps: step,
      }
    }

    const outcome = await executeAction(page, toolUse.name, toolUse.input as Record<string, unknown>)
    opts.onStep(step, thought, outcome.log)

    const next = await observe(page).catch(() => null)
    const budgetLeft = maxSteps - step

    const observation = next
      ? `${outcome.result}\n\n` +
        `You are on ${next.url} — "${next.title}"\n` +
        (next.scrollProgress < 0.9 ? `(there is more page below you)\n` : ``) +
        `\nWhat you can see:\n${next.outline}\n\n` +
        (budgetLeft <= 2
          ? `You are nearly out of patience — ${budgetLeft} action(s) left. Wrap up and call finish.\n`
          : ``) +
        `Take one action.`
      : `${outcome.result}\n\nThe page did not respond. Take one action.`

    messages.push({ role: "assistant", content: res.content })
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: observation,
          cache_control: { type: "ephemeral" },
        },
      ],
    })

    // Only the newest breakpoint is worth holding — drop the previous one so we
    // stay well inside the four-breakpoint limit.
    for (let i = messages.length - 3; i >= 0; i--) {
      const m = messages[i]
      if (!m || m.role !== "user" || !Array.isArray(m.content)) continue
      let cleared = false
      for (const block of m.content) {
        if (block.type === "tool_result" && block.cache_control) {
          delete block.cache_control
          cleared = true
        }
      }
      if (cleared) break
    }

    // Keep the context from growing without bound on long visits: only the
    // two most recent observations carry their full outline.
    if (messages.length > 8) {
      const stale = messages[messages.length - 6]
      if (stale && stale.role === "user" && Array.isArray(stale.content)) {
        for (const block of stale.content) {
          if (block.type === "tool_result" && typeof block.content === "string") {
            block.content = block.content.slice(0, 300) + "\n[earlier page detail trimmed]"
          }
        }
      }
    }
  }

  // Out of steps. Ask for a real verdict rather than emitting boilerplate.
  const forced = await forceVerdict(
    client, model, persona, opts.objective, opts.target, opts.site, messages, meter, signal,
  )
  return { verdict: forced ?? fallbackVerdict("used up their patience", persona), steps: step }
}
