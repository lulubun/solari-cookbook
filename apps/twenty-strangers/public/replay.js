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
const account = document.getElementById("account")

/**
 * The persona's own account of the visit, beside the recording.
 *
 * rrweb captures DOM changes only, so anything that happened in the agent —
 * a refused click, a model error, patience running out — is invisible in the
 * video. Without this panel a replay of a failed visit looks like a placid
 * page and reads as a broken recording.
 */
function renderAccount(meta) {
  const steps = (meta.steps ?? [])
    .map(
      (s) =>
        `<li><span class="t">${(s.atMs / 1000).toFixed(1)}s</span> <span class="a">${esc(s.action)}</span></li>`,
    )
    .join("")

  account.innerHTML = `
    <div class="acct-head">
      <span class="acct-emoji">${esc(meta.emoji ?? "")}</span>
      <div>
        <div class="acct-name">${esc(meta.personaName ?? "")}</div>
        <div class="acct-mission">${esc(meta.mission ?? "")}</div>
      </div>
      <span class="acct-outcome ${meta.completed ? "pass" : "fail"}">${meta.completed ? "got there" : "gave up"}</span>
    </div>
    ${meta.quote ? `<blockquote>“${esc(meta.quote)}”</blockquote>` : ""}
    ${meta.stoppedAt ? `<p class="fine">Stopped at ${esc(meta.stoppedAt)}</p>` : ""}
    ${meta.error ? `<p class="acct-error">This visit failed: ${esc(meta.error)}</p>` : ""}
    <h3>What they did</h3>
    <ol class="acct-steps">${steps || "<li class=\"fine\">No actions recorded.</li>"}</ol>
    <p class="fine acct-note">
      The recording captures what the <em>page</em> did. Anything that happened
      inside the visitor — a refused click, a model error, patience running out —
      shows up here rather than in the video.
    </p>`
  account.hidden = false
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  )
}

const params = new URLSearchParams(location.search)
if (params.get("who")) who.textContent = `Replay — ${params.get("who")}`

function fail(text) {
  msg.textContent = text
  msg.classList.add("replay-msg")
}

;(async () => {
  let events, meta
  try {
    const res = await fetch(`/api/replay/${encodeURIComponent(sessionId)}`)
    if (res.status === 404) {
      return fail(
        "That replay is no longer held in memory. Replays are kept only for a while after a run — re-run the swarm to capture fresh ones.",
      )
    }
    if (!res.ok) return fail(`Couldn't load the replay (HTTP ${res.status}).`)
    const payload = await res.json()
    events = payload.events
    meta = payload.meta
  } catch (e) {
    return fail("Couldn't load the replay.")
  }

  if (meta) renderAccount(meta)

  if (!Array.isArray(events) || events.length < 2) {
    return fail(
      meta?.error
        ? `This visit ended early: ${meta.error}`
        : "This session was too short to replay — the persona never got far enough to record anything.",
    )
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
