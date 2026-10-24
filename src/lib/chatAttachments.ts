// ----------------------------------------------------------------------------
// Private Guest ↔ Admin image attachments.
//
// The bytes live in Firebase Storage, never in a public bucket and never as a
// Firestore data URL. Storage rules check the caller against the conversation
// (or its Admin role) on every upload and read. The clients fetch bytes through
// the authenticated SDK and turn them into short-lived local object URLs; no
// long-lived, shareable Firebase download token is created.
//
// Demo mode is deliberately separate: it stores the selected image only in this
// browser, just like demo chat. It is real local persistence for UI development,
// not a simulated cloud upload and not a promise that an Admin received it.
// ----------------------------------------------------------------------------

import {
  getBlob,
  getMetadata,
  ref,
  uploadBytes,
} from 'firebase/storage'
import { isFirebaseConfigured, storage } from './firebase'
import { MAX_FILE_SIZE_BYTES } from './validation'

export const MESSAGE_IMAGE_MAX_BYTES = MAX_FILE_SIZE_BYTES
export const MESSAGE_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type MessageImageMime = (typeof MESSAGE_IMAGE_MIME_TYPES)[number]

export type ChatAttachment = {
  /** Storage object path, bound to the conversation and message document id. */
  path: string
  contentType: MessageImageMime
  size: number
}

export type PendingChatImage = {
  /** Stable for the life of this draft, including every retry. */
  id: string
  file: File
  contentType: MessageImageMime
  previewUrl: string
}

export type ImageValidation =
  | { ok: true; contentType: MessageImageMime }
  | { ok: false; message: string }

export function messageImageType(file: Pick<File, 'name' | 'type'>): MessageImageMime | null {
  const declared = file.type.toLowerCase()
  if (declared === 'image/jpg') return 'image/jpeg'
  if ((MESSAGE_IMAGE_MIME_TYPES as readonly string[]).includes(declared)) {
    return declared as MessageImageMime
  }
  // A few mobile pickers return an empty MIME type. Infer only in that case;
  // an explicitly wrong type must not become acceptable because of a suffix.
  if (!declared) {
    if (/\.jpe?g$/i.test(file.name)) return 'image/jpeg'
    if (/\.png$/i.test(file.name)) return 'image/png'
    if (/\.webp$/i.test(file.name)) return 'image/webp'
  }
  return null
}

export function validateMessageImage(file: File | null | undefined): ImageValidation {
  if (!file) return { ok: false, message: 'Choose an image to attach.' }
  const contentType = messageImageType(file)
  if (!contentType) {
    return { ok: false, message: 'Choose a JPEG, PNG, or WebP image. HEIC, GIF, PDF, and other files are not supported.' }
  }
  if (file.size <= 0) return { ok: false, message: 'That image is empty. Choose another file.' }
  if (file.size > MESSAGE_IMAGE_MAX_BYTES) {
    return { ok: false, message: 'Images must be 5 MB or smaller. Choose a smaller image and try again.' }
  }
  return { ok: true, contentType }
}

export function messageAttachmentPath(convoId: string, messageId: string): string {
  return `messageAttachments/${convoId}/${messageId}`
}

/** Parse the small metadata map stored beside a message, never object bytes. */
export function parseChatAttachment(value: unknown): ChatAttachment | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  const path = typeof data.path === 'string' ? data.path : ''
  const contentType = typeof data.content_type === 'string' ? data.content_type : ''
  const size = typeof data.size === 'number' ? data.size : 0
  if (
    !/^messageAttachments\/[^/]+\/[^/]+$/.test(path) ||
    !(MESSAGE_IMAGE_MIME_TYPES as readonly string[]).includes(contentType) ||
    !Number.isInteger(size) ||
    size <= 0 ||
    size > MESSAGE_IMAGE_MAX_BYTES
  ) {
    return undefined
  }
  return { path, contentType: contentType as MessageImageMime, size }
}

export function attachmentDocument(attachment: ChatAttachment) {
  return {
    path: attachment.path,
    content_type: attachment.contentType,
    size: attachment.size,
  }
}

// ---------------------------------------------------------------------------
// Demo browser storage
// ---------------------------------------------------------------------------

