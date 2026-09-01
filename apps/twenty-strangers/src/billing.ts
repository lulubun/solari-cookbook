/**
 * Pay-per-run billing, with no accounts and nothing stored.
 *
 * The shape:
 *   1. Visitor fills in the form and clicks run.
 *   2. We validate the target FIRST — nobody gets charged for a typo'd URL.
 *   3. Stripe Checkout opens, hosted by Stripe. We never see a card.
 *   4. The charge is AUTHORISED, not captured. Money is held, not taken.
 *   5. The visitor returns and the swarm runs.
 *   6. Success captures the authorisation. Failure voids it, and the visitor
 *      is charged nothing at all.
 *
 * Voiding beats refunding: Stripe keeps its fixed fee on a refund, so a
 * refunded failure costs about thirty cents even though the customer is made
 * whole. A voided authorisation costs nothing.
 *
 * There is deliberately NO database. The run parameters ride along in the
 * Checkout Session's metadata, which makes Stripe the store of record — so a
 * restart, a redeploy, or a crash between payment and run loses nothing. The
 * PaymentIntent's own status is the replay guard: once captured or cancelled
 * it is no longer `requires_capture`, so one payment cannot buy two runs.
 */

import Stripe from "stripe"
import type { RunRequest } from "./engine/types.js"

export interface BillingConfig {
  secretKey: string
  /** What one run costs the visitor, in dollars. The only pricing dial. */
  priceUsd: number
  /** Absolute origin used to build Stripe's return URLs. */
  publicBaseUrl: string
}

export class Billing {
  private readonly stripe: Stripe
  readonly priceCents: number
  private readonly baseUrl: string

  constructor(cfg: BillingConfig) {
    this.stripe = new Stripe(cfg.secretKey)
    this.priceCents = Math.round(cfg.priceUsd * 100)
    this.baseUrl = cfg.publicBaseUrl.replace(/\/$/, "")
  }

  get priceUsd(): number {
    return this.priceCents / 100
  }

  /**
   * Open a Checkout Session for one run. The run's parameters travel in
   * metadata so nothing needs storing on our side.
   */
  async createCheckout(req: RunRequest): Promise<{ url: string; sessionId: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: this.priceCents,
            product_data: {
              name: "Twenty Strangers — one run",
              description: `Twenty AI visitors report on ${hostOf(req.target)}`,
            },
          },
        },
      ],
      payment_intent_data: {
        // Hold the money; take it only if the run actually happens.
        capture_method: "manual",
        description: `Twenty Strangers — ${hostOf(req.target)}`,
      },
      metadata: {
        target: req.target.slice(0, 480),
        objective: req.objective.slice(0, 480),
        siteType: req.siteType,
        international: req.international ? "1" : "0",
        swarmSize: String(req.swarmSize),
      },
      success_url: `${this.baseUrl}/?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.baseUrl}/?canceled=1`,
    })

    if (!session.url) throw new Error("Stripe did not return a checkout URL.")
    return { url: session.url, sessionId: session.id }
  }

  /**
   * Confirm a returning visitor really has an authorised, unspent payment, and
   * recover the run they paid for.
   */
  async redeem(
    sessionId: string,
  ): Promise<
    { ok: true; paymentIntentId: string; request: RunRequest } | { ok: false; reason: string }
  > {
    let session: Stripe.Checkout.Session
    try {
      session = await this.stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      })
    } catch {
      return { ok: false, reason: "We couldn't find that payment." }
    }

    const pi = session.payment_intent
    if (!pi || typeof pi === "string") {
      return { ok: false, reason: "That payment isn't ready yet. Give it a moment and refresh." }
    }

    // `requires_capture` is the only state meaning: authorised, not yet spent.
    // Anything else is unpaid, already used, or cancelled.
    if (pi.status !== "requires_capture") {
      const reason =
        pi.status === "succeeded"
          ? "That payment has already been used for a run."
          : pi.status === "canceled"
            ? "That payment was cancelled, so nothing was charged."
            : "That payment didn't complete, so nothing was charged."
      return { ok: false, reason }
    }

    const m = session.metadata ?? {}
    if (!m.target || !m.siteType) {
      return { ok: false, reason: "That payment is missing its run details." }
    }

    return {
      ok: true,
      paymentIntentId: pi.id,
      request: {
        target: m.target,
        objective: m.objective ?? "",
        siteType: m.siteType,
        international: m.international === "1",
        swarmSize: Number(m.swarmSize) || 20,
      },
    }
  }

  /** Take the money. Called only once a run has actually produced a report. */
  async capture(paymentIntentId: string): Promise<void> {
    await this.stripe.paymentIntents.capture(paymentIntentId)
  }

  /** Release the hold. The visitor is charged nothing and owed no refund. */
  async voidAuthorization(paymentIntentId: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(paymentIntentId)
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
