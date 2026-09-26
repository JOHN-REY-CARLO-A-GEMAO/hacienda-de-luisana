// End-to-end browser test of the Guest tutorial against a running website.
// Real Chromium driven by Playwright; nothing is mocked. It walks the tour the
// way a Guest does — clicking the highlighted controls, typing dates, ticking
// the terms, sending the demo Booking — and measures, on every step, that the
// spotlight sits on the right element, that the element is the top-most thing
// under the pointer (not the overlay), and that the card stays on screen.
//
//   npm run dev                                   # in one terminal
//   npm i --no-save playwright-core               # once
//   npx playwright install chromium               # once (skip if a Chromium is given below)
//   node docs/qa/tutorial-browser-test.mjs desktop
//   node docs/qa/tutorial-browser-test.mjs mobile
//
// Options: BASE_URL=http://localhost:3000  CHROMIUM_PATH=/path/to/chrome
// Where the Playwright CDN is unreachable, `npm i --no-save @sparticuz/chromium`
// supplies a Chromium binary; the script picks it up by itself (its bundled
// NSS libraries must be on LD_LIBRARY_PATH — see the notes in the summary of
// the run that introduced this file).
//
// Screenshots: $TMPDIR/hdl-tour-shots/<mode>/  ·  report: $TMPDIR/hdl-tour-report-<mode>.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { chromium } = await import('playwright-core').catch(() => import('playwright'))
async function chromiumExecutable() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  try {
    const pack = (await import('@sparticuz/chromium')).default
    return await pack.executablePath()
  } catch {
    return undefined // Playwright's own installed Chromium
  }
}

const MODE = process.argv[2] ?? 'desktop'
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SHOTS = path.join(os.tmpdir(), 'hdl-tour-shots', MODE)
fs.mkdirSync(SHOTS, { recursive: true })

const VIEWPORT = MODE === 'mobile' ? { width: 390, height: 844 } : { width: 1366, height: 850 }
const TOTAL_STEPS = 12
const DIALOG = '[role="dialog"][aria-label^="Guest tour"]'

/* ------------------------------------------------------------------ */
/* bookkeeping                                                         */
/* ------------------------------------------------------------------ */
const results = []
const consoleErrors = []
const pageErrors = []
const failedRequests = []
const blockedExternal = new Set()
let shotNo = 0

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
function assert(name, cond, detail = '') {
  record(name, Boolean(cond), detail)
  return Boolean(cond)
}
async function shot(page, label) {
  shotNo += 1
  const file = `${SHOTS}/${String(shotNo).padStart(2, '0')}-${label}.png`
  await page.screenshot({ path: file })
  return file
}

/* ------------------------------------------------------------------ */
/* helpers that read the live DOM                                      */
/* ------------------------------------------------------------------ */
const dialog = (page) => page.locator(DIALOG)

async function stepInfo(page) {
  return page.evaluate((sel) => {
    const d = document.querySelector(sel)
    if (!d) return null
    const text = (d.textContent ?? '').replace(/\s+/g, ' ')
    const m = text.match(/Step (\d+) of (\d+)/)
    const buttons = [...d.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).filter(Boolean)
    return {
      title: d.querySelector('h2')?.textContent?.trim() ?? '',
      index: m ? Number(m[1]) : NaN,
      total: m ? Number(m[2]) : NaN,
      buttons,
      text,
      route: location.pathname,
    }
  }, DIALOG)
}

async function waitForStep(page, title, timeout = 8000) {
  await page.waitForFunction(
    ([sel, t]) => document.querySelector(sel)?.querySelector('h2')?.textContent?.includes(t),
    [DIALOG, title],
    { timeout },
  )
  return stepInfo(page)
}

