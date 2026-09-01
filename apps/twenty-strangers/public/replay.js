/**
 * Plays a captured session back in the page.
 *
 * Solari records rrweb events, so the replay is a real DOM reconstruction —
 * you see the page as the persona saw it, not a video of it. The player is
 * bundled locally rather than pulled from a CDN so replays keep working
 * offline and behind strict content policies.
 */
const sessionId = decodeURIComponent(location.pathname.replace(/^\/replay\//, ""))
const shell = document.getElementById("shell")
const msg = document.getElementById("msg")
const meta = document.getElementById("meta")
const who = document.getElementById("who")

const params = new URLSearchParams(location.search)
if (params.get("who")) who.textContent = `Replay — ${params.get("who")}`

function fail(text) {
  msg.textContent = text
  msg.classList.add("replay-msg")
}

;(async () => {
  let events
  try {
    const res = await fetch(`/api/replay/${encodeURIComponent(sessionId)}`)
    if (res.status === 404) {
      return fail(
        "That replay is no longer held in memory. Replays are kept only for a while after a run — re-run the swarm to capture fresh ones.",
      )
    }
    if (!res.ok) return fail(`Couldn't load the replay (HTTP ${res.status}).`)
    events = await res.json()
  } catch (e) {
    return fail("Couldn't load the replay.")
  }

  if (!Array.isArray(events) || events.length < 2) {
    return fail("This session was too short to replay — the persona never got far enough to record anything.")
  }

  const first = events[0]?.timestamp
  const last = events[events.length - 1]?.timestamp
  if (first && last) {
    meta.textContent = `${events.length} events · ${((last - first) / 1000).toFixed(1)}s`
  }

  shell.innerHTML = ""
  const width = Math.min(shell.clientWidth - 32, 1200)

  // The UMD bundle exports the ES module namespace, so the constructor is on
  // `.default` — the bare global is a plain object and `new`-ing it throws.
  const Player = window.rrwebPlayer?.default ?? window.rrwebPlayer?.Player ?? window.rrwebPlayer
  if (typeof Player !== "function") {
    return fail("The replay player failed to load.")
  }

  try {
    new Player({
      target: shell,
      props: {
        events,
        width,
        height: Math.round(width * 0.62),
        autoPlay: true,
        showController: true,
      },
    })
  } catch (e) {
    console.error("rrweb-player failed:", e)
    fail(`The replay loaded but the player couldn't render it: ${e?.message ?? e}`)
  }
})()
