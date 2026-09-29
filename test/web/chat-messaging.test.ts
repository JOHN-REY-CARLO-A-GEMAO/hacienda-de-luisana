// ----------------------------------------------------------------------------
// Messaging: the limits, the pagination, and the retention policy.
//
// Three things are being pinned here, and each of them is a cost decision that
// a later change could quietly undo:
//
//   1. A message is 1,000 characters. The website refuses the thousand-and-
//      first, the module refuses it, and `firestore.rules` refuses it (the rules
//      half is `test/rules/firestore-rules.test.ts`; the mirror that keeps the
//      two numbers from drifting is asserted here).
//   2. A thread is read a page at a time. With no Firebase configured the same
//      pagination runs against this browser's `hdl:chat`, so the assertions are
//      about the real module and not about a mock of it.
//   3. Retention is a policy with a start and an end: no expiry while a Booking
//      is live, an expiry ninety days after it closes, and a Guest cannot move
//      that stamp.
// ----------------------------------------------------------------------------
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CHAT_MAX_PAGE_SIZE,
  CHAT_PAGE_SIZE,
  loadMessagePage,
  mergeMessages,
  sendChatMessage,
  subscribeMessages,
  type ChatMessage,
  type MessageCursor,
} from '../../src/lib/chatCloud'
import {
  CHAT_RETENTION_DAYS,
  RETENTION_FIELD,
  retentionDaysLeft,
  retentionElapsed,
  retentionExpiry,
  retentionPatch,
} from '../../src/lib/chatRetention'
import { MESSAGE_MAX, validateMessage } from '../../src/lib/validation'

const LOCAL_KEY = 'hdl:chat'

function seedLocal(count: number) {
  const messages: ChatMessage[] = Array.from({ length: count }, (_, i) => ({
    id: `m${String(i).padStart(4, '0')}`,
    text: `message ${i}`,
    at: new Date(Date.parse('2026-10-01T00:00:00.000Z') + i * 1000).toISOString(),
    mine: true,
    sender_uid: 'u1',
  }))
  localStorage.setItem(LOCAL_KEY, JSON.stringify(messages))
}

beforeEach(() => {
  localStorage.clear()
})

describe('how long a message may be', () => {
  it('is 1,000 characters, and the rules agree', () => {
    expect(MESSAGE_MAX).toBe(1000)
    const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
    // The number the website enforces and the number the backend enforces are
    // two places that can drift; this is the assertion that keeps them one.
    expect(rules).toContain('request.resource.data.text.size() <= 1000')
  })

  it('takes a message of exactly the limit and refuses one character more', () => {
    expect(validateMessage('x'.repeat(MESSAGE_MAX)).ok).toBe(true)
    const over = validateMessage('x'.repeat(MESSAGE_MAX + 1))
    expect(over.ok).toBe(false)
    expect(over.ok === false && over.message).toContain('1000')
  })

  it('refuses to send an over-long message, not just to type it', async () => {
    seedLocal(0)
    const result = await sendChatMessage({
      convoId: 'local:u1',
      uid: 'u1',
      text: 'y'.repeat(MESSAGE_MAX + 1),
    })
    expect(result.ok).toBe(false)
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]')).toHaveLength(0)
  })

  it('refuses an empty message and one that is only whitespace', async () => {
    expect((await sendChatMessage({ convoId: 'local:u1', uid: 'u1', text: '   ' })).ok).toBe(false)
    expect(validateMessage('  \n ').ok).toBe(false)
  })
})

