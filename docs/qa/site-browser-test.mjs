#!/usr/bin/env node
// Real-browser QA for the immersive homepage + the Guest booking flow.
//
// Drives Chromium with Playwright against a running dev server and checks, in
// one viewport per run:
//   A  homepage loads, nav works (desktop links / mobile drawer), hero CTA opens /book,
//      every scene is present, no console errors
//   B  depth layer: hero parallax responds to scroll (and to the pointer on desktop),
//      accommodation cards tilt on hover without moving their CTA out of reach, tilt is
//      off on touch, nothing creates horizontal overflow at any scroll position
//   C  prefers-reduced-motion: parallax, tilt and Ken Burns are all disabled
//   D  booking flow in demo mode (no Firebase): dates → accommodation → details →
//      availability + estimate → terms → send → success screen with the KYC step.
//      Nothing leaves the browser; no real booking or document is created.
//
//   node docs/qa/site-browser-test.mjs desktop|tablet|mobile
//
// Env: BASE_URL (default http://localhost:3000), CHROMIUM_PATH (else @sparticuz/chromium,
// else Playwright's own Chromium). Screenshots: $TMPDIR/hdl-site-shots/<mode>/;
// report: $TMPDIR/hdl-site-report-<mode>.json. Exit code 1 on any FAIL.
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
    return undefined
  }
}

const MODE = process.argv[2] ?? 'desktop'
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SHOTS = path.join(os.tmpdir(), 'hdl-site-shots', MODE)
fs.mkdirSync(SHOTS, { recursive: true })

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
}
const VIEWPORT = VIEWPORTS[MODE] ?? VIEWPORTS.desktop
const TOUCH = MODE !== 'desktop'

const SCENES = [
  ['intro', 'Scene 02 — Your Private Escape'],
  ['stay', 'Scene 03 — Accommodations'],
  ['experience', 'Scene 04 — The Experience'],
  ['nearby', 'Scene 04 — Nearby'],
  ['gallery', 'Scene 04 — Gallery'],
  ['rates', 'Scene 05 — Rates & Fees'],
  ['amenities', 'Scene 05 — Amenities'],
  ['house-rules', 'Scene 06 — Good to Know'],
  ['location', 'Scene 07 — Location'],
  ['getting-here', 'Scene 07 — Getting here'],
  ['reviews', 'Scene 08 — Reviews'],
  ['faqs', 'FAQs'],
  ['contact', 'Scene 09 — Booking CTA + Contact'],
]

/* ------------------------------------------------------------------ */
const results = []
const consoleErrors = []
const pageErrors = []
const failedRequests = []
let shotNo = 0

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const assert = (name, cond, detail = '') => (record(name, Boolean(cond), detail), Boolean(cond))
async function shot(page, label, fullPage = false) {
  shotNo += 1
  const file = `${SHOTS}/${String(shotNo).padStart(2, '0')}-${label}.png`
  await page.screenshot({ path: file, fullPage })
  return file
}
const futureDate = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

async function settleScroll(page) {
  await page.waitForTimeout(250)
  await page.evaluate(() => new Promise((resolve) => {
    let last = window.scrollY, still = 0, polls = 0
    const id = setInterval(() => {
      const y = window.scrollY
      still = Math.abs(y - last) < 1 ? still + 1 : 0
      last = y
      polls += 1
      if (still >= 5 || polls > 60) { clearInterval(id); resolve() }
    }, 100)
  }))
}

/** scrollWidth vs viewport at the current position — the horizontal-overflow probe. */
const overflowProbe = (page) => page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.scrollWidth,
  inner: window.innerWidth,
  y: Math.round(window.scrollY),
}))

