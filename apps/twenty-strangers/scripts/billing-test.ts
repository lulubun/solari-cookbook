/**
 * Exercises the billing code paths against Stripe's test API.
 *
 * Uses API-level test payment tokens rather than typing card numbers into
 * Stripe's hosted form. That covers the parts this repo is responsible for —
 * authorise, redeem, capture, void — without depending on a browser, and it
 * tests states (a failed run voiding a hold) that are awkward to reach by hand.
 */
import "dotenv/config"
import Stripe from "stripe"
import { Billing } from "../src/billing.js"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const billing = new Billing({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  priceUsd: 2,
  publicBaseUrl: "http://localhost:8080",
})

let fails = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) fails++
}

const req = {
  target: "https://books.toscrape.com/",
  objective: "find a book and work out the total cost",
  siteType: "online-store",
  international: false,
  swarmSize: 20,
}

console.log("\n[1] an unpaid checkout session cannot be redeemed")
const { sessionId } = await billing.createCheckout(req)
const early = await billing.redeem(sessionId)
check("unpaid session refused", !early.ok, early.ok ? "" : early.reason)

console.log("\n[2] authorise → capture (the successful-run path)")
const pi1 = await stripe.paymentIntents.create({
  amount: 200, currency: "usd",
  payment_method: "pm_card_visa",
  capture_method: "manual",
  confirm: true,
  automatic_payment_methods: { enabled: true, allow_redirects: "never" },
})
check("authorised, money held not taken", pi1.status === "requires_capture", `status=${pi1.status}`)
check("amount held is $2.00", pi1.amount === 200, `${pi1.amount} cents`)
check("nothing captured yet", pi1.amount_received === 0, `received=${pi1.amount_received}`)

await billing.capture(pi1.id)
const after1 = await stripe.paymentIntents.retrieve(pi1.id)
check("capture succeeds", after1.status === "succeeded", `status=${after1.status}`)
check("customer charged $2.00", after1.amount_received === 200, `received=${after1.amount_received}`)

console.log("\n[3] authorise → void (the failed-run path)")
const pi2 = await stripe.paymentIntents.create({
  amount: 200, currency: "usd",
  payment_method: "pm_card_visa",
  capture_method: "manual",
  confirm: true,
  automatic_payment_methods: { enabled: true, allow_redirects: "never" },
})
check("authorised", pi2.status === "requires_capture", `status=${pi2.status}`)
await billing.voidAuthorization(pi2.id)
const after2 = await stripe.paymentIntents.retrieve(pi2.id)
check("void succeeds", after2.status === "canceled", `status=${after2.status}`)
check("customer charged NOTHING", after2.amount_received === 0, `received=${after2.amount_received}`)
// Stripe DOES create a charge object for an authorisation. What matters is
// that it was never captured and never refunded — a refund would have cost the
// fixed fee, which is the whole reason this voids instead.
const ch2 = after2.latest_charge
  ? await stripe.charges.retrieve(String(after2.latest_charge))
  : null
check("charge was never captured", ch2?.captured === false, `captured=${String(ch2?.captured)}`)
check("nothing was captured", ch2?.amount_captured === 0, `amount_captured=${String(ch2?.amount_captured)}`)
check("no refund was needed (so no fee lost)", ch2?.refunded === false, `refunded=${String(ch2?.refunded)}`)

console.log("\n[4] a captured payment cannot buy a second run")
try {
  await billing.capture(pi1.id)
  check("double capture rejected", false, "it succeeded, which it must not")
} catch {
  check("double capture rejected", true)
}

console.log(`\n${fails === 0 ? "✅ all billing checks passed" : `❌ ${fails} failed`}`)
process.exit(fails === 0 ? 0 : 1)
