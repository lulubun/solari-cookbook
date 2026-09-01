import "dotenv/config"
import Stripe from "stripe"
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const pis = await stripe.paymentIntents.list({ limit: 5, expand: ["data.latest_charge"] })
for (const pi of pis.data) {
  const ch = pi.latest_charge as Stripe.Charge | null
  console.log(`${pi.id}  status=${pi.status.padEnd(16)} received=${pi.amount_received}`)
  if (ch) {
    console.log(`   charge captured=${ch.captured}  amount=${ch.amount}  amount_captured=${ch.amount_captured}  refunded=${ch.refunded}  status=${ch.status}`)
  }
}
