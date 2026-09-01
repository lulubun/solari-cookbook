/**
 * What kind of site is this?
 *
 * Twenty strangers arriving at an API reference want completely different
 * things than twenty strangers arriving at a florist's shop. Without knowing
 * which, the personas default to SaaS-shaped assumptions and produce findings
 * that are technically true and practically useless — "I couldn't find the
 * pricing tiers" is not a helpful note about a museum's opening hours.
 *
 * Site types are grouped into three FAMILIES. Families are what personas
 * branch their behaviour on, because the difference that matters to a visitor
 * is "am I buying, learning, or reading" — not the twelve-way distinction.
 * The specific type still reaches the prompt, so a persona on a booking site
 * knows to look for availability rather than a cart.
 */

export type SiteFamily = "commerce" | "technical" | "content"

export interface SiteType {
  id: string
  label: string
  family: SiteFamily
  /** What a successful visit usually ends in. */
  primaryAction: string
  /** What visitors to this kind of site routinely check. */
  expectations: string[]
}

export const SITE_TYPES: SiteType[] = [
  {
    id: "saas",
    label: "SaaS product",
    family: "technical",
    primaryAction: "understand the product and start a trial or sign up",
    expectations: [
      "what the product actually does, in plain language",
      "transparent pricing and whether there is a free tier",
      "proof it is credible — customers, security, uptime",
    ],
  },
  {
    id: "api-docs",
    label: "API or developer documentation",
    family: "technical",
    primaryAction: "find how to do a specific thing and see working code",
    expectations: [
      "a quickstart that gets to a first working call fast",
      "searchable reference with real request and response examples",
      "authentication, errors, rate limits, and versioning",
    ],
  },
  {
    id: "open-source",
    label: "Open source project",
    family: "technical",
    primaryAction: "judge whether the project is alive and worth adopting",
    expectations: [
      "what it does and how it differs from alternatives",
      "install steps and a minimal example",
      "signs of maintenance — recent activity, issues, licence",
    ],
  },
  {
    id: "online-store",
    label: "Online store",
    family: "commerce",
    primaryAction: "find a product and understand the cost of getting it",
    expectations: [
      "product details, sizing or specs, and real photographs",
      "total price including shipping, plus delivery times",
      "returns, refunds, and whether other people trust this shop",
    ],
  },
  {
    id: "local-business",
    label: "Local business with a physical location",
    family: "commerce",
    primaryAction: "find the address, opening hours, and how to get in touch",
    expectations: [
      "address, map, parking, and accessibility of the premises",
      "opening hours, including today's",
      "phone number, and what they actually sell or do",
    ],
  },
  {
    id: "booking",
    label: "Booking or reservations",
    family: "commerce",
    primaryAction: "check availability and understand what booking commits you to",
    expectations: [
      "real availability for actual dates, not a contact form",
      "the full price before committing, including fees",
      "cancellation terms and what happens if plans change",
    ],
  },
  {
    id: "marketing-site",
    label: "Company or startup marketing site",
    family: "content",
    primaryAction: "work out what this company does and whether to care",
    expectations: [
      "a clear statement of what is being offered",
      "who is behind it and whether they are real",
      "an obvious next step for an interested visitor",
    ],
  },
  {
    id: "news-publication",
    label: "News site or publication",
    family: "content",
    primaryAction: "read something without being buried in interruptions",
    expectations: [
      "the article, reachable and readable",
      "who wrote it, when, and on whose authority",
      "how much of it is behind a paywall or ad wall",
    ],
  },
  {
    id: "social-network",
    label: "Social network or online community",
    family: "content",
    primaryAction: "understand what happens here and whether to join",
    expectations: [
      "what people actually post, visible before signing up",
      "how big and how active the community is",
      "moderation, safety, and what happens to your data",
    ],
  },
  {
    id: "nonprofit",
    label: "Nonprofit or charity",
    family: "content",
    primaryAction: "understand the cause and how to help",
    expectations: [
      "what the organisation does and who it helps",
      "where donations actually go, with evidence",
      "an obvious way to donate or volunteer",
    ],
  },
  {
    id: "education",
    label: "Course, school, or educational site",
    family: "content",
    primaryAction: "work out what is taught, to whom, and at what cost",
    expectations: [
      "curriculum, level, and time commitment",
      "cost, funding, and admissions or enrolment steps",
      "who teaches it and what outcomes people get",
    ],
  },
  {
    id: "portfolio",
    label: "Personal site or portfolio",
    family: "content",
    primaryAction: "work out who this person is and what they can do",
    expectations: [
      "actual work, not just descriptions of work",
      "what they are currently looking for",
      "a way to get in touch",
    ],
  },
]

export const DEFAULT_SITE_TYPE = "saas"

export function siteTypeById(id: string): SiteType | undefined {
  return SITE_TYPES.find((t) => t.id === id)
}
