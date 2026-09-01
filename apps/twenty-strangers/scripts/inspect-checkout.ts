import "dotenv/config"
import Stripe from "stripe"
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const list = await stripe.checkout.sessions.list({ limit: 1, expand: ["data.payment_intent"] })
const s = list.data[0]
if (!s) { console.log("no sessions"); process.exit(1) }
const pi = s.payment_intent as Stripe.PaymentIntent | null
console.log("session      :", s.id)
console.log("status       :", s.status, "| payment_status:", s.payment_status)
console.log("amount_total :", s.amount_total, s.currency)
console.log("capture mode :", pi?.capture_method ?? "(no PI until paid)")
console.log("pi status    :", pi?.status ?? "-")
console.log("metadata     :", JSON.stringify(s.metadata))
console.log("success_url  :", s.success_url)
console.log("cancel_url   :", s.cancel_url)
