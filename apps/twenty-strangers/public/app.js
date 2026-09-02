/**
 * Twenty Strangers — client.
 *
 * The UI is a pure function of the event stream. Nothing here asks the server
 * for state; it only reacts to events in order. That is what lets a recorded
 * run replay through exactly the same code path as a live one.
 */

const $ = (id) => document.getElementById(id)

const els = {
  form: $("run-form"),
  target: $("target"),
  objective: $("objective"),
  runBtn: $("run-btn"),
  status: $("status"),
  stage: $("stage"),
  stageTitle: $("stage-title"),
  grid: $("grid"),
  report: $("report"),
  cancel: $("cancel-btn"),
  castGrid: $("cast-grid"),
  modal: $("persona-modal"),
  modalBody: $("modal-body"),
  modalClose: $("modal-close"),
  sampleBtn: $("sample-btn"),
  sampleBanner: $("sample-banner"),
  sampleDate: $("sample-date"),
  sampleSiteLink: $("sample-site-link"),
  sampleCtaSub: $("sample-cta-sub"),
  costNote: $("cost-note"),
  modes: $("modes"),
  codeFields: $("code-fields"),
  accessCode: $("access-code"),
  intlToggle: $("intl-toggle"),
  intlNote: $("intl-note"),
  siteType: $("site-type"),
  byoFields: $("byo-fields"),
  solariKey: $("solari-key"),
  anthropicKey: $("anthropic-key"),
}

const FLAG = { de: "🇩🇪", gb: "🇬🇧", jp: "🇯🇵", us: "🇺🇸", fr: "🇫🇷", br: "🇧🇷" }

let socket = null
const tiles = new Map()
let pricing = { paymentRequired: false, priceUsd: 0, accessCodesEnabled: false }
/** "pay" | "code" | "byo" */
let mode = "pay"

async function loadPricing() {
  try {
    pricing = await (await fetch("/api/pricing")).json()
    paintSampleMeta()
    paintWhyCharge()
  } catch {
    // Leave the default; the server is the authority either way.
  }
  paintPrice()
}

/** The button says what it will cost, before anyone clicks it. */
function paintPrice() {
  els.codeFields.hidden = mode !== "code"
  els.byoFields.hidden = mode !== "byo"

  for (const b of els.modes.querySelectorAll(".mode")) {
    const on = b.dataset.mode === mode
    b.classList.toggle("is-on", on)
    b.setAttribute("aria-checked", String(on))
  }

  if (mode === "byo") {
    els.runBtn.textContent = "Send them in"
    els.costNote.textContent = "Free — it runs on your keys and bills you directly."
    return
  }
  if (mode === "code") {
    els.runBtn.textContent = "Send them in"
    els.costNote.textContent = "Free with a valid code. One run per code."
    return
  }
  if (!pricing.paymentRequired) {
    els.runBtn.textContent = "Send them in"
    els.costNote.textContent = "Free while this is running on my keys."
    return
  }
  els.runBtn.textContent = `Send them in — $${pricing.priceUsd.toFixed(2)}`
  els.costNote.textContent =
    `$${pricing.priceUsd.toFixed(2)} per run, charged only if the run succeeds.`
}

const FAMILY_LABEL = {
  technical: "Technical",
  commerce: "Selling something",
  content: "Publishing something",
}

async function loadSiteTypes() {
  try {
    const types = await (await fetch("/api/site-types")).json()
    const byFamily = new Map()
    for (const t of types) {
      if (!byFamily.has(t.family)) byFamily.set(t.family, [])
      byFamily.get(t.family).push(t)
    }
    let html = '<option value="">What kind of site is this?</option>'
    for (const [family, items] of byFamily) {
      html += `<optgroup label="${esc(FAMILY_LABEL[family] ?? family)}">`
      html += items.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join("")
      html += "</optgroup>"
    }
    els.siteType.innerHTML = html
  } catch {
    // Leave the placeholder; the server will reject a run without a type.
  }
}

