// Real status component + real web cloud adapter with an SDK double in jsdom.
// Not a browser/cloud E2E run. Remote data updates do not create local events.
//
// The presentation assertions were re-characterized when /booking/status was
// rewritten (docs/UI_UX_AUDIT.md): the page used to print the status twice — as
// an `h1` reading "Pending" and again as "Status: …" — so a Booking that had
// moved on to Staying was still headlined Pending. The badge is now the single
// place the status is named (`data-status`), and the heading states what the
// status means for the Guest. The one-shot refresh behaviour is unchanged.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { sdk, putCloud, resetCloudDouble } from './doubles/cloud'
import { booking, approved } from './fixtures'
import { BookingStatusPage } from '../../src/pages/BookingStatusPage'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLDivElement
beforeEach(() => { resetCloudDouble(); host = document.createElement('div'); document.body.appendChild(host) })
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host.remove() })
async function show() {
  root = createRoot(host)
  await act(async () => { root!.render(<MemoryRouter initialEntries={[`/booking/status?id=${booking().id}`]}><BookingStatusPage /></MemoryRouter>) })
}
/** The status the page is showing — read from the badge, not from the prose. */
function shownStatus(): string | null {
  return host.querySelector('[data-status]')?.getAttribute('data-status') ?? null
}
it('F24-ONE-SHOT: a remote Pending→Approved change does not refresh until a browser-local event occurs', async () => {
  putCloud(booking()); await show()
  expect(shownStatus()).toBe('Pending')
  expect(host.querySelector('h1')?.textContent).toBe('Waiting for the Hacienda')
  putCloud(approved())
  await act(async () => { await Promise.resolve() })
  expect(sdk.getDoc).toHaveBeenCalledTimes(1)
  expect(shownStatus()).toBe('Pending')
  await act(async () => { window.dispatchEvent(new Event('hdl:bookings-updated')) })
  expect(shownStatus()).toBe('Approved')
  expect(host.querySelector('h1')?.textContent).toBe('Your stay is confirmed')
})
it.each([
  ['Checked-In', 'You are checked in'],
  ['Staying', 'You are checked in'],
  ['Checked-Out', 'This stay is complete'],
  ['Completed', 'This stay is complete'],
  ['Reserved', 'Your stay is reserved'],
])('F24-LATER-STATUS-%s: the page describes the status it is actually in', async (status, headline) => {
  putCloud(approved({ status })); await show()
  expect(shownStatus()).toBe(status)
  expect(host.querySelector('h1')?.textContent).toBe(headline)
  expect(host.textContent).not.toContain('It is not confirmed yet.')
})
it.each([
  ['Approved', 'Your stay is confirmed'],
  ['Rejected', 'This booking was not approved'],
  ['Cancelled', 'This booking was cancelled'],
  ['Expired', 'This booking expired'],
])('FLOW-PRESENTATION-CONTROL: %s keeps its present title', async (status, headline) => {
  putCloud(approved({ status })); await show()
  expect(host.querySelector('h1')?.textContent).toBe(headline)
  expect(shownStatus()).toBe(status)
})
