/**
 * Guard rails for pointing twenty browsers at a URL a stranger typed.
 *
 * Three separate concerns, deliberately kept apart:
 *
 *   1. Target validation — is this even a legitimate public web address?
 *      Blocks private ranges and cloud metadata endpoints so the tool cannot
 *      be used to probe an internal network.
 *   2. robots.txt — we are an automated client. We behave like one.
 *   3. Action safety — the personas are *explorers*. They read, scroll, and
 *      follow links. They never submit real data and never take an action
 *      that cannot be undone.
 *
 * The third is enforced in the action layer rather than trusted to the prompt,
 * because a model told "please don't click Buy" will eventually click Buy.
 */

import { promises as dns } from "node:dns"
import net from "node:net"

export class UnsafeTargetError extends Error {}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
])

/** Cloud metadata + loopback + link-local, which no public site legitimately uses. */
function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number)
    const [a = 0, b = 0] = parts
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true // link-local + AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v === "::1" || v === "::") return true
    if (v.startsWith("fc") || v.startsWith("fd")) return true // unique local
    if (v.startsWith("fe80")) return true // link-local
    // IPv4-mapped, e.g. ::ffff:127.0.0.1
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped?.[1]) return isPrivateAddress(mapped[1])
    return false
  }
  return false
}

export interface SafeTarget {
  url: string
  hostname: string
  origin: string
}

/**
 * Normalise and vet a user-supplied target. Resolves DNS and rejects anything
 * that points inside a private network.
 */
export async function validateTarget(raw: string): Promise<SafeTarget> {
  const trimmed = raw.trim()
  if (!trimmed) throw new UnsafeTargetError("Enter a URL to test.")

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new UnsafeTargetError(`"${raw}" is not a valid URL.`)
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeTargetError("Only http and https URLs can be tested.")
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "")

  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
    throw new UnsafeTargetError("That address is not reachable from the public internet.")
  }
  if (!hostname.includes(".")) {
    throw new UnsafeTargetError("That doesn't look like a public domain.")
  }
  // A bare IP literal skips DNS but still needs the private-range check.
  if (net.isIP(hostname) && isPrivateAddress(hostname)) {
    throw new UnsafeTargetError("Private network addresses can't be tested.")
  }

  if (!net.isIP(hostname)) {
    let addrs: string[]
    try {
      const res = await dns.lookup(hostname, { all: true })
      addrs = res.map((r) => r.address)
    } catch {
      throw new UnsafeTargetError(`Couldn't resolve ${hostname}. Is the domain right?`)
    }
    if (addrs.length === 0) throw new UnsafeTargetError(`Couldn't resolve ${hostname}.`)
    // Every resolved address must be public — a domain that resolves to both
    // is a rebinding attempt.
    for (const a of addrs) {
      if (isPrivateAddress(a)) {
        throw new UnsafeTargetError("That domain resolves to a private address.")
      }
    }
  }

  return { url: url.toString(), hostname, origin: url.origin }
}

export const USER_AGENT_TOKEN = "TwentyStrangersBot"

/**
 * Minimal robots.txt check for our own token and `*`. Deliberately
 * conservative: any parse failure or network error is treated as "allowed",
 * but an explicit Disallow that matches is honoured.
 */
export async function robotsAllows(target: SafeTarget): Promise<{ allowed: boolean; reason?: string }> {
  let body: string
  try {
    const res = await fetch(`${target.origin}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": USER_AGENT_TOKEN },
    })
    if (!res.ok) return { allowed: true }
    body = await res.text()
  } catch {
    return { allowed: true }
  }

  const path = new URL(target.url).pathname || "/"
  let applies = false
  let matched: string | null = null

  for (const line of body.split(/\r?\n/)) {
    const clean = line.split("#")[0]?.trim() ?? ""
    if (!clean) continue
    const [rawKey, ...rest] = clean.split(":")
    const key = rawKey?.trim().toLowerCase()
    const value = rest.join(":").trim()

    if (key === "user-agent") {
      const ua = value.toLowerCase()
      applies = ua === "*" || ua === USER_AGENT_TOKEN.toLowerCase()
    } else if (key === "disallow" && applies && value) {
      if (path.startsWith(value)) matched = value
    } else if (key === "allow" && applies && value && path.startsWith(value)) {
      // A more specific Allow wins, which is the common convention.
      if (matched && value.length >= matched.length) matched = null
    }
  }

  if (matched !== null) {
    return { allowed: false, reason: `robots.txt disallows ${matched} for automated clients.` }
  }
  return { allowed: true }
}

/**
 * Labels that indicate an action with real-world consequences. Enforced in the
 * action layer: if a persona tries to click one of these, the click is refused
 * and recorded as "stopped at the point of no return" — which is usually the
 * correct end of the journey anyway.
 */
const IRREVERSIBLE = [
  /\bbuy\s*now\b/i,
  /\bplace\s+order\b/i,
  /\bcomplete\s+(purchase|order)\b/i,
  /\bpay\b/i,
  /\bcheckout\b/i,
  /\bsubscribe\b/i,
  /\bconfirm\b/i,
  /\bdelete\b/i,
  /\bcancel\s+(subscription|account|plan)\b/i,
  /\bsubmit\b/i,
  /\bsend\s+message\b/i,
  /\bpublish\b/i,
  /\bupgrade\b/i,
]

export function isIrreversibleLabel(label: string): boolean {
  const t = label.trim()
  if (!t) return false
  return IRREVERSIBLE.some((re) => re.test(t))
}

/** Never let a persona type anything that looks like real personal data. */
export const SYNTHETIC_IDENTITY = {
  email: "stranger@example.invalid",
  name: "Test Stranger",
  phone: "+15555550100",
} as const

const PII_SHAPES = [
  /\b\d{13,19}\b/,                        // card-ish
  /\b\d{3}-\d{2}-\d{4}\b/,                // SSN-ish
  /@(?!example\.invalid)[\w.-]+\.\w{2,}/, // any real-looking email
]

export function scrubTypedText(text: string): { text: string; blocked: boolean } {
  if (PII_SHAPES.some((re) => re.test(text))) {
    return { text: SYNTHETIC_IDENTITY.email, blocked: true }
  }
  return { text, blocked: false }
}
