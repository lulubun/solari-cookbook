/**
 * What kind of site is this, and what does that kind of site even have?
 *
 * Site types alone are not enough. The useful question is not "is this a
 * school or a shop" but "does this site have prices, accounts, documentation,
 * a physical address" — because that is what decides whether a given visitor
 * makes any sense at all.
 *
 * A visitor who only wants to log in is absurd on a site with no accounts. A
 * visitor hunting for the price is absurd where nothing is sold. Rather than
 * writing twenty personas times sixteen site types of special cases, each site
 * type declares its CAPABILITIES and each persona declares what it depends on.
 * Personas whose dependency is missing are stood down and replaced by someone
 * the site can actually frustrate.
 *
 * Families remain, because behaviour that survives the capability check still
 * differs between buying, learning, and reading.
 */

export type SiteFamily = "commerce" | "technical" | "content"

export interface SiteCapabilities {
  /** Users can have an account and sign in. */
  accounts: boolean
  /** Things here have a price. */
  pricing: boolean
  /** You can actually transact on the site. */
  purchase: boolean
  /** Technical documentation is a thing this site would have. */
  docs: boolean
  /** A support or help channel is reasonable to expect. */
  support: boolean
  /** A physical place matters — address, hours, getting there. */
  location: boolean
  /** A searchable catalogue of entries is the point. */
  listings: boolean
  /** Written content is the product, not the wrapper. */
  editorial: boolean
  /** Sold to organisations, so SSO and compliance are fair questions. */
  enterprise: boolean
  /** Hiring information is plausibly present. */
  careers: boolean
  /** Dates, schedules, and attendance matter. */
  events: boolean
}

export interface SiteType {
  id: string
  label: string
  family: SiteFamily
  /** What a successful visit usually ends in. */
  primaryAction: string
  /** What visitors to this kind of site routinely check. */
  expectations: string[]
  has: SiteCapabilities
}

/** Everything off; each type switches on only what it really has. */
const NONE: SiteCapabilities = {
  accounts: false, pricing: false, purchase: false, docs: false, support: false,
  location: false, listings: false, editorial: false, enterprise: false,
  careers: false, events: false,
}
const caps = (o: Partial<SiteCapabilities>): SiteCapabilities => ({ ...NONE, ...o })

