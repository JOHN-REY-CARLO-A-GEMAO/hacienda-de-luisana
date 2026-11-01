/**
 * Which engine reads the screenshot, and what the Guest is told either way
 * (ADR-0024).
 *
 * `runReceiptOcr` tries OCR.space first when the build says so, and tesseract.js
 * otherwise — including when the cloud read fails. This file asserts the order
 * and the fallback, with both engines mocked so nothing is downloaded: the real
 * tesseract.js fetches a worker and an English model, which a hermetic suite
 * cannot do and a unit test should not try.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const engine = vi.hoisted(() => ({
  cloudRead: vi.fn(),
  recognize: vi.fn(),
}))

vi.mock('../../src/lib/payments/ocr-space', () => ({
  readReceiptTextWithOcrSpace: engine.cloudRead,
}))

vi.mock('tesseract.js', () => ({
  recognize: engine.recognize,
}))

import { cloudReceiptOcrConfigured, runReceiptOcr } from '../../src/lib/payments/ocr'

// jsdom's File predates the ReadableStream-era API, and `runReceiptOcr` reads a
// text sidecar with `.text()`. Every other suite that exercises this path
// polyfills the same two methods.
beforeAll(() => {
  if (typeof File.prototype.text !== 'function') {
    Object.defineProperty(File.prototype, 'text', {
      configurable: true,
      value(this: File): Promise<string> {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
          reader.onerror = () => reject(reader.error ?? new Error('read failed'))
          reader.readAsText(this)
        })
      },
    })
  }
})

const screenshot = () => new File([new Uint8Array([1, 2, 3, 4])], 'receipt.png', { type: 'image/png' })
const textFile = (text: string) => new File([text], 'receipt.txt', { type: 'text/plain' })

const GCASH_TEXT = ['Amount 1,020.00', 'Total Amount Sent 1,020.00', 'Ref No. 7044 357 Aug 26, 2026 10:23', '122304 AM'].join(
  '\n',
)

beforeEach(() => {
  engine.cloudRead.mockReset()
  engine.recognize.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the build switch', () => {
  it('is off by default, so receipts stay on the Guest’s device', () => {
    expect(cloudReceiptOcrConfigured()).toBe(false)
    vi.stubEnv('VITE_RECEIPT_OCR_CLOUD', 'ocrspace')
    expect(cloudReceiptOcrConfigured()).toBe(true)
  })
})

describe('runReceiptOcr with the cloud read on', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_RECEIPT_OCR_CLOUD', 'ocrspace')
  })

  it('prefers OCR.space and parses what the function read', async () => {
    engine.cloudRead.mockResolvedValue(GCASH_TEXT)
    const fields = await runReceiptOcr(screenshot())
    expect(fields.reference).toBe('7044357122304')
    expect(fields.amount).toBe('1020.00')
    expect(engine.cloudRead).toHaveBeenCalledTimes(1)
    expect(engine.recognize).not.toHaveBeenCalled()
  })

  it('asks the Guest to type when the screenshot had no text, instead of downloading tesseract', async () => {
    engine.cloudRead.mockResolvedValue('   ')
    const fields = await runReceiptOcr(screenshot())
    expect(fields.confidence).toBe('none')
    expect(fields.notes.join(' ')).toMatch(/No text found/)
    expect(engine.recognize).not.toHaveBeenCalled()
  })

  it('falls back to the browser engine when the callable refuses or is unreachable', async () => {
    engine.cloudRead.mockRejectedValue(new Error('failed-precondition'))
    engine.recognize.mockResolvedValue({ data: { text: GCASH_TEXT } })
    const fields = await runReceiptOcr(screenshot())
    expect(engine.cloudRead).toHaveBeenCalledTimes(1)
    expect(engine.recognize).toHaveBeenCalledTimes(1)
    expect(fields.reference).toBe('7044357122304')
  })

  it('still tells the Guest to type when both engines read nothing', async () => {
    engine.cloudRead.mockRejectedValue(new Error('offline'))
    engine.recognize.mockResolvedValue({ data: { text: '' } })
    const fields = await runReceiptOcr(screenshot())
    expect(fields.confidence).toBe('none')
    expect(fields.notes.join(' ')).toMatch(/Enter the details yourself/)
  })

  it('a text sidecar is parsed directly, with no engine and no network', async () => {
    const fields = await runReceiptOcr(textFile(GCASH_TEXT))
    expect(fields.reference).toBe('7044357122304')
    expect(engine.cloudRead).not.toHaveBeenCalled()
    expect(engine.recognize).not.toHaveBeenCalled()
  })
})

describe('runReceiptOcr with the cloud read off', () => {
  it('never calls the function, even when one is deployed', async () => {
    engine.recognize.mockResolvedValue({ data: { text: GCASH_TEXT } })
    const fields = await runReceiptOcr(screenshot())
    expect(engine.cloudRead).not.toHaveBeenCalled()
    expect(engine.recognize).toHaveBeenCalledTimes(1)
    expect(fields.reference).toBe('7044357122304')
  })
})
