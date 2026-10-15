import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { newCase, DEFAULT_POLICY } from '../../functions/src/domain'
const mocks = vi.hoisted(() => ({ rows: [] as any[], command: vi.fn(), readError: '', anonymous: false }))
vi.mock('../../src/lib/firebase', () => ({ auth: { get currentUser() { return { uid: 'guest-one', isAnonymous: mocks.anonymous } } }, app: null, db: null, isUsingEmulators: false }))
vi.mock('../../src/lib/disputes', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/disputes')>(),
  subscribeCases: (_uid: string, _booking: string, next: (rows: any[]) => void, error: (e: Error) => void) => { mocks.readError ? error(new Error(mocks.readError)) : next(mocks.rows); return () => {} },
  caseCommand: mocks.command,
  activityPage: async () => ({ items: [], hasMore: false }),
  subscribeEvidence: (_id: string, next: (files: any[]) => void) => { next([]); return () => {} },
}))
import { DisputeForm } from '../../src/components/DisputeForm'
let container: HTMLDivElement; let root: Root
beforeEach(() => {
  mocks.rows = []; mocks.readError = ''; mocks.anonymous = false; mocks.command.mockReset()
  mocks.command.mockResolvedValue({ caseId: 'case-one', reference: 'HDL-2026-000001', version: 1 })
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function render() { await act(async () => root.render(<MemoryRouter><DisputeForm guestId="guest-one" bookingId="booking-one" /></MemoryRouter>)) }
async function click(label: string) { const button = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label); expect(button, label).toBeTruthy(); await act(async () => { button!.click() }) }
async function write(value: string) {
  const area = container.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value); area.dispatchEvent(new Event('input', { bubbles: true })); area.dispatchEvent(new Event('change', { bubbles: true })) })
}
async function submitForm() { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }
describe('Guest dispute center', () => {
  it('requires review before sending and records server acknowledgement, not local success', async () => {
    await render(); await click('Report an Issue'); await write('The accommodation access instruction was incorrect.');
    await submitForm(); expect(mocks.command).not.toHaveBeenCalled(); expect(container.textContent).toContain('Review before submitting')
    await submitForm(); expect(mocks.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', bookingId: 'booking-one' })); expect(container.textContent).toContain('Submitted as HDL-2026-000001')
  })
  it('shows failure/uncertainty and never claims a rejected submission reached the Admin', async () => {
    mocks.command.mockRejectedValue(new Error('Backend unavailable'))
    await render(); await click('Report an Issue'); await write('This concern has enough detail to review.'); await submitForm(); await submitForm()
    expect(container.textContent).toContain('Submission is not confirmed'); expect(container.textContent).not.toContain('Submitted as')
  })
  it('does not mistake a permission/network failure for an empty history', async () => {
    mocks.readError = 'Permission denied'; await render(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Permission denied'); expect(container.textContent).not.toContain('No reports yet')
  })
  it('suggests a duplicate without blocking a genuinely new incident', async () => {
    mocks.rows = [{ id: 'case-one', ...newCase({ action: 'create', operationId: 'operation', category: 'other', description: 'An earlier report of a concern.', bookingId: 'booking-one' }, { uid: 'guest-one', admin: false, privacy: false }, Date.now(), 'HDL-2026-000001', DEFAULT_POLICY) }]
    await render(); await click('Report an Issue'); expect(container.textContent).toContain('You have an active case in this category'); expect(container.querySelector('textarea')).toBeTruthy()
  })
  it('clearly explains anonymous identity linking rather than accepting a reference as ownership', async () => {
    mocks.anonymous = true; await render(); expect(container.textContent).toContain('recoverable account'); expect(container.textContent).toContain('reference alone cannot recover ownership')
  })
  it('never renders stale records belonging to another Guest', async () => {
    mocks.rows = [{ id: 'foreign-case', ...newCase({ action: 'create', operationId: 'operation', category: 'other', description: 'Another Guest confidential concern.' }, { uid: 'guest-two', admin: false, privacy: false }, Date.now(), 'HDL-2026-SECRET', DEFAULT_POLICY) }]
    await render(); expect(container.textContent).not.toContain('HDL-2026-SECRET'); expect(container.textContent).not.toContain('confidential')
  })
})