describe('reading a thread a page at a time', () => {
  it('opens with one page, never the whole conversation', async () => {
    seedLocal(500)
    const page = await loadMessagePage({ convoId: 'local:u1', uid: 'u1' })
    expect(page.messages).toHaveLength(CHAT_PAGE_SIZE)
    // The newest messages, not the oldest.
    expect(page.messages.at(-1)?.text).toBe('message 499')
    expect(page.messages[0]?.text).toBe(`message ${500 - CHAT_PAGE_SIZE}`)
    expect(page.hasMore).toBe(true)
  })

  it('walks the whole thread backwards, a page at a time, without repeating or skipping', async () => {
    seedLocal(500)
    const seen: string[] = []
    let before: MessageCursor | null = null
    let reads = 0

    for (;;) {
      const page = await loadMessagePage({
        convoId: 'local:u1',
        uid: 'u1',
        before,
        pageSize: 50,
      })
      reads += 1
      seen.unshift(...page.messages.map((m) => m.id))
      before = page.cursor
      if (!page.hasMore) break
      if (reads > 50) throw new Error('pagination did not terminate')
    }

    // Ten pages of fifty reach five hundred messages, each seen exactly once…
    expect(reads).toBe(10)
    expect(seen).toHaveLength(500)
    expect(new Set(seen).size).toBe(500)
    // …and the thread reads oldest → newest once assembled.
    expect(seen[0]).toBe('m0000')
    expect(seen.at(-1)).toBe('m0499')
  })

  it('refuses a page larger than the cap, however it is asked for', async () => {
    seedLocal(500)
    const page = await loadMessagePage({ convoId: 'local:u1', uid: 'u1', pageSize: 10_000 })
    expect(page.messages.length).toBeLessThanOrEqual(CHAT_MAX_PAGE_SIZE)
  })

  it('says so when there is nothing older left', async () => {
    seedLocal(4)
    const page = await loadMessagePage({ convoId: 'local:u1', uid: 'u1' })
    expect(page.messages).toHaveLength(4)
    expect(page.hasMore).toBe(false)
  })

  it('never lets a page grow without bound', () => {
    expect(CHAT_MAX_PAGE_SIZE).toBeLessThanOrEqual(50)
  })

  it('bounds the realtime listener to the same page, and lets it go', () => {
    seedLocal(120)
    let seen: ChatMessage[] = []
    let hasMore = false
    const unsubscribe = subscribeMessages('local:u1', 'u1', (page) => {
      seen = page.messages
      hasMore = page.hasMore
    })
    expect(seen).toHaveLength(CHAT_PAGE_SIZE)
    expect(seen.at(-1)?.text).toBe('message 119')
    // The same delivery says whether an older page exists, so the UI does not
    // need a second read to find out.
    expect(hasMore).toBe(true)
    // Unsubscribing is what stops a closed tab from holding a listener open.
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })

  it('merges a page into a thread without showing a message twice', () => {
    const a: ChatMessage = { id: 'a', text: 'hi', at: '2026-10-01T00:00:01.000Z', mine: true, sender_uid: 'u1' }
    const b: ChatMessage = { id: 'b', text: 'hello', at: '2026-10-01T00:00:02.000Z', mine: false, sender_uid: 'admin' }
    const merged = mergeMessages([a, b], [b, a])
    expect(merged.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('retention — a finished thread is disposable, a Booking is not', () => {
  it('stamps nothing while the Booking is still live', () => {
    for (const status of ['Pending', 'Approved', 'Checked-In', 'Staying', 'Reserved']) {
      expect(retentionPatch({ status, closedAt: '2026-10-01T00:00:00.000Z' })).toBeNull()
    }
  })

  it('stamps ninety days after a terminal status', () => {
    const patch = retentionPatch({ status: 'Completed', closedAt: '2026-10-01T00:00:00.000Z' })
    expect(patch).not.toBeNull()
    expect(patch?.[RETENTION_FIELD].toISOString()).toBe('2026-12-30T00:00:00.000Z')
    expect(CHAT_RETENTION_DAYS).toBe(90)
  })

  it('stamps every terminal branch, so a rejected booking is swept too', () => {
    for (const status of ['Completed', 'Cancelled', 'Rejected', 'Expired']) {
      expect(retentionPatch({ status, closedAt: '2026-10-01T00:00:00.000Z' })).not.toBeNull()
    }
  })

  it('never moves the expiry to a past date, whatever the window asked for', () => {
    expect(retentionExpiry('2026-10-01T00:00:00.000Z', 0).toISOString()).toBe('2026-10-02T00:00:00.000Z')
    expect(retentionExpiry('2026-10-01T00:00:00.000Z', -5).toISOString()).toBe('2026-10-02T00:00:00.000Z')
  })

  it('reports the window as elapsed only once it has passed', () => {
    const now = new Date('2026-12-01T00:00:00.000Z')
    expect(retentionElapsed(null, now)).toBe(false)
    expect(retentionElapsed('2026-12-30T00:00:00.000Z', now)).toBe(false)
    expect(retentionElapsed('2026-11-30T00:00:00.000Z', now)).toBe(true)
    expect(retentionDaysLeft('2026-12-31T00:00:00.000Z', now)).toBe(30)
    expect(retentionDaysLeft('2026-11-30T00:00:00.000Z', now)).toBe(0)
    expect(retentionDaysLeft(null, now)).toBeNull()
  })

  it('leaves the stamp to the Admin: the rules do not let a Guest set it', () => {
    const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
    const guestFields = rules
      .split('\n')
      .filter((line) => line.includes("hasOnly(['updated_at', 'last_message', 'unread_admin', 'unread_guest'])"))
    expect(guestFields).toHaveLength(1)
    expect(guestFields[0]).not.toContain(RETENTION_FIELD)
    // …and a Guest cannot open a thread with an expiry already on it either.
    expect(rules).toContain("!request.resource.data.keys().hasAny(['messages_expires_at'])")
  })
})