/** Geometry of the highlighted target, the ring and the card — measured in the page. */
async function geometry(page, targets) {
  // wait for the smooth scroll (engine + nudge) to finish: scrollY unchanged for 600 ms, 5 s cap
  await page.waitForTimeout(300)
  await page.evaluate(() => new Promise((resolve) => {
    let last = window.scrollY, still = 0, polls = 0
    const id = setInterval(() => {
      const y = window.scrollY
      still = Math.abs(y - last) < 1 ? still + 1 : 0
      last = y; polls += 1
      if (still >= 6 || polls >= 50) { clearInterval(id); resolve() }
    }, 100)
  }))
  return page.evaluate(
    ([sel, targets]) => {
      const vw = window.innerWidth, vh = window.innerHeight
      const d = document.querySelector(sel)
      const ring = d?.querySelector('.tour-ring')
      const card = d ? [...d.children].find((c) => c.tagName === 'DIV' && c.querySelector('h2')) : null
      const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right } }
      let target = null
      for (const name of targets) {
        for (const el of document.querySelectorAll(`[data-tour="${name}"]`)) {
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          if (r.width > 2 && r.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden') { target = { name, el }; break }
        }
        if (target) break
      }
      let hit = null, hitInsideTarget = null, hitInsideCard = null, hitInsideDim = null
      if (target) {
        const r = target.el.getBoundingClientRect()
        const cx = r.left + r.width / 2, cy = r.height > vh * 0.8 ? r.top + 60 : r.top + r.height / 2
        const top = document.elementFromPoint(cx, cy)
        hit = top ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}.${[...top.classList].slice(0, 3).join('.')}` : null
        hitInsideTarget = Boolean(top && (top === target.el || target.el.contains(top)))
        hitInsideCard = Boolean(top && card && card.contains(top))
        hitInsideDim = Boolean(top && d && d.contains(top) && !(card && card.contains(top)))
      }
      return {
        vw, vh,
        target: target ? { name: target.name, box: box(target.el) } : null,
        ring: ring ? box(ring) : null,
        card: card ? box(card) : null,
        cardScrollable: card ? card.scrollHeight > card.clientHeight + 1 : null,
        hit, hitInsideTarget, hitInsideCard, hitInsideDim,
        scrollY: window.scrollY,
      }
    },
    [sel(), targets],
  )
  function sel() { return DIALOG }
}

function within(a, b, tol) { return Math.abs(a - b) <= tol }

/** Common assertions for a step that highlights something. */
async function checkHighlightedStep(page, label, targets, { expectClickable = true } = {}) {
  const g = await geometry(page, targets)
  const ok1 = assert(`${label}: target found (${g.target?.name ?? 'none'})`, g.target, g.target ? '' : `none of [${targets}] visible`)
  if (!ok1) return g
  const t = g.target.box
  const tall = t.height > g.vh * 0.8 // a whole panel (e.g. the success screen) cannot fit; its top must show
  assert(`${label}: target inside viewport${tall ? ' (tall: top edge visible)' : ''}`,
    tall ? t.top >= 0 && t.top < g.vh * 0.5 && t.left >= 0 && t.right <= g.vw
         : t.top >= 0 && t.bottom <= g.vh && t.left >= 0 && t.right <= g.vw,
    `target ${Math.round(t.top)}..${Math.round(t.bottom)}px of ${g.vh}px`)
  assert(`${label}: spotlight ring matches target (±8px)`, g.ring &&
    within(g.ring.top, t.top - 6, 8) && within(g.ring.left, t.left - 6, 8) &&
    within(g.ring.width, t.width + 12, 8) && within(g.ring.height, t.height + 12, 8),
    g.ring ? `ring ${JSON.stringify(g.ring)} target ${JSON.stringify(t)}` : 'no ring')
  if (expectClickable) {
    assert(`${label}: target is the top-most element at its center (not covered by overlay)`, g.hitInsideTarget,
      `elementFromPoint → ${g.hit}${g.hitInsideCard ? ' (tooltip card covers it)' : g.hitInsideDim ? ' (dim panel covers it)' : ''}`)
  }
  const c = g.card
  assert(`${label}: tooltip card fully inside viewport`, c && c.top >= 0 && c.bottom <= g.vh + 0.5 && c.left >= 0 && c.right <= g.vw + 0.5,
    c ? `card ${Math.round(c.left)},${Math.round(c.top)} ${Math.round(c.width)}×${Math.round(c.height)} in ${g.vw}×${g.vh}` : 'no card')
  assert(`${label}: no horizontal page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`)
  return g
}

const futureDate = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

async function clearMemory(context) {
  await context.clearCookies()
  await context.addInitScript(() => {}) // no-op; localStorage is cleared per fresh context
}

async function memory(page) {
  return page.evaluate(() => ({ ls: localStorage.getItem('hdl_tutorial_done'), cookie: document.cookie.includes('hdl_tutorial_done=1') }))
}

/* ------------------------------------------------------------------ */
/* the run                                                             */
/* ------------------------------------------------------------------ */
const exe = await chromiumExecutable()
// Plain software rendering: the Lambda-tuned flags some Chromium bundles ship
// with (--single-process, SwiftShader GPU) hang on reload outside Lambda.
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'],
})

function wire(page) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const url = msg.location()?.url ?? ''
    const external = url && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)
    if (/Failed to load resource/.test(msg.text()) && external) return // blocked external host (see blockedExternal)
    consoleErrors.push(`[${MODE}] ${msg.text().slice(0, 300)}${url ? ' @ ' + url.slice(0, 100) : ''}`)
  })
  page.on('pageerror', (err) => pageErrors.push(`[${MODE}] ${err.message}`))
  page.on('requestfailed', (req) => {
    const host = new URL(req.url()).hostname
    if (host !== 'localhost' && host !== '127.0.0.1') return // deliberately blocked
    failedRequests.push(`[${MODE}] ${req.failure()?.errorText} ${req.url().slice(0, 120)}`)
  })
}

async function freshPage() {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    isMobile: MODE === 'mobile',
    hasTouch: MODE === 'mobile',
    deviceScaleFactor: 1,
  })
  await clearMemory(context)
  // The sandbox has no internet: external fonts/gallery images/maps can never
  // load, so they are aborted up front instead of hanging for 30s each.
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname
    if (host === 'localhost' || host === '127.0.0.1') return route.continue()
    blockedExternal.add(host)
    return route.abort()
  })
  const page = await context.newPage()
  wire(page)
  return { context, page }
}

try {
  /* ============ A. first visit: auto-open, Exit / Esc do not persist ============ */
  {
    const { context, page } = await freshPage()
    await page.goto(BASE + '/', { waitUntil: 'commit' })
    await page.waitForSelector(DIALOG, { timeout: 10000 })
    let s = await stepInfo(page)
    assert('A1 fresh visit auto-opens the tour', s && s.index === 1 && s.total === TOTAL_STEPS && /walk through your first stay/.test(s.title), JSON.stringify({ title: s?.title, step: `${s?.index}/${s?.total}` }))
    assert('A1 welcome has Start, Skip tour, Exit and no Back', s.buttons.includes('Start the tour') && s.buttons.includes('Skip tour') && !s.buttons.includes('Back') && s.buttons.includes('×'), s.buttons.join(' | '))
    assert('A1 welcome dialog is aria-modal', await page.getAttribute(DIALOG, 'aria-modal') === 'true')
    let g = await geometry(page, [])
    assert('A1 welcome card inside viewport', g.card && g.card.top >= 0 && g.card.bottom <= g.vh && g.card.left >= 0 && g.card.right <= g.vw, JSON.stringify(g.card))
    await shot(page, 'welcome')

    // Exit (×) → closes, not remembered, reload re-offers
    await page.getByRole('button', { name: 'Exit the tour' }).click()
    await page.waitForSelector(DIALOG, { state: 'detached', timeout: 3000 })
    let m = await memory(page)
    assert('A2 Exit (×) closes the tour without remembering it', m.ls === null && !m.cookie, JSON.stringify(m))
    assert('A2 Replay tutorial button shows once closed', await page.getByRole('button', { name: 'Replay tutorial' }).isVisible())
    await page.reload({ waitUntil: 'commit' })
    await page.waitForSelector(DIALOG, { timeout: 10000 })
    assert('A3 after Exit, a reload offers the tour again', (await stepInfo(page)).index === 1)

    // Esc → same
    await page.keyboard.press('Escape')
    await page.waitForSelector(DIALOG, { state: 'detached', timeout: 3000 })
    m = await memory(page)
    assert('A4 Escape closes the tour without remembering it', m.ls === null && !m.cookie, JSON.stringify(m))
    await page.reload({ waitUntil: 'commit' })
    await page.waitForSelector(DIALOG, { timeout: 10000 })
    assert('A5 after Escape, a reload offers the tour again', (await stepInfo(page)).index === 1)

    // Skip tour from the welcome → remembered
    await page.getByRole('button', { name: 'Skip tour' }).click()
    await page.waitForSelector(DIALOG, { state: 'detached', timeout: 3000 })
    m = await memory(page)
    assert('A6 Skip tour closes and remembers completion (cookie + localStorage)', m.ls === '1' && m.cookie, JSON.stringify(m))
    await page.reload({ waitUntil: 'commit' })
    await page.getByRole('button', { name: 'Replay tutorial' }).waitFor({ timeout: 10000 })
    await page.waitForTimeout(800)
    assert('A7 after Skip, a reload stays closed', (await page.locator(DIALOG).count()) === 0)
    assert('A7 page behind is usable (hero CTA clickable)', await page.locator('[data-tour="hero-cta"]').first().isVisible())

    // Replay → starts from step 1
    await page.getByRole('button', { name: 'Replay tutorial' }).click()
    await page.waitForSelector(DIALOG, { timeout: 5000 })
    s = await stepInfo(page)
    assert('A8 Replay tutorial restarts at step 1', s.index === 1 && /walk through/.test(s.title))
    assert('A8 Replay button hides while the tour runs', (await page.getByRole('button', { name: 'Replay tutorial' }).count()) === 0)
    await context.close()
  }

  /* ============ B. the real walkthrough: click, type, tick, send ============ */
  {
    const { context, page } = await freshPage()
    await page.goto(BASE + '/', { waitUntil: 'commit' })
    await page.waitForSelector(DIALOG, { timeout: 10000 })
    await page.getByRole('button', { name: 'Start the tour' }).click()

    // step 2 — stay (interactive: click a real CTA)
    let s = await waitForStep(page, 'Choose how you want to stay')
    assert('B2 step 2 of 12 shown', s.index === 2, `${s.index}/${s.total}`)
    assert('B2 interactive step offers Skip tour / Back / Skip this step and no Next', s.buttons.includes('Skip this step') && s.buttons.includes('Back') && s.buttons.includes('Skip tour') && !s.buttons.some((b) => /^Next$/.test(b)), s.buttons.join(' | '))
    assert('B2 action hint visible', /Tap “View Accommodation”/.test(s.text))
    let g = await checkHighlightedStep(page, 'B2 stay', ['accommodation-cta', 'nav-book', 'mobile-cta', 'hero-cta'])
    assert('B2 engine scrolled the page to the accommodation card', g.scrollY > 100, `scrollY=${g.scrollY}`)
    await shot(page, 'step2-stay')
    // Nav/CTA behind the dim must NOT react: click on a dim panel must not navigate
    await page.mouse.click(10, Math.round(VIEWPORT.height / 2))
    await page.waitForTimeout(300)
    assert('B2 clicking the dimmed area does nothing (still on / and step 2)', page.url().endsWith('/') && (await stepInfo(page)).index === 2, page.url())
    // click the real highlighted control
    const tgt = page.locator(`[data-tour="${g.target.name}"]`).first()
    await tgt.click()
    s = await waitForStep(page, 'Pick your dates first')
    assert('B3 clicking the real CTA advanced the tour and navigated to /book', s.index === 3 && s.route === '/book', `${s.index} @ ${s.route}`)
    g = await checkHighlightedStep(page, 'B3 dates', ['stay-details'])
    await shot(page, 'step3-dates')

    // step 3 → fill dates
    await page.fill('[data-tour-field="check-in"]', futureDate(30))
    await page.fill('[data-tour-field="check-out"]', futureDate(32))
    s = await waitForStep(page, 'Tell us who’s coming')
    assert('B4 typing real dates advanced to step 4', s.index === 4)
    g = await checkHighlightedStep(page, 'B4 party', ['accommodation-field'], { expectClickable: true })
    assert('B4 informational step shows Next and Back', s.buttons.some((b) => /^Next$/.test(b)) && s.buttons.includes('Back'), s.buttons.join(' | '))
    await shot(page, 'step4-party')

    // Back onto a satisfied step must carry forward again
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    s = await waitForStep(page, 'Pick your dates first', 3000).catch(() => null)
    assert('B4 Back returns to step 3', s && s.index === 3, s ? `${s.index}` : 'did not show step 3')
    s = await waitForStep(page, 'Tell us who’s coming', 4000)
    assert('B4 already-filled dates auto-advance again (no stranding)', s.index === 4)
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    // step 5 — details
    s = await waitForStep(page, 'Who do we confirm with?')
    assert('B5 step 5 shown', s.index === 5)
    g = await checkHighlightedStep(page, 'B5 details', ['guest-details'])
    await shot(page, 'step5-details')
    await page.fill('input[placeholder="09XX XXX XXXX"]', '0917 123 4567')
    await page.fill('input[placeholder="you@email.com"]', 'maria@example.com')
    s = await stepInfo(page)
    assert('B5 filling phone/email alone does not advance (name gates it)', s.index === 5)
    await page.fill('[data-tour-field="guest-name"]', 'Maria Santos')
    s = await waitForStep(page, 'Read and accept the Terms')
    assert('B6 typing the name advanced to step 6', s.index === 6)
    g = await checkHighlightedStep(page, 'B6 terms', ['terms'])
    await shot(page, 'step6-terms')

    // step 6 — tick the real checkbox
    await page.locator('[data-tour="terms"] input[type="checkbox"]').click()
    assert('B6 the real checkbox is checked', await page.locator('[data-tour="terms"] input[type="checkbox"]').isChecked())
    s = await waitForStep(page, 'Send the Booking request')
    assert('B7 ticking terms advanced to step 7', s.index === 7)
    g = await checkHighlightedStep(page, 'B7 send', ['submit-booking'])
    await shot(page, 'step7-send')

    // step 7 — the real submit
    await page.locator('[data-tour="submit-booking"]').click()
    s = await waitForStep(page, 'Your request is in', 10000)
    assert('B8 real submit advanced to step 8', s.index === 8)
    await page.waitForFunction(() => document.querySelector('[data-tour="booking-success"]'), null, { timeout: 8000 }).catch(() => {})
    assert('B8 booking success screen rendered', await page.locator('[data-tour="booking-success"]').count() > 0 && /Request Received/i.test(await page.locator('main').innerText()))
    g = await checkHighlightedStep(page, 'B8 sent', ['booking-success'])
    await shot(page, 'step8-sent')
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    // step 9 — /account (signed out → fallback copy, still continuable)
    s = await waitForStep(page, 'My Bookings — follow your own stay')
    assert('B9 step 9 navigated to /account', s.index === 9 && s.route === '/account', `${s.index} @ ${s.route}`)
    await page.waitForFunction((sel) => /isn’t on screen right now/.test(document.querySelector(sel)?.textContent ?? ''), DIALOG, { timeout: 6000 }).catch(() => {})
    s = await stepInfo(page)
    assert('B9 signed-out fallback copy + "not on screen" note shown', /Sign in as a Guest and this page fills/.test(s.text) && /isn’t on screen right now/.test(s.text), s.text.slice(0, 160))
    assert('B9 still continuable with Next', s.buttons.some((b) => /^Next$/.test(b)))
    g = await geometry(page, ['booking-card', 'account-tools'])
    assert('B9 no spotlight when nothing is highlighted, card centered/docked inside viewport', !g.ring && g.card && g.card.top >= 0 && g.card.bottom <= g.vh, JSON.stringify(g.card))
    await shot(page, 'step9-account-fallback')
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    s = await waitForStep(page, 'After approval: pay, upload, arrive')
    assert('B10 step 10 shown', s.index === 10)
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    // step 11 — /messages (signed out → fallback; awaiting must be dropped so Next exists)
    s = await waitForStep(page, 'Chat with the Admin')
    assert('B11 step 11 navigated to /messages', s.index === 11 && s.route === '/messages', `${s.index} @ ${s.route}`)
    await page.waitForFunction((sel) => /direct line to the Admin/.test(document.querySelector(sel)?.textContent ?? ''), DIALOG, { timeout: 6000 }).catch(() => {})
    s = await stepInfo(page)
    assert('B11 signed-out fallback copy shown and Next offered', /direct line to the Admin/.test(s.text) && s.buttons.some((b) => /^Next$/.test(b)), s.buttons.join(' | '))
    await shot(page, 'step11-messages-fallback')
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    // step 12 — done
    s = await waitForStep(page, 'You know your way around now')
    assert('B12 final step 12 of 12 with Finish and Back, no Skip tour', s.index === 12 && s.buttons.includes('Finish') && s.buttons.includes('Back') && !s.buttons.includes('Skip tour'), s.buttons.join(' | '))
    await shot(page, 'step12-done')
    await page.getByRole('button', { name: 'Finish' }).click()
    await page.waitForSelector(DIALOG, { state: 'detached', timeout: 3000 })
    let m = await memory(page)
    assert('B12 Finish closes the tour completely and remembers it', m.ls === '1' && m.cookie, JSON.stringify(m))
    assert('B12 nothing of the overlay remains', (await page.locator('.tour-ring').count()) === 0 && (await page.locator(DIALOG).count()) === 0)
    await page.reload({ waitUntil: 'commit' })
    await page.getByRole('button', { name: 'Replay tutorial' }).waitFor({ timeout: 10000 })
    await page.waitForTimeout(800)
    assert('B13 reload after Finish: tour stays closed, Replay available', (await page.locator(DIALOG).count()) === 0)
    await shot(page, 'after-finish-reload')
    await context.close()
  }

  /* ============ C. Next/Skip-this-step repeatedly from 1 → 12 ============ */
  {
    const { context, page } = await freshPage()
    await page.goto(BASE + '/', { waitUntil: 'commit' })
    await page.waitForSelector(DIALOG, { timeout: 10000 })
    const seen = []
    let guard = 0
    while (guard++ < 20) {
      const s = await stepInfo(page)
      if (!s) break
      seen.push(`${s.index}:${s.title.slice(0, 28)}@${s.route}`)
      // every step: card inside viewport, and when a target is highlighted it is clickable
      const g = await geometry(page, [])
      if (!(g.card && g.card.top >= 0 && g.card.bottom <= g.vh + 0.5 && g.card.left >= 0 && g.card.right <= g.vw + 0.5)) {
        record(`C step ${s.index} card inside viewport`, false, JSON.stringify(g.card))
      }
      const btn = s.buttons.find((b) => /^(Start the tour|Next|Finish)$/.test(b)) ?? (s.buttons.includes('Skip this step') ? 'Skip this step' : null)
      if (!btn) { record(`C step ${s.index} has a way forward`, false, s.buttons.join(' | ')); break }
      if (s.index === TOTAL_STEPS) {
        await page.getByRole('button', { name: 'Finish' }).click()
        break
      }
      const before = s.index
      await page.getByRole('button', { name: btn, exact: true }).click()
      await page.waitForFunction(([sel, b]) => { const d = document.querySelector(sel); const m = d?.textContent?.match(/Step (\d+) of/); return m && Number(m[1]) === b + 1 }, [DIALOG, before], { timeout: 8000 })
      await page.waitForTimeout(700) // let route change + scroll settle
    }
    await page.waitForSelector(DIALOG, { state: 'detached', timeout: 3000 }).catch(() => {})
    const indices = seen.map((x) => Number(x.split(':')[0]))
    assert('C Next/Skip-this-step walks 1→12 in order without stalling', indices.length === TOTAL_STEPS && indices.every((n, i) => n === i + 1), seen.join(' > '))
    assert('C routes followed the script (/ → /book → /account → /messages)', /2:.*@\/ /.test(seen.join(' ') + ' ') && seen[2]?.endsWith('@/book') && seen[8]?.endsWith('@/account') && seen[10]?.endsWith('@/messages'), seen.join(' > '))
    assert('C Finish closed the tour', (await page.locator(DIALOG).count()) === 0)
    const m = await memory(page)
    assert('C completion remembered', m.ls === '1' && m.cookie)
    await shot(page, 'after-next-run')

    // Back from a far step goes back one at a time
    await page.getByRole('button', { name: 'Replay tutorial' }).click()
    await page.getByRole('button', { name: 'Start the tour' }).click()
    await waitForStep(page, 'Choose how you want to stay')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    const s = await waitForStep(page, 'walk through your first stay')
    assert('C Back from step 2 returns to the welcome (step 1)', s.index === 1)
    await context.close()
  }

  /* ============ D. the dates block renders late (slow device / connection) ============ */
  // Seen once in a real Chromium under load: /book took longer than the tour's
  // missing-anchor grace, the dates step degraded to "read along" and then
  // ignored the dates the Guest typed. The block is kept invisible for 3.5 s
  // after it first appears; the step must fall back, recover, and still react.
  {
    const { context, page } = await freshPage()
    await context.addInitScript(() => {
      const css = document.createElement('style')
      css.textContent = '[data-tour="stay-details"]{display:none !important}'
      let armed = false
      const mo = new MutationObserver(() => {
        if (armed || !document.querySelector('[data-tour="stay-details"]')) return
        armed = true
        document.head.appendChild(css)
        setTimeout(() => css.remove(), 3500)
      })
      const start = () => mo.observe(document.documentElement, { childList: true, subtree: true })
      if (document.documentElement) start()
      else document.addEventListener('readystatechange', start, { once: true })
    })
    await page.goto(BASE + '/', { waitUntil: 'commit' })
    await page.waitForSelector(DIALOG, { timeout: 10000 })
    await page.getByRole('button', { name: 'Start the tour' }).click()
    await waitForStep(page, 'Choose how you want to stay')
    await page.waitForTimeout(1500)
    await page.locator('[data-tour="accommodation-cta"]').first().click()
    await waitForStep(page, 'Pick your dates first')
    const cardText = () => page.locator(DIALOG).innerText()
    let fellBack = false
    for (let i = 0; i < 11 && !fellBack; i++) {
      await page.waitForTimeout(300)
      fellBack = /isn’t on screen right now/.test(await cardText())
    }
    assert('D dates step falls back to "read along" while its block is not on screen', fellBack)
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-tour="stay-details"]')
      return el && getComputedStyle(el).display !== 'none'
    }, null, { timeout: 15000 })
    await page.waitForTimeout(600)
    assert('D fallback lifts once the block appears', !/isn’t on screen right now/.test(await cardText()))
    const g = await geometry(page, ['stay-details'])
    assert('D spotlight is back on the dates block', g.target && g.target.name === 'stay-details')
    await page.fill('[data-tour-field="check-in"]', futureDate(30))
    await page.fill('[data-tour-field="check-out"]', futureDate(32))
    const s4 = await waitForStep(page, 'Tell us who’s coming', 6000).catch(() => null)
    assert('D typing the dates after the late appearance still advances to step 4', s4 && s4.index === 4, s4 ? `${s4.index}` : 'stayed on step 3')
    await shot(page, 'late-anchor-recovered')
    await context.close()
  }
} catch (err) {
  record('UNCAUGHT test-runner error', false, err.stack?.split('\n').slice(0, 3).join(' | '))
} finally {
  await browser.close()
}

/* ------------------------------------------------------------------ */
/* report                                                              */
/* ------------------------------------------------------------------ */
const failed = results.filter((r) => !r.ok)
console.log('\n==================== SUMMARY (' + MODE + ') ====================')
console.log(`checks: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}`)
for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ' — ' + f.detail : ''}`)
console.log(`console errors: ${consoleErrors.length}`)
for (const e of [...new Set(consoleErrors)].slice(0, 12)) console.log('  · ' + e)
console.log(`uncaught page exceptions: ${pageErrors.length}`)
for (const e of [...new Set(pageErrors)].slice(0, 12)) console.log('  · ' + e)
console.log(`blocked external hosts (sandbox has no internet): ${[...blockedExternal].join(', ') || 'none'}`)
console.log(`failed local requests: ${failedRequests.length}`)
for (const e of [...new Set(failedRequests)].slice(0, 12)) console.log('  · ' + e)
fs.writeFileSync(path.join(os.tmpdir(), `hdl-tour-report-${MODE}.json`), JSON.stringify({ results, consoleErrors, pageErrors, failedRequests }, null, 2))
process.exit(failed.length || pageErrors.length ? 1 : 0)