async function noHorizontalOverflowThroughPage(page, label) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight)
  const vh = VIEWPORT.height
  const worst = { over: 0, y: 0 }
  for (let y = 0; y < total; y += Math.round(vh * 0.8)) {
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y)
    await page.waitForTimeout(120)
    const p = await overflowProbe(page)
    const over = Math.max(p.scrollWidth, p.bodyWidth) - p.inner
    if (over > worst.over) Object.assign(worst, { over, y })
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  assert(`${label} no horizontal overflow at any scroll position`, worst.over <= 0, `worst overflow ${worst.over}px at y=${worst.y}`)
}

const transformOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  return el ? getComputedStyle(el).transform : null
}, sel)

/* ------------------------------------------------------------------ */
const exe = await chromiumExecutable()
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
    if (/Failed to load resource/.test(msg.text()) && external) return
    consoleErrors.push(`[${MODE}] ${msg.text().slice(0, 300)}${url ? ' @ ' + url.slice(0, 100) : ''}`)
  })
  page.on('pageerror', (err) => pageErrors.push(`[${MODE}] ${err.message}`))
  page.on('requestfailed', (req) => {
    const host = new URL(req.url()).hostname
    if (host !== 'localhost' && host !== '127.0.0.1') return
    failedRequests.push(`[${MODE}] ${req.failure()?.errorText} ${req.url().slice(0, 120)}`)
  })
}

async function newPage({ reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    hasTouch: TOUCH,
    isMobile: MODE === 'mobile',
    reducedMotion,
    locale: 'en-PH',
    timezoneId: 'Asia/Manila',
  })
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname
    if (host === 'localhost' || host === '127.0.0.1') return route.continue()
    return route.abort() // Google Fonts, Maps, FB CDN — never leave the sandbox
  })
  // The Guest tour has its own real-browser harness (tutorial-browser-test.mjs);
  // here it is marked as already finished so its welcome card never covers the page.
  await context.addInitScript(() => {
    try { localStorage.setItem('hdl_tutorial_done', '1') } catch {}
  })
  const page = await context.newPage()
  wire(page)
  return { page, context }
}

async function open(page, url, waitSel = 'h1') {
  await page.goto(BASE + url, { waitUntil: 'commit', timeout: 20000 })
  await page.waitForSelector(waitSel, { timeout: 15000 })
  await page.waitForTimeout(400)
}

