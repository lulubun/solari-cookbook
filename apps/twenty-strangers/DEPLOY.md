# Deploying Twenty Strangers to Railway

A long-lived container with websockets. Not serverless — a run holds twenty
browsers open for a minute and streams frames the whole time.

## 1. Create the service

In Railway: **New Project → Deploy from GitHub repo** → pick this fork.

Then, in the service's **Settings**:

| Setting | Value |
|---|---|
| Root Directory | `apps/twenty-strangers` |
| Builder | Dockerfile (auto-detected from `railway.json`) |

The root directory matters. This repo is a fork of the Solari cookbook, so the
app is not at the top level and Railway will otherwise try to build the wrong
thing.

## 2. Add a volume — do not skip this

Volumes are not under Settings. Press **⌘K** for the command palette and search
**"volume"**, or right-click anywhere on the project canvas. Attach it to this
service with mount path `/data`.

Single-use access codes are recorded to `TS_STATE_DIR` (which the image sets to
`/data`). Without a volume, container storage is ephemeral: every redeploy
silently un-spends every code you have ever handed out, and a code you gave
someone last week works again.

`numReplicas` is pinned to 1 for two reasons. Railway does not allow replicas
alongside a volume at all, so this is a hard requirement rather than a
preference — and independently, the burnt-code list, the run queue, the rate
limits, and the replay cache all live in one process's memory, so a second
replica would keep its own copy of each and quietly double every limit.

On the free plan you get 0.5GB and one volume per project, which is ample: the
burnt-code file is a few hundred bytes.

If the deploy logs show permission errors writing to `/data`, Railway is running
the container as non-root. Set `RAILWAY_RUN_UID=0` to fix it. This image does
not set `USER`, so it should already run as root.

## 3. Environment variables

Required:

```
SOLARI_API_KEY=slr_live_...
ANTHROPIC_API_KEY=sk-ant-...
```

Set after the first deploy, once Railway has given you a domain:

```
PUBLIC_BASE_URL=https://<your-app>.up.railway.app
```

`PUBLIC_BASE_URL` is where Stripe returns people after checkout. It must be the
real public origin — get it from **Settings → Networking → Generate Domain**,
then set this and redeploy. Payments stay switched off until both it and
`STRIPE_SECRET_KEY` are set, and the app runs fine without them.

Optional:

```
STRIPE_SECRET_KEY=sk_test_...     # test key first; live needs verification
TS_RUN_PRICE_USD=2.00             # the only pricing dial
TS_ACCESS_CODES=code1,code2       # single-use, one run each
TS_RUNS_PER_DAY=4                 # free house-funded runs per day, all visitors
TS_RUNS_PER_IP_PER_DAY=2
TS_MAX_QUEUE_DEPTH=8
```

Do not set `PORT` — Railway provides it.

## 4. Check it came up

```
GET /api/health
```

```json
{ "ok": true, "mock": false, "housekeys": true, "paymentRequired": false,
  "accessCodes": { "configured": 1, "burnt": 0 } }
```

- `housekeys: false` → the Solari or Anthropic key is missing
- `paymentRequired: false` with a Stripe key set → `PUBLIC_BASE_URL` is missing
- `accessCodes.burnt` resetting to 0 after a deploy → the volume is not mounted

## 5. Costs to keep an eye on

A real run is about $0.50 of Solari and Anthropic spend, so `TS_RUNS_PER_DAY=4`
caps the free tier near $2/day. Sample runs are recordings and cost nothing, so
they are unlimited. Railway itself is a small always-on container.

## Re-recording the sample

The sample is a real recorded run, held in `src/sample-run.json`. To point it at
a different site, run this locally and commit the result — Railway redeploys and
picks it up. Nothing else needs editing.

```bash
npx tsx scripts/record-sample.ts https://example.com portfolio "what they should try to do"
```
