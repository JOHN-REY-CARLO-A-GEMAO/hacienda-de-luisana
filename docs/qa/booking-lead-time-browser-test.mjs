#!/usr/bin/env node
// Focused Playwright QA of the existing guest flow. Run ONLY against a demo
// `npm run dev` server: this refuses configured Firebase/Supabase deployments.
// No real Guest, payment or booking is sent to the Hacienda.
//
// npm install --no-save --package-lock=false playwright
// npx playwright install chromium
// node docs/qa/booking-lead-time-browser-test.mjs
//
// Optional: BASE_URL, CHROMIUM_PATH, PLAYWRIGHT_MODULE, CHROMIUM_MODULE (module
// specifiers/absolute paths, for external tooling); mirrors other docs/qa tests.
import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
let executablePath = process.env.CHROMIUM_PATH
let args = ['--no-sandbox']
if (process.env.CHROMIUM_MODULE) {
  const pack = (await import(process.env.CHROMIUM_MODULE)).default
  executablePath = await pack.executablePath()
  args = pack.args.filter((argument) => argument !== '--single-process')
}
const browser = await chromium.launch({ headless: true, executablePath, args })
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const NOW = new Date('2026-10-01T04:00:00Z')
const ERROR = 'This date is not available for advance booking. Please choose a check-in date at least 30 days from today.'
let checks = 0
const pass = (label) => { checks += 1; console.log(`PASS ${label}`) }
const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

async function fillDetails(page, checkIn, name) {
  await page.locator('[data-tour-field="check-in"]').fill(checkIn)
  await page.locator('[data-tour-field="check-out"]').fill('2026-11-02')
  await page.locator('[data-tour-field="guest-name"]').fill(name)
  await page.locator('[autocomplete="tel"]').fill('09171234567')
  await page.locator('[type="email"]').fill('lead-time@example.com')
  await page.locator('[data-tour="terms"] input').check()
}
async function attachProof(page) {
  await page.locator('input[type="file"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: screenshot })
  await page.locator('[inputmode="decimal"]').fill('5000')
}

try {
  for (const timezoneId of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Manila']) {
    const context = await browser.newContext({ timezoneId, viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    await page.clock.setFixedTime(NOW)
    await context.addInitScript(() => localStorage.setItem('hdl_tutorial_done', '1'))
    // OCR's external worker is not part of the date/payment policy. Make it
    // fail as an offline browser would; manual amount/reference remains usable.
    await page.route('https://**/*', (route) => new URL(route.request().url()).origin === new URL(BASE).origin
      ? route.continue() : route.abort())
    await page.goto(`${BASE}/book`)
    const cloud = await page.evaluate(async () => {
      const { cloudBookingsDB } = await import('/src/lib/firestoreBookings.ts')
      const { isSupabaseConfigured } = await import('/src/lib/supabase.ts')
      return cloudBookingsDB.isCloud || isSupabaseConfigured
    })
    assert.equal(cloud, false, 'This QA script must only run in demo mode')

    const checkIn = page.locator('[data-tour-field="check-in"]')
    assert.equal(await checkIn.getAttribute('min'), '2026-10-31')
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-08', '2026-10-30']) {
      await checkIn.fill(date)
      assert.equal(await checkIn.evaluate((input) => input.validity.rangeUnderflow), true)
    }
    await checkIn.fill('2026-10-31')
    assert.equal(await checkIn.evaluate((input) => input.validity.valid), true)
    pass(`${timezoneId}: native date picker excludes days 0/1/7/29, allows day 30`)

    // Native min is bypassable by script; the existing form must still refuse.
    await fillDetails(page, '2026-10-30', 'Boundary Guest')
    await page.locator('[data-tour="submit-booking"]').click()
    await page.getByText(ERROR, { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => sessionStorage.getItem('hdl:booking-draft')), null)
    pass(`${timezoneId}: injected invalid form date is rejected, no draft/booking/proof created`)

    // Invoke the existing action directly, bypassing every form control.
    const direct = await page.evaluate(async () => {
      const { cloudBookingsDB } = await import('/src/lib/firestoreBookings.ts')
      const before = localStorage.getItem('hdl:bookings')
      try {
        await cloudBookingsDB.add({
          guest_name: 'Direct Guest', phone: '09171234567', email: 'direct@example.com',
          guests: 2, accommodation: 'main-house', special_requests: '', uid: 'guest-direct',
          check_in: '2026-10-08', check_out: '2026-10-10',
          payment_proof_url: 'payments/guest-direct/HDL/proof-1.png', amount_claimed: 5000,
        })
        return { rejected: false }
      } catch (error) {
        return { rejected: true, code: error.code, message: error.message,
          unchanged: localStorage.getItem('hdl:bookings') === before }
      }
    })
    assert.deepEqual(direct, { rejected: true, code: 'MINIMUM_BOOKING_LEAD_TIME', message: ERROR, unchanged: true })
    pass(`${timezoneId}: direct invalid action cannot create a record`)

    // A manually edited draft can skip /book, but cannot trigger an upload.
    await page.evaluate(() => sessionStorage.setItem('hdl:booking-draft', JSON.stringify({
      check_in: '2026-10-08', check_out: '2026-11-02', guests: 2, accommodation: 'main-house',
      name: 'Tampered Guest', phone: '09171234567', email: 'lead-time@example.com', special_requests: '',
    })))
    await page.goto(`${BASE}/book/pay`)
    await attachProof(page)
    await page.getByRole('button', { name: 'Submit booking', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: ERROR }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('hdl:payment-proofs')), null)
    pass(`${timezoneId}: tampered payment draft fails before proof storage`)

    await page.goto(`${BASE}/book`)
    await fillDetails(page, '2026-10-31', 'Valid Boundary Guest')
    await page.locator('[data-tour="submit-booking"]').click()
    await page.waitForURL('**/book/pay')
    await attachProof(page)
    await page.getByRole('button', { name: 'Submit booking', exact: true }).click()
    await page.waitForURL('**/booking/status?id=*')
    await page.getByRole('heading', { name: 'Pending', exact: true }).waitFor()
    const booking = await page.evaluate(() => {
      const row = JSON.parse(localStorage.getItem('hdl:bookings') || '[]').find((b) => b.guest_name === 'Valid Boundary Guest')
      return row && { status: row.status, payment_status: row.payment_status,
        check_in: row.check_in, amount_claimed: row.amount_claimed, proof: row.payment_proof_url }
    })
    assert.equal(booking.status, 'Pending')
    assert.equal(booking.payment_status, 'pending')
    assert.equal(booking.check_in, '2026-10-31')
    assert.equal(booking.amount_claimed, 5000)
    assert.match(booking.proof, /^payments\/.+\/HDL-\d+\/proof-1.png$/)
    pass(`${timezoneId}: day-30 details → real demo upload → Pending → status works`)
    await context.close()
  }
  console.log(`\n${checks} browser checks passed; no production writes.`)
} finally {
  await browser.close()
}