// ---------- the cast ----------
let castById = new Map()

function renderCast(personas) {
  castById = new Map(personas.map((p) => [p.id, p]))
  els.castGrid.innerHTML = personas.map(castCard).join("")
}

async function loadCast() {
  try {
    const intl = els.intlToggle.checked ? "1" : "0"
    const siteType = els.siteType?.value ? `&siteType=${encodeURIComponent(els.siteType.value)}` : ""
    const res = await fetch(`/api/personas?international=${intl}${siteType}`)
    renderCast(await res.json())
  } catch {
    els.castGrid.innerHTML = '<p class="fine">Could not load the cast.</p>'
  }
}

function deviceLabel(p) {
  const kind = p.device.isMobile ? (p.device.width >= 900 ? "tablet" : "phone") : "desktop"
  return `${kind} ${p.device.width}×${p.device.height}`
}

function castCard(p) {
  const geo = p.proxyCountry ? `${FLAG[p.proxyCountry] ?? ""} ${p.proxyCountry.toUpperCase()}` : "direct"
  return `
    <div class="cast-card" data-persona="${esc(p.id)}" tabindex="0" role="button"
         aria-label="What ${esc(p.name)} is testing for">
      <div class="top"><span>${p.emoji}</span><span class="nm">${esc(p.name)}</span></div>
      <p>${esc(p.blurb)}</p>
      <div class="spec"><span>${deviceLabel(p)}</span><span>${p.locale}</span><span>${geo}</span></div>
    </div>`
}

/**
 * The sample's site and date come from the recording itself. Nothing about
 * which site was recorded is written into the page, so swapping the recording
 * is a one-command operation with no edits here.
 */
function paintWhyCharge() {
  const el = $("why-charge")
  if (!el) return
  if (!pricing.paymentRequired) {
    el.textContent =
      "Runs are free while this is running on my keys. Bring your own API keys and it's free either way."
    return
  }
  const n = pricing.freeRunsPerDay
  const count = typeof n === "number" && n > 0 ? (n === 1 ? "One free run is" : `${n} free runs are`) : "A few free runs are"
  el.innerHTML =
    `${count} shared between everyone each day. After those are gone it's ` +
    `$${pricing.priceUsd.toFixed(2)} — that's there so a busy day can't run up an AI bill I ` +
    `can't cover, not to make money. Bring your own API keys and it's free either way.`
}

function paintSampleMeta() {
  const meta = pricing.sample
  if (!meta) return
  if (meta.recordedAt && els.sampleDate) {
    els.sampleDate.textContent = new Date(meta.recordedAt).toLocaleDateString(undefined, {
      day: "numeric", month: "long", year: "numeric",
    })
  }
  if (meta.target && els.sampleSiteLink) {
    els.sampleSiteLink.href = meta.target
    els.sampleSiteLink.textContent = hostOf(meta.target)
  }
  if (meta.target && els.sampleCtaSub) {
    els.sampleCtaSub.textContent =
      `Twenty visitors against ${hostOf(meta.target)} — free, no card, no keys.`
  }
}

// ---------- who is this person, and why ----------
const TOTAL_SITE_TYPES = 16