const LOCAL_IMAGES_KEY = 'hdl:chat-images'
type LocalImage = { contentType: MessageImageMime; dataUrl: string }

function localImages(): Record<string, LocalImage> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_IMAGES_KEY) || '{}') as Record<string, LocalImage>
  } catch {
    return {}
  }
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The selected image could not be read.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

async function uploadLocalImage(path: string, file: File, contentType: MessageImageMime): Promise<ChatAttachment> {
  const images = localImages()
  const existing = images[path]
  if (existing) {
    const size = dataUrlSize(existing.dataUrl)
    if (existing.contentType !== contentType || size !== file.size) {
      throw new Error('This draft identifier is already in use. Remove the image and select it again.')
    }
    return { path, contentType, size }
  }
  const dataUrl = await fileAsDataUrl(file)
  try {
    localStorage.setItem(LOCAL_IMAGES_KEY, JSON.stringify({ ...images, [path]: { contentType, dataUrl } }))
  } catch {
    throw new Error('This browser has no room for the demo image. Remove older demo messages or choose a smaller image.')
  }
  return { path, contentType, size: file.size }
}

function dataUrlSize(dataUrl: string): number {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding)
}

function readLocalImage(path: string): Blob {
  const image = localImages()[path]
  if (!image) throw new Error('This demo image is no longer available in this browser.')
  const encoded = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: image.contentType })
}

// ---------------------------------------------------------------------------
// Authenticated private Storage
// ---------------------------------------------------------------------------

function errorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code ?? '').toLowerCase()
}

export function isAuthOrPermissionError(error: unknown): boolean {
  const code = errorCode(error)
  return code.includes('unauthenticated') || code.includes('unauthorized') || code.includes('permission-denied')
}

export function attachmentFailureMessage(error: unknown): string {
  if (isAuthOrPermissionError(error)) {
    return 'Your session or conversation access has expired. Refresh and sign in again before retrying this private image.'
  }
  if (error instanceof Error && !errorCode(error) && error.message) return error.message
  return 'The image could not be sent. Check your connection and retry; your image and caption are still here.'
}

/**
 * Upload once at the draft's stable path. If a previous attempt actually stored
 * the bytes but its response was lost, the retry reuses that object rather than
 * overwriting it or creating another message. Storage rules make objects
 * create-only, so the metadata check is part of the idempotency contract.
 */
export async function uploadMessageAttachment(input: {
  convoId: string
  messageId: string
  file: File
  contentType?: MessageImageMime
}): Promise<ChatAttachment> {
  const validation = validateMessageImage(input.file)
  if (!validation.ok) throw new Error(validation.message)
  const contentType = input.contentType ?? validation.contentType
  const path = messageAttachmentPath(input.convoId, input.messageId)

  if (!isFirebaseConfigured || input.convoId.startsWith('local:')) {
    return uploadLocalImage(path, input.file, contentType)
  }
  if (!storage) throw new Error('Private image storage is not configured in this build.')

  const objectRef = ref(storage, path)
  let existingSize: number | null = null
  let existingType: string | null = null
  try {
    const metadata = await getMetadata(objectRef)
    existingSize = metadata.size
    existingType = metadata.contentType ?? null
  } catch (error) {
    if (!errorCode(error).includes('object-not-found')) throw error
  }

  if (existingSize !== null) {
    if (existingSize !== input.file.size || existingType !== contentType) {
      throw new Error('This upload identifier is already in use. Remove the image and select it again.')
    }
  } else {
    await uploadBytes(objectRef, input.file, {
      contentType,
      cacheControl: 'private, no-store',
    })
  }
  return { path, contentType, size: input.file.size }
}

/** Authenticated byte read. Deliberately not getDownloadURL(). */
export async function readMessageAttachment(attachment: ChatAttachment): Promise<Blob> {
  const parsed = parseChatAttachment(attachmentDocument(attachment))
  if (!parsed) throw new Error('This attachment has an invalid storage path.')
  if (!isFirebaseConfigured || attachment.path.startsWith('messageAttachments/local:')) {
    return readLocalImage(attachment.path)
  }
  if (!storage) throw new Error('Private image storage is not configured in this build.')
  return getBlob(ref(storage, attachment.path), MESSAGE_IMAGE_MAX_BYTES)
}
