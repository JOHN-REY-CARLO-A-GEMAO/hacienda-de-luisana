import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocationSession } from '../../src/lib/liveLocationPolicy'

const api = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), publish: vi.fn() }))
vi.mock('../../src/lib/liveLocation', () => ({
  canShareLocation: () => true, unavailableReason: () => null,
  startSharing: api.start, stopSharing: api.stop, publishFix: api.publish,
}))
import { useLiveLocation, type UseLiveLocation } from '../../src/hooks/useLiveLocation'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLElement
let result: UseLiveLocation
const session = (id: string): LocationSession => ({
  id, conversation_id: id, guest_uid: 'guest', active: true,
  started_at_ms: Date.now(), expires_at_ms: Date.now() + 1_800_000,
  duration_minutes: 30, stream_secret: 'a'.repeat(32),
})
function View({ id }: { id: string }) { result = useLiveLocation({ convoId: id, uid: 'guest' }); return null }
function render(id: string) { act(() => root.render(<View id={id} />)) }
beforeEach(() => {
  api.start.mockReset(); api.stop.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { geolocation: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn() }, onLine: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
describe('live location conversation lifecycle', () => {
  it('stops the original conversation on switch and on unmount', async () => {
    api.start.mockResolvedValue({ ok: true, session: session('old') })
    render('old')
    await act(async () => { await result.start(30) })
    render('new')
    expect(api.stop).toHaveBeenCalledWith(expect.objectContaining({ convoId: 'old', uid: 'guest' }))
    expect(api.stop).not.toHaveBeenCalledWith(expect.objectContaining({ convoId: 'new' }))
    api.start.mockResolvedValue({ ok: true, session: session('new') })
    await act(async () => { await result.start(30) })
    act(() => root.unmount())
    expect(api.stop).toHaveBeenCalledWith(expect.objectContaining({ convoId: 'new' }))
    root = createRoot(host)
  })
  it('stops an in-flight start that completes after switching conversations', async () => {
    let resolve!: (value: unknown) => void
    api.start.mockImplementation(() => new Promise((done) => { resolve = done }))
    render('old')
    act(() => { void result.start(30) })
    render('new')
    await act(async () => { resolve({ ok: true, session: session('old') }); await Promise.resolve() })
    expect(api.stop).toHaveBeenCalledWith(expect.objectContaining({ convoId: 'old' }))
    expect(result.phase).not.toBe('active')
  })
})
