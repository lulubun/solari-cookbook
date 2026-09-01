# Twenty Strangers

**Send twenty strangers to your website and watch where they give up.**

Twenty cloud browsers open at once. Each one carries a different person — a
different screen, a different country, a different reason for showing up. You
watch all twenty at the same time, then read where every one of them gave up.

Built on [Solari](https://getsolari.com).

---

## Telling it what it's looking at

Two things are required before a run, because without them the report is mush.

**What they should be trying to do.** Twenty personas with no goal wander, and
wandering produces observations rather than findings.

**What kind of site this is.** This is the one that changes everything. Twenty
strangers arriving at an API reference want completely different things than
twenty arriving at a florist's, and judging a museum's opening-hours page by
whether it has transparent pricing tiers is worse than useless.

Site types are grouped into three families — *technical*, *selling something*,
*publishing something* — and personas branch their behaviour on the family,
because the distinction that matters to a visitor is whether they are buying,
learning, or reading. The specific type still reaches the prompt, so a persona
on a booking site looks for availability rather than a cart.

Yuki is the clearest case. On a SaaS site he ignores the marketing and hunts
for the docs, which is exactly right. At an online store that would be absurd,
so the same technically-minded person instead asks whether the search actually
works, whether the filters do anything, whether the product data is complete,
and whether checkout looks trustworthy. Eleven of the twenty branch this way.

## Visitors from abroad, optionally

Three of the twenty browse from Germany, the UK, and Japan through residential
proxies, which is how you find consent-banner obstruction, missing currency and
regional information, and copy that assumes a US audience.

They are also the only ones that cost proxy bandwidth, and they are irrelevant
if you only trade domestically — so they can be switched off. Doing that swaps
in three domestic stand-ins rather than shrinking the swarm, chosen to carry
the same weight: Marisol wants social proof, Frank expects things to be
labelled and is defeated by icon-only navigation, and Devon only cares whether
this fits the tools he already has.

## Watching what they saw

Every visit is recorded and plays back in the browser as a real DOM
reconstruction — you see the page as that persona saw it, at their viewport,
with their cursor, scrubbable.

Solari's own replay link is a presigned URL that serves gzipped NDJSON with
download headers, so clicking it hands you a `.ndjson.gz` your browser will not
open. The data underneath is rrweb, which is eminently playable; it just needs
a player pointed at it. So each visit's events are captured when the session is
released and served back through a bundled player. That also means a visitor
running on their own API key gets working replays without this server ever
holding their credentials.

## Why twenty

One agent visiting your site tells you almost nothing. It either completed the
task or it didn't, and either way you learn one anecdote.

Twenty tells you something real, because they disagree in useful ways. When
eleven independent visitors all fail to find your pricing, that isn't an
anecdote any more — it's a fact about your site, and facts are worth counting.

The twenty are chosen so their failures don't overlap. Between them they cover
findability, mobile layout, consent-banner damage, keyboard access, jargon, and
the dead ends people hit when they need to reach a human. Each carries a real
viewport, a real locale, and — for the visitors from Germany, the UK, and Japan
— a real residential egress in that country, so the page they see is the page
that country actually gets.

Then the findings are clustered. You don't get twenty opinions; you get a
ranked list of the handful of things that kept coming up, ordered by how many
strangers independently hit them.

## What a run costs

**About 50 cents, and about 35 seconds.** Those are measured, not estimated.

A real twenty-persona run against `getsolari.com`:

| | |
|---|---|
| Wall clock | **32.7s** for all twenty, in parallel |
| Cost | **$0.571** |
| Browser time | $0.012 — *2% of the bill* |
| Model tokens | $0.559 — *98% of the bill* |
| Live frames streamed | 158 |
| Session replays captured | 19/20 |

The split is worth dwelling on, because it is the opposite of what you would
guess. Twenty cloud browsers running for half a minute cost about one penny;
Solari is not the expensive part of this by any margin. Essentially the entire
bill is the model deciding what to click.

That is what makes the cost levers what they are. Observations are text rather
than screenshots, the step cap is hard, and the loop runs on Haiku — all three
exist to hold down token spend, because token spend *is* the spend. Prompt
caching (system prompt plus a sliding breakpoint over the accumulated
conversation) trims a further ~14%; the visits are short enough that there is
not much more to win there.

The exact number is shown at the end of every run. It's not hidden, because
"this cost 49 cents" is a more interesting claim than "this was fast".

## Three ways to run one

**Pay per run.** $2, charged only if the run works. Covered below.

**An access code.** A single-use code runs on the house API keys, free, and the
holder never sees a key. Each code is good for exactly one run and is
meaningless afterwards. Codes live in `TS_ACCESS_CODES` and are never committed.

Spent codes are written to disk under `TS_STATE_DIR`, because in memory alone a
restart would quietly make every spent code live again — not a small bug for
something whose entire contract is "one run". A code is *reserved* while its run
is in flight and only *burnt* once a report exists; a failed run hands it back,
since a code lost to a crash has no refund path.

**Your own API keys.** Free, unlimited by us, billed to you by Solari and
Anthropic directly. Keys are used for that run and never stored.

## Paying for a run

$2, charged only if the run actually works. No account, no email, no
subscription, no balance to top up — and nothing to pay if you bring your own
API keys.

The flow is deliberately boring: validate the URL, send you to Stripe's own
hosted checkout, bring you back, run the swarm. Cards never touch this server.

The one non-obvious choice is that the charge is **authorised, not captured**.
Stripe places a hold when you pay; the money is only taken once a report
exists. If the run fails, the authorisation is voided and you are charged
nothing at all. That is strictly better than charging and refunding, because
Stripe keeps its fixed fee on a refund — a refunded failure would cost about
thirty cents even though you were made whole.

There is also no database. The run's details ride in the Checkout Session's
metadata, which makes Stripe the store of record: a restart, a redeploy, or a
crash between paying and running loses nothing. That metadata is also the only
source of the run parameters when you return, so a payment for one site cannot
be redirected at another. The PaymentIntent's own status is the replay guard —
once captured it is no longer `requires_capture`, so one payment cannot buy two
runs.

### Why $2

A run costs $0.45–$0.65 in Solari and Anthropic spend, and Stripe takes
2.9% + $0.30. That fixed 30¢ is what decides the price: at $1 it is 30% of the
transaction before any compute is paid for, and an expensive run breaks even or
loses money. At $2 the margin is about $1.10 and stays positive even on a bad
run.

`TS_RUN_PRICE_USD` is the only pricing dial. Leave `STRIPE_SECRET_KEY` unset
entirely and the app runs free with house rate limits, exactly as it did
before.

## How it works

```
Browser UI ──ws── Node server ── RunEngine (mode: "swarm")
                      │              └─ 20 × PersonaRun
                      ├─ queue          ├─ solari.launch({stealth, proxy, recording})
                      ├─ rate limits    ├─ Claude loop: a11y outline → one action
                      └─ budget guard   ├─ CDP screencast → live thumbnail
                                        └─ verdict + session replay
```

**The UI is a pure function of the event stream.** Nothing in the browser asks
the server for state; it only reacts to events in order. That's what lets a
recorded run replay through exactly the same code path as a live one, and it's
why mock mode is a genuine test rather than a separate stub.

**Observations are text, not pixels.** Each step sends a compact, ref-tagged
outline of what's visible — headings, interactive elements, a little body copy.
It's roughly 60× cheaper than sending an image and, for questions like "can I
find the pricing", strictly more reliable. Screenshots are still captured, but
for *you* to watch, not for the model to read.

**The live grid is a CDP screencast**, not a screenshot poll. The browser
pushes frames as the page changes instead of us paying a round trip per frame,
which is what makes twenty simultaneous thumbnails affordable.

**The queue is load-bearing, not decoration.** Twenty concurrent browsers is
the *entire* Starter-plan ceiling, so the server can run exactly one
house-funded swarm at a time. Rather than hiding that, it's surfaced as a
position and an ETA. Visitors who bring their own keys spend against their own
plan and skip the queue entirely.

## Things that bit, encoded here

- **`proxy` and `captcha` both require `stealth: true`.** A proxied request
  from an obviously-automated browser is the exact pairing that gets blocked.
- **`ConcurrencyLimitExceeded` is a normal condition, not a bug.** A swarm
  sized to the plan ceiling races itself while earlier sessions are still
  releasing. It backs off and retries instead of dropping the persona.
- **Recording is per session.** Without `recording: true` at launch, the replay
  endpoint 404s forever.
- **The replay only exists after release.** `browser.close()` releases the
  session; the replay lands a second or three later, so it's polled.
- **`solari.close()` is mandatory in Node.** The client holds a loopback proxy
  open for the retry path, and that handle keeps the event loop alive — skip it
  and the process prints its output and then hangs.

## Safety

Pointing twenty AI agents at a URL a stranger typed is a mild abuse vector, so:

- **The personas are explorers, not operators.** They read, scroll, follow
  links, and use the keyboard. They never buy, submit, send, publish, or
  delete. This is enforced in the action layer, not asked for in the prompt,
  because a model told "please don't click Buy" will eventually click Buy.
  A refused click is recorded as reaching the point of no return — which is
  usually the correct end of the journey anyway.
- **Anything that looks like personal data is replaced** with a synthetic
  placeholder before it can be typed.
- **Targets are resolved and vetted.** Private ranges, loopback, link-local,
  and cloud metadata endpoints are rejected, including domains that resolve to
  a mix of public and private addresses.
- **robots.txt is honoured** for our own token and `*`.
- **Rate limits** apply per IP, per target domain, and globally per day, so the
  tool can't be aimed repeatedly at someone else's site on the house budget.

Only point it at sites you own or public marketing pages.

## Running it

```bash
cd apps/twenty-strangers
npm install
```

Try the whole thing with no keys and no spend:

```bash
TS_MOCK=1 npm start
```

Then open <http://localhost:8080>. Mock mode drives the real UI from a canned
event stream — useful for development, and it's what the public demo falls back
to when the daily budget is spent.

For live runs, copy `.env.example` to `.env` and fill in:

```bash
SOLARI_API_KEY=slr_live_...   # https://console.getsolari.com
ANTHROPIC_API_KEY=sk-ant-...  # https://console.anthropic.com
npm start
```

Every limit is tunable by environment variable — swarm size, step cap, per-IP
and per-day budgets, timeouts. See [`src/config.ts`](src/config.ts).

## Deploying

A long-lived process with websockets, so a container rather than serverless.
The included `Dockerfile` and `railway.json` deploy as-is to Railway; anything
that runs a container works the same way. Set `SOLARI_API_KEY` and
`ANTHROPIC_API_KEY`, or leave them unset and let every visitor bring their own.

## What's next

`RunMode` exists so a second mode can drop in over the same fan-out, live grid,
and event stream. The obvious one is **Agent Arena** — several models racing
head-to-head on the same web task, same twenty tiles, different scoring.

MIT licensed.
