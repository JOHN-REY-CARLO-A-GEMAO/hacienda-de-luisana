/**
 * The browser's half of the OCR.space read (`src/lib/payments/ocr-space.ts`,
 * ADR-0024).
 *
 * The engine lives in a Cloud Function, so what is worth asserting here is the
 * seam: which build turns the cloud read on, what exactly leaves the device, and
 * what happens when the callable refuses (a deployment with no key, or one where
 * `readReceiptText` was never deployed). Every one of those refusals has to
 * become a typed failure the caller can fall back from — never a raw Firebase
 * error shown to a Guest, and never a fabricated extraction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  call: vi.fn(),
  getFunctions: vi.fn(() => ({}) as unknown),
  connectFunctionsEmulator: vi.fn(),
}))

vi.mock('firebase/functions', () => ({
  getFunctions: sdk.getFunctions,
  connectFunctionsEmulator: sdk.connectFunctionsEmulator,
  httpsCallable: (_functions: unknown, name: string) => (payload: unknown) => sdk.call(name, payload),
}))

vi.mock('../../src/lib/firebase', () => ({
  app: {},
  db: {},
  auth: { currentUser: null },
  isFirebaseConfigured: true,
  isUsingEmulators: false,
}))

import {
  CloudOcrUnavailableError,
  OCR_SPACE_MAX_BYTES,
  blobToBase64,
  cloudReceiptOcrEnabled,
  prepareReceiptImage,
  readReceiptTextWithOcrSpace,
} from '../../src/lib/payments/ocr-space'

/** A 1×1 PNG, the smallest thing that is honestly an image. */
const PNG = Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

const pngFile = (bytes: number[] = PNG, name = 'receipt.png') =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' })

/** `File` in jsdom is a `Blob`; `new File([...])` copies the bytes. */
const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

beforeEach(() => {
  sdk.call.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cloudReceiptOcrEnabled', () => {
  it('is off unless the build says the literal word', () => {
    expect(cloudReceiptOcrEnabled({})).toBe(false)
    expect(cloudReceiptOcrEnabled({ VITE_RECEIPT_OCR_CLOUD: '' })).toBe(false)
    expect(cloudReceiptOcrEnabled({ VITE_RECEIPT_OCR_CLOUD: 'true' })).toBe(false)
    expect(cloudReceiptOcrEnabled({ VITE_RECEIPT_OCR_CLOUD: 'on' })).toBe(false)
    expect(cloudReceiptOcrEnabled({ VITE_RECEIPT_OCR_CLOUD: 'ocr.space' })).toBe(false)
  })

  it('accepts ocrspace in any casing or padding', () => {
    expect(cloudReceiptOcrEnabled({ VITE_RECEIPT_OCR_CLOUD: 'ocrspace' })).toBe(true)
    expect(cloudReceiptOcrEnabled({ VITE_RECEIPT_OCR_CLOUD: ' OCRSpace ' })).toBe(true)
  })
})