function openPersona(id) {
  const p = castById.get(id)
  if (!p) return
  const r = p.rationale

  const kind = p.device.isMobile ? (p.device.width >= 900 ? "tablet" : "phone") : "desktop"
  const facts = [
    `${kind} ${p.device.width}×${p.device.height}`,
    p.locale,
    p.proxyCountry ? `browsing from ${p.proxyCountry.toUpperCase()}` : "direct connection",
    `gives up after ~${p.patience} actions`,
  ]

  const on = p.appearsOn ?? []
  const where =
    on.length >= TOTAL_SITE_TYPES
      ? `<span class="all">Every kind of site.</span> Anyone can be failed this way.`
      : on.length
        ? `Turns up on ${on.length} of the ${TOTAL_SITE_TYPES} site types: ${on.map(esc).join(", ")}.`
        : `Not currently in any roster.`

  els.modalBody.innerHTML = `
    <div class="m-head">
      <span class="m-emoji">${p.emoji}</span>
      <div>
        <div class="m-name">${esc(p.name)}</div>
        <div class="m-blurb">${esc(p.blurb)}</div>
      </div>
    </div>
    ${r ? `<div class="m-tests"><strong>What they prove</strong>${esc(r.tests)}</div>` : ""}
    ${r ? `<p class="m-detail">${esc(r.detail)}</p>` : ""}
    <div class="m-section">
      <h4>How they arrive</h4>
      <div class="m-facts">${facts.map((f) => `<span class="m-fact">${esc(f)}</span>`).join("")}</div>
    </div>
    <div class="m-section">
      <h4>Where they show up</h4>
      <p class="m-where">${where}</p>
    </div>`

  els.modal.hidden = false
  els.modalClose.focus()
}

function closePersona() {
  els.modal.hidden = true
}

els.castGrid.addEventListener("click", (e) => {
  const card = e.target.closest("[data-persona]")
  if (card) openPersona(card.dataset.persona)
})
els.castGrid.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return
  const card = e.target.closest("[data-persona]")
  if (!card) return
  e.preventDefault()
  openPersona(card.dataset.persona)
})
els.modalClose.addEventListener("click", closePersona)
els.modal.addEventListener("click", (e) => {
  // Backdrop only — clicks inside the dialog must not dismiss it.
  if (e.target === els.modal) closePersona()
})
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.modal.hidden) closePersona()
})

// ---------- running ----------
els.siteType.addEventListener("change", () => {
  loadCast()
})

els.modes.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode")
  if (!btn) return
  mode = btn.dataset.mode
  paintPrice()
})

function paintIntlNote() {
  els.intlNote.textContent = els.intlToggle.checked
    ? "Lena, Eleanor, and Haruto browse from Germany, the UK, and Japan."
    : "Marisol, Frank, and Devon stand in — all browsing from the US."
}

els.intlToggle.addEventListener("change", () => {
  paintIntlNote()
  loadCast()
})

els.form.addEventListener("submit", (e) => {
  e.preventDefault()
  start()
})

// The sample needs no URL, no site type, and no objective — it is a recording.
els.sampleBtn.addEventListener("click", () => {
  els.report.hidden = true
  els.report.innerHTML = ""
  els.grid.innerHTML = ""
  tiles.clear()
  setStatus("Playing a sample run…")
  openSocket({ demo: true })
})

els.cancel.addEventListener("click", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "cancel" }))
  }
  setStatus("Stopping…")
})

async function start() {
  const target = els.target.value.trim()
  if (!target) return

  const siteType = els.siteType.value
  if (!siteType) {
    setStatus("Pick what kind of site this is — it changes what every stranger looks for.", true)
    els.siteType.focus()
    return
  }
  const objective = els.objective.value.trim()
  if (objective.length < 3) {
    setStatus("Tell them what to try to do. Without it the report is mush.", true)
    els.objective.focus()
    return
  }

  els.runBtn.disabled = true
  els.report.hidden = true
  els.report.innerHTML = ""
  els.grid.innerHTML = ""
  tiles.clear()

  if (mode === "code" && !els.accessCode.value.trim()) {
    els.runBtn.disabled = false
    setStatus("Enter your access code.", true)
    els.accessCode.focus()
    return
  }

  // A paid instance sends people to Stripe first. Codes and own keys skip it.
  if (pricing.paymentRequired && mode === "pay") {
    setStatus("Taking you to checkout…")
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target,
          objective,
          siteType,
          international: els.intlToggle.checked,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        els.runBtn.disabled = false
        return setStatus(data.error ?? "Couldn't start checkout.", true)
      }
      // Remember the form so returning from Stripe feels continuous.
      sessionStorage.setItem(
        "ts:last",
        JSON.stringify({ target, objective, siteType, international: els.intlToggle.checked }),
      )
      location.href = data.url
    } catch {
      els.runBtn.disabled = false
      setStatus("Couldn't reach checkout. You have not been charged.", true)
    }
    return
  }

  setStatus("Waking up twenty browsers…")
  openSocket({ target, objective, siteType })
}

