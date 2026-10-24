import { beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  uploadBytes: vi.fn(),
  getBlob: vi.fn(),
}))

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  getMetadata: cloud.getMetadata,
  uploadBytes: cloud.uploadBytes,
  getBlob: cloud.getBlob,
}))
vi.mock('../../src/lib/firebase', () => ({ isFirebaseConfigured: true, storage: {} }))

import {
  MESSAGE_IMAGE_MAX_BYTES,
  attachmentFailureMessage,
  messageAttachmentPath,
  parseChatAttachment,
  readMessageAttachment,
  uploadMessageAttachment,
  validateMessageImage,
} from '../../src/lib/chatAttachments'

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'gate.png', { type: 'image/png' })

beforeEach(() => {
  vi.clearAllMocks()
  cloud.uploadBytes.mockResolvedValue({})
  cloud.getMetadata.mockRejectedValue({ code: 'storage/object-not-found' })
  cloud.getBlob.mockResolvedValue(new Blob(['private'], { type: 'image/png' }))
})

describe('image selection validation', () => {
  it('accepts JPEG, PNG and WebP, including a mobile picker with an empty MIME type', () => {
    for (const [name, type] of [['a.jpg', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp'], ['a.jpg', '']]) {
      const result = validateMessageImage(new File(['image'], name, { type }))
      expect(result.ok).toBe(true)
    }
    expect(validateMessageImage(new File(['image'], 'a.jpg', { type: 'image/jpg' }))).toEqual({ ok: true, contentType: 'image/jpeg' })
  })

  it('refuses unsupported types, empty files, and anything over 5 MB', () => {
    for (const file of [
      new File(['x'], 'animation.gif', { type: 'image/gif' }),
      new File(['x'], 'photo.heic', { type: 'image/heic' }),
      new File(['x'], 'document.pdf', { type: 'application/pdf' }),
      new File(['x'], 'pretend.jpg', { type: 'text/plain' }),
      new File([], 'empty.png', { type: 'image/png' }),
      new File([new Uint8Array(MESSAGE_IMAGE_MAX_BYTES + 1)], 'large.png', { type: 'image/png' }),
    ]) {
      expect(validateMessageImage(file).ok).toBe(false)
    }
  })
})

describe('private Storage contract', () => {
  it('uploads to the stable conversation/message path with private metadata', async () => {
    const file = png()
    const result = await uploadMessageAttachment({ convoId: 'convo-1', messageId: 'message-1', file })
    expect(result).toEqual({ path: 'messageAttachments/convo-1/message-1', contentType: 'image/png', size: file.size })
    expect(cloud.uploadBytes).toHaveBeenCalledOnce()
    expect(cloud.uploadBytes.mock.calls[0][0]).toEqual({ path: 'messageAttachments/convo-1/message-1' })
    expect(cloud.uploadBytes.mock.calls[0][2]).toEqual({ contentType: 'image/png', cacheControl: 'private, no-store' })
  })

  it('reuses an object that reached Storage on an uncertain earlier attempt', async () => {
    const file = png()
    cloud.getMetadata.mockResolvedValue({ size: file.size, contentType: 'image/png' })
    const result = await uploadMessageAttachment({ convoId: 'convo-1', messageId: 'message-1', file })
    expect(result.path).toBe(messageAttachmentPath('convo-1', 'message-1'))
    expect(cloud.uploadBytes).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a different object at the same id', async () => {
    cloud.getMetadata.mockResolvedValue({ size: 999, contentType: 'image/png' })
    await expect(uploadMessageAttachment({ convoId: 'convo-1', messageId: 'message-1', file: png() })).rejects.toThrow(/already in use/i)
    expect(cloud.uploadBytes).not.toHaveBeenCalled()
  })

  it('reads authorized bytes instead of creating a public download URL', async () => {
    const blob = await readMessageAttachment({ path: 'messageAttachments/convo-1/message-1', contentType: 'image/png', size: 4 })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBe(7)
    expect(blob.type).toBe('image/png')
    expect(cloud.getBlob).toHaveBeenCalledWith({ path: 'messageAttachments/convo-1/message-1' }, MESSAGE_IMAGE_MAX_BYTES)
  })

  it('does not issue a Storage request for an invalid file', async () => {
    await expect(uploadMessageAttachment({ convoId: 'convo-1', messageId: 'message-1', file: new File(['x'], 'x.gif', { type: 'image/gif' }) })).rejects.toThrow(/JPEG, PNG, or WebP/)
    expect(cloud.getMetadata).not.toHaveBeenCalled()
    expect(cloud.uploadBytes).not.toHaveBeenCalled()
  })

  it('gives an expired/revoked session an actionable message', () => {
    expect(attachmentFailureMessage({ code: 'storage/unauthorized' })).toMatch(/sign in again/i)
  })
})

describe('message metadata parsing', () => {
  it('accepts only the small private attachment shape', () => {
    expect(parseChatAttachment({ path: 'messageAttachments/convo-1/message-1', content_type: 'image/png', size: 4 })).toEqual({
      path: 'messageAttachments/convo-1/message-1', contentType: 'image/png', size: 4,
    })
    expect(parseChatAttachment({ path: 'gallery/public.png', content_type: 'image/png', size: 4 })).toBeUndefined()
    expect(parseChatAttachment({ path: 'messageAttachments/convo-1/message-1', content_type: 'image/gif', size: 4 })).toBeUndefined()
  })
})
