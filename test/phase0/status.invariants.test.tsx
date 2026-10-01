import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { putCloud, resetCloudDouble } from './doubles/cloud'
import { approved, booking } from './fixtures'
import { BookingStatusPage } from '../../src/pages/BookingStatusPage'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

it('F24 DESIRED: a Staying booking must not be described as unconfirmed Pending', async () => {
  resetCloudDouble(); putCloud(approved({ status: 'Staying' }))
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/booking/status?id=${booking().id}`]}><BookingStatusPage /></MemoryRouter>) })
    expect(host.querySelector('h1')?.textContent).not.toBe('Pending')
    expect(host.textContent).not.toContain('It is not confirmed yet.')
  } finally { act(() => root.unmount()); host.remove() }
})