describe('prepareReceiptImage', () => {
  it('encodes a small screenshot as it is, under its own type', async () => {
    const payload = await prepareReceiptImage(pngFile())
    expect(payload.mimeType).toBe('image/png')
    expect([...Uint8Array.from(atob(payload.image), (c) => c.charCodeAt(0))]).toEqual(PNG)
  })

  it('keeps the payload inside the free plan’s 1 MB cap', async () => {
    const payload = await prepareReceiptImage(pngFile())
    const bytes = Math.floor((payload.image.replace(/=+$/, '').length * 3) / 4)
    expect(bytes).toBeLessThanOrEqual(OCR_SPACE_MAX_BYTES)
  })

  it('refuses things that are not images, and formats OCR.space does not take', async () => {
    expect((await rejection(prepareReceiptImage(new File(['x'], 'a.txt', { type: 'text/plain' }))))).toBeInstanceOf(
      CloudOcrUnavailableError,
    )
    const webp = new File([new Uint8Array(PNG)], 'a.webp', { type: 'image/webp' })
    expect(((await rejection(prepareReceiptImage(webp))) as CloudOcrUnavailableError).reason).toBe('image-unreadable')
  })

  it('refuses an empty file rather than sending zero bytes', async () => {
    const empty = new File([], 'empty.png', { type: 'image/png' })
    expect(((await rejection(prepareReceiptImage(empty))) as CloudOcrUnavailableError).reason).toBe('image-unreadable')
  })

  it('refuses an image it cannot shrink down to the cap', async () => {
    // jsdom has no `createImageBitmap` and no 2D canvas, so this is the raw path:
    // a file over the cap has to be refused, not truncated.
    const big = new File([new Uint8Array(OCR_SPACE_MAX_BYTES + 1)], 'big.png', { type: 'image/png' })
    expect(((await rejection(prepareReceiptImage(big))) as CloudOcrUnavailableError).reason).toBe('image-too-large')
  })

  it('strips the data-URL prefix from what FileReader hands back', async () => {
    const base64 = await blobToBase64(new Blob([new Uint8Array(PNG)], { type: 'image/png' }))
    expect(base64.startsWith('data:')).toBe(false)
    expect(base64.length).toBeGreaterThan(0)
  })
})

describe('readReceiptTextWithOcrSpace', () => {
  it('sends only the image and its type, and returns the text the function read', async () => {
    sdk.call.mockResolvedValue({ data: { text: 'Ref No. 7044 357 122304\nAmount 1,020.00' } })
    const text = await readReceiptTextWithOcrSpace(pngFile())
    expect(text).toBe('Ref No. 7044 357 122304\nAmount 1,020.00')
    expect(sdk.call).toHaveBeenCalledTimes(1)
    const [name, payload] = sdk.call.mock.calls[0] as [string, { image: string; mimeType: string }]
    expect(name).toBe('readReceiptText')
    expect(Object.keys(payload).sort()).toEqual(['image', 'mimeType'])
    expect(payload.mimeType).toBe('image/png')
  })

  it('treats a reply with no text as an empty read, not a crash', async () => {
    sdk.call.mockResolvedValue({ data: {} })
    await expect(readReceiptTextWithOcrSpace(pngFile())).resolves.toBe('')
  })

  it('a deployment with no key is a refusal the caller can fall back from', async () => {
    const error = Object.assign(new Error('not configured'), { code: 'functions/failed-precondition' })
    sdk.call.mockRejectedValue(error)
    const failure = (await rejection(readReceiptTextWithOcrSpace(pngFile()))) as CloudOcrUnavailableError
    expect(failure).toBeInstanceOf(CloudOcrUnavailableError)
    expect(failure.reason).toBe('callable-refused')
  })

  it('an undeployed function is also a refusal, not a Guest-facing error', async () => {
    for (const code of ['functions/unimplemented', 'functions/not-found']) {
      sdk.call.mockRejectedValue(Object.assign(new Error(code), { code }))
      const failure = (await rejection(readReceiptTextWithOcrSpace(pngFile()))) as CloudOcrUnavailableError
      expect(failure.reason).toBe('callable-refused')
    }
  })

  it('an offline phone or a spent quota is a temporary unavailability', async () => {
    for (const code of ['functions/unavailable', 'functions/resource-exhausted', 'functions/internal']) {
      sdk.call.mockRejectedValue(Object.assign(new Error(code), { code }))
      const failure = (await rejection(readReceiptTextWithOcrSpace(pngFile()))) as CloudOcrUnavailableError
      expect(failure.reason).toBe('callable-unavailable')
    }
  })

  it('never calls the function when there is nothing sendable', async () => {
    await rejection(readReceiptTextWithOcrSpace(new File(['hello'], 'note.txt', { type: 'text/plain' })))
    expect(sdk.call).not.toHaveBeenCalled()
  })
})
