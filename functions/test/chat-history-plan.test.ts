import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { planGuestHistoryCopies, type HistorySource } from '../src/chatHistoryPlan'

const attachment = { path: 'messageAttachments/booking-1/m1', content_type: 'image/png', size: 123 }
const source: HistorySource = { id: 'booking-1', guestUid: 'user-a', messages: [{ id: 'm1', attachment }] }

test('plans deterministic paths without changing the source or copying anything', () => {
  const before = JSON.stringify(source)
  const [entry] = planGuestHistoryCopies('user-a', [source])
  assert.ok(entry)
  assert.match(entry.destinationMessageId, /^migrated-[a-f0-9]{64}$/)
  assert.equal(entry.attachment?.sourcePath, attachment.path)
  assert.equal(entry.attachment?.destinationPath, `messageAttachments/guest-user-a/${entry.destinationMessageId}`)
  assert.deepEqual(planGuestHistoryCopies('user-a', [source])[0], entry)
  assert.equal(JSON.stringify(source), before)
})

test('different source threads with the same message id get different destinations', () => {
  const plan = planGuestHistoryCopies('user-a', [source, { id: 'booking-2', guestUid: 'user-a', messages: [{ id: 'm1' }] }])
  assert.notEqual(plan[0]?.destinationMessageId, plan[1]?.destinationMessageId)
})

test('rejects foreign ownership, duplicate messages, and invalid attachment paths', () => {
  assert.throws(() => planGuestHistoryCopies('user-a', [{ ...source, guestUid: 'user-b' }]))
  assert.throws(() => planGuestHistoryCopies('user-a', [{ ...source, messages: [source.messages[0]!, source.messages[0]!] }]))
  assert.throws(() => planGuestHistoryCopies('user-a', [{ ...source, messages: [{ id: 'm1', attachment: { ...attachment, path: 'messageAttachments/booking-2/m1' } }] }]))
  assert.throws(() => planGuestHistoryCopies('user-a', [{ ...source, messages: [{ id: 'm1', attachment: { ...attachment, size: 0 } }] }]))
})

test('never plans a copy from the destination conversation itself', () => {
  assert.deepEqual(planGuestHistoryCopies('user-a', [{ id: 'guest-user-a', guestUid: 'user-a', messages: [{ id: 'existing' }] }]), [])
})

test('never completes after a failed copy and retries with the same identity', async () => {
  const { mergeGuestHistory } = await import('../src/chatHistoryPlan')
  let complete = false
  let failed = false
  const seen: string[] = []
  const port = {
    async lockAndList() { return [source] },
    async copyAndVerifyAttachment() {
      if (!failed) { failed = true; throw new Error('storage unavailable') }
    },
    async copyMessage(_uid: string, copy: { destinationMessageId: string }) { seen.push(copy.destinationMessageId) },
    async complete() { complete = true },
  }
  await assert.rejects(mergeGuestHistory('user-a', port))
  assert.equal(complete, false)
  assert.equal(await mergeGuestHistory('user-a', port), 1)
  assert.equal(complete, true)
  assert.equal(seen[0], planGuestHistoryCopies('user-a', [source])[0]?.destinationMessageId)
})

test('does not copy anything when the source inventory includes another guest', async () => {
  const { mergeGuestHistory } = await import('../src/chatHistoryPlan')
  let writes = 0
  const port = {
    async lockAndList() { return [source, { id: 'booking-other', guestUid: 'user-b', messages: [{ id: 'm2' }] }] },
    async copyAndVerifyAttachment() { writes++ },
    async copyMessage() { writes++ },
    async complete() { writes++ },
  }
  await assert.rejects(mergeGuestHistory('user-a', port))
  assert.equal(writes, 0)
})
