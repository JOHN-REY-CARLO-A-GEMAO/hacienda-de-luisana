import { describe, expect, it } from 'vitest'
import { submitReview } from '../../src/lib/reviewsCloud'
import { sendChatMessage } from '../../src/lib/chatCloud'

describe('reviews eligibility', () => {
  it('refuses a review before check-out', async () => {
    const r = await submitReview({
      bookingId: 'b1',
      uid: 'u1',
      stars: 5,
      text: 'nice',
      bookingStatus: 'Reserved',
    })
    expect(r.ok).toBe(false)
  })

  it('refuses invalid stars', async () => {
    const r = await submitReview({
      bookingId: 'b1',
      uid: 'u1',
      stars: 6,
      text: 'x',
      bookingStatus: 'Completed',
    })
    expect(r.ok).toBe(false)
  })
})

describe('chat validation', () => {
  it('refuses empty messages', async () => {
    const r = await sendChatMessage({ convoId: 'local:u1', uid: 'u1', text: '   ' })
    expect(r.ok).toBe(false)
  })
})