try {
  /* ============================ A. homepage ============================ */
  {
    const { page, context } = await newPage()
    await open(page, '/')
    const h1 = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ')
    assert('A1 homepage loads with the hero headline', /Quiet Side/.test(h1), h1)
    assert('A1 hero states the positioning line', /private countryside stay near laguna attractions/i.test(await page.locator('.hero').innerText()))
    await shot(page, 'home-hero')

    // hero CTA visible in the first viewport, and it is the topmost element at its centre
    const cta = page.locator('[data-tour="hero-cta"]')
    const box = await cta.boundingBox()
    assert('A2 hero "Check Availability" is inside the first viewport', box && box.y >= 0 && box.y + box.height <= VIEWPORT.height, JSON.stringify(box))
    const hit = await page.evaluate(() => {
      const el = document.querySelector('[data-tour="hero-cta"]')
      const r = el.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return el === top || el.contains(top)
    })
    assert('A2 nothing (foliage/overlay) covers the hero CTA', hit)
    assert('A2 hero Airbnb badge present', (await page.locator('.hero a[href*="airbnb"]').count()) > 0)

    // nav
    if (MODE === 'desktop') {
      assert('A3 desktop nav "Book Your Stay" visible', await page.locator('[data-tour="nav-book"]').isVisible())
      const labels = await page.locator('header nav a').evaluateAll((as) => as.filter((a) => getComputedStyle(a).display !== 'none').map((a) => a.textContent.trim()))
      assert('A3 desktop nav lists the scenes', ['Home', 'Stay', 'Experience', 'Rates', 'Location', 'Reviews', 'Contact'].every((l) => labels.includes(l)), labels.join(' · '))
      assert('A3 nav starts transparent over the hero', (await page.locator('header').getAttribute('data-nav')) === 'hero')
      await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }))
      await page.waitForTimeout(300)
      assert('A3 nav becomes the floating pill after scrolling', (await page.locator('header').getAttribute('data-nav')) === 'floating')
      const pill = await page.locator('header > div').first().boundingBox()
      assert('A3 floating pill stays inside the viewport width', pill && pill.x >= 0 && pill.x + pill.width <= VIEWPORT.width, JSON.stringify(pill))
      await shot(page, 'nav-floating')
      for (const [hash, id] of [['#stay', 'stay'], ['#location', 'location'], ['#reviews', 'reviews']]) {
        await page.locator(`header nav a[href="/${hash}"]`).click()
        await settleScroll(page)
        const top = await page.evaluate((i) => document.getElementById(i).getBoundingClientRect().top, id)
        assert(`A4 nav link ${hash} scrolls to the section`, top > -40 && top < 160, `section top=${Math.round(top)}`)
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await page.waitForTimeout(300)
    } else {
      const burger = page.getByRole('button', { name: 'Open menu' })
      assert('A3 mobile menu button visible', await burger.isVisible())
      await burger.click()
      await page.waitForTimeout(600)
      const drawerLinks = await page.locator('header a[href="/#stay"]').evaluateAll((as) => as.filter((a) => a.getBoundingClientRect().height > 0).length)
      assert('A3 drawer opens with the section links', drawerLinks > 0)
      await shot(page, 'nav-drawer')
      const drawerBox = await page.locator('header').boundingBox()
      assert('A3 open drawer fits the viewport width', drawerBox && drawerBox.width <= VIEWPORT.width + 1, JSON.stringify(drawerBox))
      await page.locator('header a[href="/#stay"]').last().click()
      await settleScroll(page)
      const top = await page.evaluate(() => document.getElementById('stay').getBoundingClientRect().top)
      assert('A4 drawer link scrolls to #stay and closes', top > -40 && top < 200 && !(await page.getByRole('button', { name: 'Close menu' }).isVisible()), `top=${Math.round(top)}`)
      assert('A3 mobile sticky "Book" CTA visible', await page.locator('[data-tour="mobile-cta"]').isVisible())
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await page.waitForTimeout(300)
    }

    // scenes present with real height
    for (const [id, label] of SCENES) {
      const h = await page.evaluate((i) => document.getElementById(i)?.getBoundingClientRect().height ?? 0, id)
      assert(`A5 ${label} (#${id}) rendered`, h > 80, `height=${Math.round(h)}`)
    }
    // reveal: everything gets `.in` once scrolled past — no section stays invisible
    await noHorizontalOverflowThroughPage(page, 'A6')
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.reveal')].filter((el) => !el.classList.contains('in') && el.getBoundingClientRect().height > 0).length)
    assert('A6 every reveal block became visible after scrolling through', hidden === 0, `${hidden} still hidden`)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(400)
    await shot(page, 'home-full', true)

    // accommodation cards keep all their facts visible
    const cards = page.locator('[data-accommodation]')
    assert('A7 two accommodation cards', (await cards.count()) === 2)
    for (let i = 0; i < 2; i += 1) {
      const text = (await cards.nth(i).innerText()).replace(/\s+/g, ' ')
      const id = await cards.nth(i).getAttribute('data-accommodation')
      const ok = /up to \d+ guests/i.test(text) && /\brate\b/i.test(text) && /view accommodation/i.test(text) && (id !== 'main-house' || /sleeping arrangements/i.test(text))
      assert(`A7 card ${id} shows capacity, rate, amenities and the CTA`, ok && (await cards.nth(i).locator('[data-tour="accommodation-cta"]').isVisible()))
    }

    // hero CTA navigates to /book
    await cta.click()
    await page.waitForFunction(() => location.pathname === '/book', null, { timeout: 8000 })
    await page.waitForSelector('[data-tour="stay-details"]', { timeout: 8000 })
    assert('A8 hero CTA opens /book with the real form', await page.locator('[data-tour="submit-booking"]').isVisible())
    await shot(page, 'book-from-hero')
    await context.close()
  }

  /* ========================= B. depth interactions ========================= */
  {
    const { page, context } = await newPage()
    await open(page, '/')
    assert('B1 hero reports full motion', (await page.locator('.hero').getAttribute('data-motion')) === 'full')
    const t0 = await transformOf(page, '[data-hero-layer="back"]')
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }))
    await page.waitForTimeout(250)
    const t1 = await transformOf(page, '[data-hero-layer="back"]')
    const c1 = await transformOf(page, '[data-hero-layer="content"]')
    assert('B1 hero background parallaxes on scroll', t0 !== t1 && t1 !== 'none', `${t0} → ${t1}`)
    assert('B1 hero content drifts at its own speed', c1 !== 'none' && c1 !== t1, c1)
    const probe = await overflowProbe(page)
    assert('B1 parallax adds no horizontal overflow', Math.max(probe.scrollWidth, probe.bodyWidth) <= probe.inner, JSON.stringify(probe))
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(250)

    if (!TOUCH) {
      const f0 = await transformOf(page, '[data-hero-layer="fore"]')
      await page.mouse.move(VIEWPORT.width * 0.9, VIEWPORT.height * 0.8)
      await page.waitForTimeout(120)
      await page.mouse.move(VIEWPORT.width * 0.85, VIEWPORT.height * 0.75)
      await page.waitForTimeout(250)
      const f1 = await transformOf(page, '[data-hero-layer="fore"]')
      assert('B2 foreground foliage follows the pointer (desktop)', f0 !== f1, `${f0} → ${f1}`)
      const p2 = await overflowProbe(page)
      assert('B2 pointer parallax adds no horizontal overflow', Math.max(p2.scrollWidth, p2.bodyWidth) <= p2.inner)
      await shot(page, 'hero-pointer')

      // tilt cards
      const card = page.locator('[data-accommodation="main-house"]')
      await card.scrollIntoViewIfNeeded()
      await page.waitForTimeout(700)
      assert('B3 tilt enabled on a fine pointer', (await card.getAttribute('data-tilt')) === 'on')
      const before = await card.boundingBox()
      await page.mouse.move(before.x + before.width * 0.2, before.y + before.height * 0.2)
      await page.waitForTimeout(80)
      await page.mouse.move(before.x + before.width * 0.15, before.y + before.height * 0.15)
      await page.waitForTimeout(350)
      const tilt = await card.evaluate((el) => ({ x: el.style.getPropertyValue('--tilt-x'), y: el.style.getPropertyValue('--tilt-y'), t: getComputedStyle(el).transform }))
      assert('B3 card tilts under the pointer', tilt.x && tilt.y && tilt.t !== 'none', JSON.stringify(tilt))
      const after = await card.boundingBox()
      assert('B3 tilt does not shift the card layout', Math.abs(after.width - before.width) < 12 && Math.abs(after.height - before.height) < 12, `${JSON.stringify(before)} → ${JSON.stringify(after)}`)
      const ctaHit = await page.evaluate(() => {
        const el = document.querySelector('[data-accommodation="main-house"] [data-tour="accommodation-cta"]')
        const r = el.getBoundingClientRect()
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { ok: el === top || el.contains(top), inView: r.top >= 0 && r.bottom <= innerHeight }
      })
      assert('B3 the card CTA stays reachable while tilted', ctaHit.ok && ctaHit.inView, JSON.stringify(ctaHit))
      await shot(page, 'card-tilt')
      await page.mouse.move(5, 5)
      await page.waitForTimeout(800)
      const reset = await card.evaluate((el) => el.style.getPropertyValue('--tilt-x'))
      assert('B3 tilt resets when the pointer leaves', reset === '')
      const p3 = await overflowProbe(page)
      assert('B3 tilt adds no horizontal overflow', Math.max(p3.scrollWidth, p3.bodyWidth) <= p3.inner)
    } else {
      const card = page.locator('[data-accommodation="main-house"]')
      await card.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      assert('B3 tilt is off on touch devices', (await card.getAttribute('data-tilt')) === 'off')
      const b = await card.boundingBox()
      await page.touchscreen.tap(b.x + b.width / 2, b.y + 40)
      await page.waitForTimeout(300)
      const still = await card.evaluate((el) => getComputedStyle(el).transform)
      assert('B3 tapping a card does not transform it', still === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(still), still)
      assert('B3 card CTA at least 44px tall on touch', ((await card.locator('[data-tour="accommodation-cta"]').boundingBox())?.height ?? 0) >= 44)
    }

    // scroll parallax media stays clipped inside its frame
    const clip = await page.evaluate(() => {
      const bad = []
      for (const m of document.querySelectorAll('.parallax-media')) {
        const f = m.parentElement.getBoundingClientRect()
        const r = m.getBoundingClientRect()
        if (r.top > f.top + 1 || r.bottom < f.bottom - 1) bad.push(`${Math.round(r.top - f.top)}/${Math.round(r.bottom - f.bottom)}`)
      }
      return bad
    })
    assert('B4 parallax media always covers its frame (no exposed edges)', clip.length === 0, clip.join(' '))

    // smooth-scroll behaviour intact and page reaches the bottom
    await page.evaluate(() => document.getElementById('contact').scrollIntoView({ behavior: 'smooth' }))
    await settleScroll(page)
    const ctop = await page.evaluate(() => document.getElementById('contact').getBoundingClientRect().top)
    assert('B5 smooth scroll to #contact works', ctop > -40 && ctop < 120, `${Math.round(ctop)}`)
    await shot(page, 'contact-cta')
    await context.close()
  }

  /* ========================= C. reduced motion ========================= */
  {
    const { page, context } = await newPage({ reducedMotion: 'reduce' })
    await open(page, '/')
    assert('C1 hero reports reduced motion', (await page.locator('.hero').getAttribute('data-motion')) === 'reduced')
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }))
    await page.waitForTimeout(300)
    const back = await transformOf(page, '[data-hero-layer="back"]')
    const fore = await transformOf(page, '[data-hero-layer="fore"]')
    assert('C1 no hero parallax under reduced motion', back === 'none' && fore === 'none', `${back} / ${fore}`)
    const kb = await page.evaluate(() => getComputedStyle(document.querySelector('[data-hero-layer="back"] img')).animationName)
    assert('C1 Ken Burns disabled', kb === 'none', kb)
    const media = await page.evaluate(() => [...document.querySelectorAll('.parallax-media')].map((m) => getComputedStyle(m).transform))
    assert('C2 no scroll parallax on section media', media.every((t) => t === 'none'), media.join(','))
    if (!TOUCH) {
      const card = page.locator('[data-accommodation="main-house"]')
      await card.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      assert('C3 tilt disabled', (await card.getAttribute('data-tilt')) === 'off')
      const b = await card.boundingBox()
      await page.mouse.move(b.x + 40, b.y + 40)
      await page.waitForTimeout(300)
      assert('C3 hover does not tilt', (await card.evaluate((el) => getComputedStyle(el).transform)) === 'none')
    }
    await noHorizontalOverflowThroughPage(page, 'C4')
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.reveal')].filter((el) => !el.classList.contains('in') && el.getBoundingClientRect().height > 0).length)
    assert('C4 content still reveals (fade only)', hidden === 0, `${hidden} hidden`)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(300)
    await shot(page, 'reduced-motion-hero')
    await context.close()
  }

  /* ========================= D. booking flow (demo) ========================= */
  {
    const { page, context } = await newPage()
    await open(page, '/book', '[data-tour="stay-details"]')
    assert('D1 /book renders the booking form', await page.locator('[data-tour="submit-booking"]').isVisible())
    assert('D1 demo mode banner (no Firebase in this sandbox)', /Demo mode/i.test(await page.locator('main').innerText()))
    const summary = page.locator('aside').filter({ hasText: /at a glance/i })
    assert('D1 aside summary present', (await summary.count()) === 1)
    await shot(page, 'book-empty')

    await page.fill('[data-tour-field="check-in"]', futureDate(40))
    await page.fill('[data-tour-field="check-out"]', futureDate(42))
    await page.selectOption('[data-tour="accommodation-field"] select', 'main-house')
    await page.waitForTimeout(800)
    const aside = (await summary.innerText()).replace(/\s+/g, ' ')
    assert('D2 aside mirrors dates and the selected accommodation', aside.includes(futureDate(40)) && aside.includes(futureDate(42)) && /Main House/.test(aside), aside.slice(0, 200))
    assert('D2 estimate shown or "quoted" fallback (published rates only)', /estimated total/i.test(aside) && (/₱[\d,]+/.test(aside) || /quoted/i.test(aside)), aside.slice(-220))
    const formText = (await page.locator('form').innerText()).replace(/\s+/g, ' ')
    assert('D2 availability check ran (no hold conflict for fresh demo dates)', !/not available|already held/i.test(formText))

    await page.fill('[data-tour-field="guest-name"]', 'QA Tester')
    await page.fill('input[placeholder="09XX XXX XXXX"]', '0917 000 0000')
    await page.fill('input[placeholder="you@email.com"]', 'qa@example.com')
    await page.locator('[data-tour="terms"] input[type="checkbox"]').check()
    await shot(page, 'book-filled')
    const submit = page.locator('[data-tour="submit-booking"]')
    const sb = await submit.boundingBox()
    assert('D3 submit button visible and tappable', sb && sb.height >= 44 && sb.x >= 0 && sb.x + sb.width <= VIEWPORT.width, JSON.stringify(sb))
    await submit.click()
    await page.waitForSelector('[data-tour="booking-success"]', { timeout: 10000 })
    const success = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
    assert('D4 success screen: request received', /Request Received/i.test(success))
    assert('D4 success screen shows a booking reference', /HDL-|Reference/i.test(success), success.slice(0, 160))
    assert('D4 success screen shows the Date-hold countdown', /your dates are held/i.test(success))
    assert('D4 KYC step offered on the success screen', /Send your government ID/i.test(success))
    // With Firebase connected the ID picker renders; in the offline demo build the
    // component explains where to send the ID instead. Either way nothing is uploaded here.
    const kycControls = (await page.locator('input[type="file"]').count()) > 0 || /no Firebase project connected/i.test(success)
    assert('D4 KYC controls (or the offline explanation) present — no document uploaded', kycControls)
    assert('D4 payment is not requested before Admin approval', !/upload (your )?receipt|payment step/i.test(success) || /Pending/i.test(success))
    await shot(page, 'book-success', true)
    await context.close()
  }
} catch (err) {
  record('harness crashed', false, String(err?.stack ?? err).slice(0, 400))
} finally {
  await browser.close()
}

assert('Z1 no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' || '))
assert('Z2 no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' || '))
assert('Z3 no failed local requests', failedRequests.length === 0, failedRequests.slice(0, 5).join(' || '))

const passed = results.filter((r) => r.ok).length
console.log(`\n${MODE}: ${passed}/${results.length} checks passed · screenshots in ${SHOTS}`)
fs.writeFileSync(path.join(os.tmpdir(), `hdl-site-report-${MODE}.json`), JSON.stringify({ mode: MODE, viewport: VIEWPORT, results, consoleErrors, pageErrors, failedRequests }, null, 2))
process.exit(passed === results.length ? 0 : 1)
