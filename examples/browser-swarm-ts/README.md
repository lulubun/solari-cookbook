# Browser swarm (TypeScript)

Visit many pages at once with a worker pool, and treat `ConcurrencyLimitExceeded`
as the ordinary condition it is rather than a crash.

A pool beats `Promise.all` here: the target list can be longer than your plan's
concurrent-session limit and the swarm simply runs in waves, instead of spending
the run racing itself for slots.

Set `CONCURRENCY` at or below your plan's limit — 3 on Free, 20 on Starter,
150 on Professional.

## Run

```bash
cd examples/browser-swarm-ts
npm install
export SOLARI_API_KEY=slr_live_...   # https://console.getsolari.com
npm start
```

Source: [`index.ts`](index.ts)