export const SITE_TYPES: SiteType[] = [
  // ---------------- technical ----------------
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
    has: caps({ accounts: true, pricing: true, purchase: true, docs: true, support: true, enterprise: true, careers: true }),
  },
  {
    id: "api-docs",
    label: "API or developer documentation",
    family: "technical",
    primaryAction: "find how to do a specific thing and see working code",
    expectations: [
      "a quickstart that reaches a first working call quickly",
      "searchable reference with real requests and responses",
      "authentication, errors, rate limits, and versioning",
    ],
    has: caps({ accounts: true, docs: true, support: true, listings: true, enterprise: true }),
  },
  {
    id: "open-source",
    label: "Open source project",
    family: "technical",
    primaryAction: "judge whether the project is alive and worth adopting",
    expectations: [
      "what it does and how it differs from the alternatives",
      "install steps and a minimal working example",
      "signs of maintenance — recent activity, issues, licence",
    ],
    has: caps({ docs: true, support: true, editorial: true }),
  },

  // ---------------- commerce ----------------
  {
    id: "online-store",
    label: "E-commerce store",
    family: "commerce",
    primaryAction: "find a product and understand the cost of getting it",
    expectations: [
      "product details, sizing or specs, and real photographs",
      "total price including shipping, plus delivery times",
      "returns, refunds, and whether other people trust this shop",
    ],
    has: caps({ accounts: true, pricing: true, purchase: true, support: true, listings: true, careers: true }),
  },
  {
    id: "local-business",
    label: "Local business with a physical location",
    family: "commerce",
    primaryAction: "find the address, opening hours, and how to get in touch",
    expectations: [
      "address, map, parking, and whether the premises are accessible",
      "opening hours, including today's",
      "a phone number, and what they actually sell or do",
    ],
    has: caps({ pricing: true, support: true, location: true, careers: true }),
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
    has: caps({ accounts: true, pricing: true, purchase: true, support: true, location: true, events: true }),
  },
  {
    id: "directory",
    label: "Directory or listings",
    family: "commerce",
    primaryAction: "find a specific listing and act on it",
    expectations: [
      "search and filters that actually narrow things down",
      "listings with enough detail to choose between them",
      "how current the listings are, and who vouches for them",
    ],
    has: caps({ accounts: true, support: true, location: true, listings: true }),
  },

  // ---------------- content ----------------
  {
    id: "business-corporate",
    label: "Business or corporate site",
    family: "content",
    primaryAction: "work out what this company does and how to contact them",
    expectations: [
      "what the company offers, in concrete terms",
      "who they are and whether they are credible",
      "a real way to get in touch",
    ],
    has: caps({ support: true, location: true, enterprise: true, careers: true, pricing: true }),
  },
  {
    id: "landing-page",
    label: "Landing page (single call to action)",
    family: "content",
    primaryAction: "understand one offer and decide whether to take it",
    expectations: [
      "one clear thing being offered",
      "what happens if you click the button",
      "enough proof to make that click reasonable",
    ],
    has: caps({ pricing: true, support: true }),
  },
  {
    id: "blog-news",
    label: "Blog or news publication",
    family: "content",
    primaryAction: "read something without being buried in interruptions",
    expectations: [
      "the article itself, reachable and readable",
      "who wrote it, when, and on whose authority",
      "how much sits behind a paywall or an ad wall",
    ],
    has: caps({ accounts: true, editorial: true, listings: true, careers: true }),
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
    has: caps({ accounts: true, support: true, editorial: true, listings: true, careers: true }),
  },
  {
    id: "education",
    label: "Course, school, or educational site",
    family: "content",
    primaryAction: "work out what is taught, to whom, and at what cost",
    expectations: [
      "what is taught, at what level, and over how long",
      "cost or funding, and how you enrol or apply",
      "who teaches it and what people get out of it",
    ],
    has: caps({ accounts: true, pricing: true, support: true, location: true, editorial: true, careers: true, events: true }),
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
    has: caps({ purchase: true, support: true, location: true, editorial: true, careers: true, events: true }),
  },
  {
    id: "event",
    label: "Event site",
    family: "content",
    primaryAction: "work out what is on, when, where, and how to attend",
    expectations: [
      "dates, times, and the actual schedule",
      "venue, travel, and access",
      "how to register, RSVP, or buy a ticket",
    ],
    has: caps({ pricing: true, purchase: true, support: true, location: true, events: true, editorial: true }),
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
    has: caps({ support: true, editorial: true }),
  },
  {
    id: "info-reference",
    label: "Information or reference site",
    family: "content",
    primaryAction: "find one specific fact and leave",
    expectations: [
      "the fact you came for, quickly",
      "when it was last updated and who maintains it",
      "navigation that does not assume you already know the structure",
    ],
    has: caps({ support: true, location: true, editorial: true, listings: true }),
  },
]

export const DEFAULT_SITE_TYPE = "saas"

export function siteTypeById(id: string): SiteType | undefined {
  return SITE_TYPES.find((t) => t.id === id)
}

/** Human phrasing for each capability, for telling a visitor what is absent. */
const CAPABILITY_LABEL: Record<keyof SiteCapabilities, string> = {
  accounts: "user accounts or a sign-in",
  pricing: "prices",
  purchase: "any way to buy or transact",
  docs: "technical documentation",
  support: "a customer support channel",
  location: "a physical location to visit",
  listings: "a searchable catalogue of listings",
  editorial: "articles or written content as its purpose",
  enterprise: "enterprise or organisational sales",
  careers: "hiring or careers information",
  events: "dates, schedules, or events",
}

/**
 * What this kind of site simply does not have.
 *
 * Handing this to a visitor as fact is far more reliable than hoping they
 * infer it. Left to work it out, a visitor who only wants to sign in will
 * hunt a personal portfolio for a login and then report its absence as a
 * blocking fault — a fabricated finding about a site that was never supposed
 * to have one.
 */
export function absentCapabilities(site: SiteType): string[] {
  return (Object.keys(site.has) as Array<keyof SiteCapabilities>)
    .filter((k) => !site.has[k])
    .map((k) => CAPABILITY_LABEL[k])
}
