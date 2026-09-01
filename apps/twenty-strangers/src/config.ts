/**
 * Runtime configuration and the guard rails that keep a public demo from
 * eating a $20 credit balance in an afternoon.
 *
 * Every limit here is deliberately conservative. A single swarm run holds
 * TWENTY concurrent browsers, which is the entire Starter-plan quota, so the
 * server can only ever have one house-funded run in flight. That is not a
 * limitation to work around — it is the reason the queue exists.
 */

import "dotenv/config"

export type ModelId = string

function env(name: string, fallback?: string): string {
  const v = process.env[name]
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback
    throw new Error(`Missing required env var ${name}`)
  }
  return v
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

export const config = {
  port: intEnv("PORT", 8080),

  /** Canned runs, real UI, zero spend. Lets the demo work with no keys at all. */
  mock: process.env.TS_MOCK === "1",

  solariApiKey: process.env.SOLARI_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** Required when the Anthropic key is identity-linked; harmless otherwise. */
  anthropicWorkspaceId: process.env.ANTHROPIC_WORKSPACE_ID ?? "",

  browseModel: env("TS_BROWSE_MODEL", "claude-haiku-4-5-20251001") as ModelId,
  verdictModel: env("TS_VERDICT_MODEL", "claude-haiku-4-5-20251001") as ModelId,

  swarm: {
    /** The brand promise. Configurable, but 20 is the whole point. */
    size: intEnv("TS_SWARM_SIZE", 20),
    /** Never exceed the plan's concurrent-browser ceiling. */
    maxConcurrentBrowsers: intEnv("TS_MAX_CONCURRENT_BROWSERS", 20),
    /** Hard cap on agent steps per persona. The single most effective cost lever. */
    maxStepsPerPersona: intEnv("TS_MAX_STEPS", 12),
    /** Wall-clock ceiling per persona, independent of step count. */
    personaTimeoutMs: intEnv("TS_PERSONA_TIMEOUT_MS", 120_000),
    /** Whole-run ceiling. Cuts losses if a site hangs every persona at once. */
    runTimeoutMs: intEnv("TS_RUN_TIMEOUT_MS", 240_000),
  },

  limits: {
    /** House-funded runs per IP per rolling window. */
    runsPerIpPerDay: intEnv("TS_RUNS_PER_IP_PER_DAY", 2),
    /** House-funded runs against one target domain per rolling window. Stops
     *  the tool being pointed at someone else's site over and over. */
    runsPerTargetPerDay: intEnv("TS_RUNS_PER_TARGET_PER_DAY", 3),
    /** Total house-funded runs per day across everyone. The real budget dial. */
    runsPerDay: intEnv("TS_RUNS_PER_DAY", 40),
    /** Queue depth before we start refusing politely. */
    maxQueueDepth: intEnv("TS_MAX_QUEUE_DEPTH", 8),
  },

  access: {
    /**
     * Comma-separated single-use codes. Each is good for exactly one run on
     * the house keys, free, without the holder ever seeing an API key.
     * Never commit real codes — these live in .env.
     */
    codes: (process.env.TS_ACCESS_CODES ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
    /** Where spent codes are recorded so a restart cannot un-spend them. */
    stateDir: process.env.TS_STATE_DIR ?? ".state",
  },

  billing: {
    /**
     * What one run costs a visitor, in dollars. THE pricing dial — change this
     * and nothing else.
     *
     * $2 is chosen against measured costs: a run costs roughly $0.45-$0.65 in
     * Solari and Anthropic spend, and Stripe takes 2.9% + $0.30. At $2 that
     * leaves about $1.10 after everything, and stays positive even on an
     * expensive run. At $1 the fixed 30c fee alone is 30% of the transaction
     * and an expensive run breaks even or loses money.
     */
    runPriceUsd: Number(process.env.TS_RUN_PRICE_USD ?? "2.00"),
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
    /** Absolute origin Stripe returns visitors to. */
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "",
  },

  /** Rough per-run cost estimate, shown in the UI so the spend is never a
   *  surprise. Sourced from the Starter-plan rate card. */
  pricing: {
    browserUsdPerHour: 0.1,
    proxyUsdPerGb: 1.0,
  },
} as const

/** Keys can arrive per-request (bring-your-own) or from the environment. */
export interface Credentials {
  solariApiKey: string
  anthropicApiKey: string
  /** True when the visitor supplied their own keys, which exempts them from
   *  the house budget limits — they are spending their own money. */
  bringYourOwn: boolean
}

export function houseCredentials(): Credentials | null {
  if (config.mock) {
    return { solariApiKey: "mock", anthropicApiKey: "mock", bringYourOwn: false }
  }
  if (!config.solariApiKey || !config.anthropicApiKey) return null
  return {
    solariApiKey: config.solariApiKey,
    anthropicApiKey: config.anthropicApiKey,
    bringYourOwn: false,
  }
}