/** Opens the run socket. `paymentSessionId` means Stripe already has a hold. */
function openSocket({ target, objective, siteType, paymentSessionId, demo }) {

  els.runBtn.disabled = true
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  socket = new WebSocket(`${proto}//${location.host}/ws`)

  socket.addEventListener("open", () => {
    const msg = demo
      ? { type: "start", demo: true }
      : paymentSessionId
      ? { type: "start", paymentSessionId }
      : {
          type: "start",
          target,
          objective,
          siteType,
          international: els.intlToggle.checked,
        }
    if (!paymentSessionId && !demo && mode === "byo") {
      msg.solariApiKey = els.solariKey.value.trim()
      msg.anthropicApiKey = els.anthropicKey.value.trim()
    }
    if (!paymentSessionId && !demo && mode === "code") {
      msg.accessCode = els.accessCode.value.trim()
    }
    socket.send(JSON.stringify(msg))
  })

  socket.addEventListener("message", (ev) => {
    let e
    try { e = JSON.parse(ev.data) } catch { return }
    handle(e)
  })

  socket.addEventListener("close", () => {
    els.runBtn.disabled = false
  })

  socket.addEventListener("error", () => {
    setStatus("Connection failed.", true)
    els.runBtn.disabled = false
  })
}

function handle(e) {
  switch (e.type) {
    case "fatal":
    case "run:error":
      setStatus(e.message, true)
      els.runBtn.disabled = false
      break

    case "run:queued":
      setStatus(
        e.position === 0
          ? "Next up — starting in a moment…"
          : `You're #${e.position} in the queue — about ${Math.ceil(e.etaSeconds / 60)} min. ` +
            `One run uses all twenty browsers, so they go one at a time.`,
      )
      break

    case "run:started":
      // The server decides the roster. Repaint the cast from what actually
      // ran, so the page can never show visitors who were not sent.
      renderCast(e.personas)
      if (typeof e.international === "boolean") {
        els.intlToggle.checked = e.international
        paintIntlNote()
      }
      els.stage.hidden = false
      els.sampleBanner.hidden = e.isSample !== true
      els.stageTitle.textContent = e.isSample
        ? `Twenty strangers looked at ${hostOf(e.target)} — recording`
        : `Twenty strangers are looking at ${hostOf(e.target)}`
      els.grid.innerHTML = ""
      for (const p of e.personas) createTile(p)
      setStatus("They're in.")
      els.stage.scrollIntoView({ behavior: "smooth", block: "start" })
      break

    case "persona:started": {
      const t = tiles.get(e.personaId)
      if (t) {
        t.root.classList.add("active")
        t.screen.innerHTML = '<span class="placeholder">opening a browser…</span>'
        t.foot.innerHTML = '<span class="pulse"></span><span class="action">arriving…</span>'
      }
      break
    }

    case "persona:frame": {
      const t = tiles.get(e.personaId)
      if (t) {
        if (!t.img) {
          t.screen.innerHTML = ""
          t.img = document.createElement("img")
          t.img.alt = ""
          t.screen.appendChild(t.img)
        }
        t.img.src = `data:image/jpeg;base64,${e.jpegBase64}`
      }
      break
    }

    case "persona:step": {
      const t = tiles.get(e.personaId)
      if (t) {
        t.foot.innerHTML = `<span class="pulse"></span><span class="action">${esc(e.action)}</span>`
      }
      break
    }

    case "persona:done": {
      const t = tiles.get(e.personaId)
      if (t) {
        const errored = Boolean(e.result.error)
        const na = Boolean(e.result.verdict.notApplicable)
        const ok = e.result.verdict.completed
        t.root.classList.remove("active")
        t.root.classList.add("done", errored ? "errored" : na ? "na" : ok ? "pass" : "fail")
        if (na && !t.img) {
          t.screen.innerHTML = '<span class="outcome-glyph na">—</span>'
        }
        if (errored) {
          t.screen.innerHTML = '<span class="outcome-glyph errored">!</span>'
          t.foot.innerHTML = '<span class="action">never arrived — not counted</span>'
          break
        }
        // Freeze the last frame if we ever got one; otherwise the tile still
        // has to say something, so it says how it ended.
        if (!t.img) {
          t.screen.innerHTML =
            `<span class="outcome-glyph ${ok ? "pass" : "fail"}">${ok ? "✓" : "✗"}</span>`
        }
        t.foot.innerHTML = `<span class="quote">“${esc(e.result.verdict.quote)}”</span>`
      }
      break
    }

    case "run:done":
      renderReport(e.report)
      setStatus("")
      els.runBtn.disabled = false
      break
  }
}

