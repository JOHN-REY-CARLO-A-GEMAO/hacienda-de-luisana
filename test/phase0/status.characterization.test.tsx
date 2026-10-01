// Real status component + real web cloud adapter with an SDK double in jsdom.
// Not a browser/cloud E2E run. Remote data updates do not create local events.
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
it('F24-ONE-SHOT: a remote Pending→Approved change does not refresh until a browser-local event occurs', async () => {
  putCloud(booking()); await show()
  expect(host.querySelector('h1')?.textContent).toBe('Pending')
  putCloud(approved())
  await act(async () => { await Promise.resolve() })
  expect(sdk.getDoc).toHaveBeenCalledTimes(1)
  expect(host.querySelector('h1')?.textContent).toBe('Pending')
  await act(async () => { window.dispatchEvent(new Event('hdl:bookings-updated')) })
  expect(host.querySelector('h1')?.textContent).toBe('Approved')
})
it.each(['Checked-In', 'Staying', 'Checked-Out', 'Completed', 'Reserved'])('F24-LATER-STATUS-%s: status badge is correct while headline/copy incorrectly describe Pending', async status => {
  putCloud(approved({ status })); await show()
  expect(host.textContent).toContain(`Status: ${status}`)
  expect(host.querySelector('h1')?.textContent).toBe('Pending')
  expect(host.textContent).toContain('It is not confirmed yet.')
})
it.each(['Approved', 'Rejected', 'Cancelled', 'Expired'])('FLOW-PRESENTATION-CONTROL: %s keeps its present title', async status => {
  putCloud(approved({ status })); await show()
  expect(host.querySelector('h1')?.textContent).toBe(status)
})