function createTile(p) {
  const root = document.createElement("div")
  root.className = "tile"
  const geo = p.proxyCountry ? (FLAG[p.proxyCountry] ?? p.proxyCountry.toUpperCase()) : ""
  root.innerHTML = `
    <div class="tile-head">
      <span class="tile-emoji">${p.emoji}</span>
      <span class="tile-name">${esc(p.name)}</span>
      <span class="tile-flag">${geo}</span>
    </div>
    <div class="tile-screen"><span class="placeholder">waiting</span></div>
    <div class="tile-foot"><span class="action">queued</span></div>`
  els.grid.appendChild(root)
  tiles.set(p.id, {
    root,
    screen: root.querySelector(".tile-screen"),
    foot: root.querySelector(".tile-foot"),
    img: null,
  })
}

// ---------- report ----------
function renderReport(r) {
  const pct = Math.round(r.completionRate * 100)
  const cls = pct >= 70 ? "good" : pct >= 40 ? "mid" : "bad"
  const secs = Math.round(r.durationMs / 1000)
  const visited = r.results.filter((x) => !x.error && !x.verdict.notApplicable)
  const done = visited.filter((x) => x.verdict.completed).length
  const errored = r.errored ?? 0
  const na = r.notApplicable ?? 0
  const naNames = r.results.filter((x) => !x.error && x.verdict.notApplicable).map((x) => x.persona.name)

  const themes = r.themes
    .map(
      (t) => `
      <div class="theme">
        <div class="theme-count">${t.raisedBy.length}×</div>
        <div class="theme-body">
          <h4>${esc(t.headline)}<span class="sev ${t.severity}">${t.severity}</span></h4>
          <p>Raised by ${esc(t.raisedBy.join(", "))}</p>
        </div>
      </div>`,
    )
    .join("")

  const naCards = r.results
    .filter((x) => !x.error && x.verdict.notApplicable)
    .map(
      (x) => `
      <div class="verdict na">
        <div class="verdict-head">
          <span>${x.persona.emoji}</span>
          <span class="name">${esc(x.persona.name)}</span>
          <span class="outcome">didn't apply · not counted</span>
        </div>
        <blockquote>“${esc(x.verdict.quote)}”</blockquote>
      </div>`,
    )
    .join("")

  const verdicts = visited
    .map((x) => {
      const ok = x.verdict.completed
      const replay = x.replayUrl
        ? `<a class="replay" href="${esc(x.replayUrl)}?who=${encodeURIComponent(x.persona.name)}" target="_blank" rel="noopener">Watch the replay →</a>`
        : ""
      return `
      <div class="verdict ${ok ? "pass" : "fail"}">
        <div class="verdict-head">
          <span>${x.persona.emoji}</span>
          <span class="name">${esc(x.persona.name)}</span>
          <span class="outcome">${ok ? "got there" : "gave up"} · ${x.steps} steps</span>
        </div>
        <blockquote>“${esc(x.verdict.quote)}”</blockquote>
        <div class="where">Stopped at ${esc(x.verdict.stoppedAt)}</div>
        ${replay}
      </div>`
    })
    .join("")

  els.report.innerHTML = `
    ${
      r.isSample
        ? `<div class="sample-banner" style="margin-bottom:22px"><strong>Recorded report.</strong> These are real findings about <a href="${esc(r.target)}" target="_blank" rel="noopener">${esc(hostOf(r.target))}</a>, not about your site. Every number below is what that run actually measured. Run it on your own URL to get yours.</div>`
        : ""
    }
    <div class="score-row">
      <div class="score">
        <span class="n ${cls}">${pct}%</span>
        <span class="l">got what they came for</span>
      </div>
      <div class="score">
        <span class="n">${done}<span style="color:var(--ink-faint)">/${visited.length}</span></span>
        <span class="l">strangers succeeded</span>
      </div>
      <div class="score">
        <span class="n">${secs}s</span>
        <span class="l">all of them, in parallel</span>
      </div>
      <div class="score">
        <span class="n">${r.themes.length}</span>
        <span class="l">${r.themes.length === 1 ? "shared problem" : "shared problems"}</span>
      </div>
    </div>
    ${errored ? `<p class="fine errored-note">${errored} stranger${errored === 1 ? "" : "s"} never reached the site (browser or model failure). They're excluded from every number above — an outage on our side isn't a finding about yours.</p>` : ""}
    ${na ? `<p class="fine na-note">${esc(naNames.join(", "))} came looking for something this kind of site wouldn't have. That's the wrong question, not a fault — they're excluded from every number above.</p>` : ""}
    <h3>What kept coming up</h3>
    ${themes || '<p class="fine">No shared friction — unusual, and a good sign.</p>'}
    <h3>What each of them said</h3>
    <div class="verdicts">${verdicts}</div>
    ${naCards ? `<h3>Came for something this kind of site wouldn't have</h3><div class="verdicts">${naCards}</div>` : ""}`
  els.report.hidden = false
  els.report.scrollIntoView({ behavior: "smooth", block: "start" })
}

// ---------- helpers ----------
function setStatus(text, isError = false) {
  els.status.textContent = text
  els.status.classList.toggle("error", isError)
}

function hostOf(u) {
  try { return new URL(u).hostname } catch { return u }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  )
}

/**
 * Coming back from Stripe. The run's details live in the payment's metadata on
 * the server side, so all we carry back is the session id.
 */
function resumeAfterCheckout() {
  const params = new URLSearchParams(location.search)
  const paid = params.get("paid")
  const canceled = params.get("canceled")

  // Clean the URL so a refresh cannot try to redeem a spent payment.
  if (paid || canceled) history.replaceState({}, "", location.pathname)

  if (canceled) {
    setStatus("Checkout cancelled — you have not been charged.")
    return
  }
  if (!paid) return

  try {
    const last = JSON.parse(sessionStorage.getItem("ts:last") ?? "{}")
    if (last.target) els.target.value = last.target
    if (last.objective) els.objective.value = last.objective
    if (last.siteType) els.siteType.value = last.siteType
    if (typeof last.international === "boolean") {
      els.intlToggle.checked = last.international
      paintIntlNote()
    }
  } catch {
    // Cosmetic only.
  }
  sessionStorage.removeItem("ts:last")

  setStatus("Payment held. Sending them in…")
  openSocket({ paymentSessionId: paid })
}

loadSiteTypes()
loadPricing()
loadCast()
resumeAfterCheckout()
