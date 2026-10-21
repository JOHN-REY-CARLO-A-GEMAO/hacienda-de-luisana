// ----------------------------------------------------------------------------
// Guest and Admin Notifications Service (Firestore)
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// A notification is a small document in `notifications`, addressed by `user_id`:
// a Guest's uid for what the Hacienda tells them, or the shared `admin` inbox
// for what a Guest tells the Hacienda (firestore.rules allows exactly these two
// addressees on create).
//
// Two writers share the collection: this website and the Flutter Admin app. The
// Admin app stamps `created_at` with a server Timestamp; the website stamps an
// ISO string. Everything read from here goes through `normalizeNotification`, so
// a Guest sees a real date and a sensible order whichever side wrote the row.
// ----------------------------------------------------------------------------

import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'

export type NotificationType =
  | 'booking_submitted'
  | 'booking_approved'
  | 'booking_rejected'
  | 'payment_verified'
  | 'payment_rejected'
  | 'cancellation_result'
  | 'cancellation_by_guest'
  | 'reschedule_result'
  | 'general'

export type AppNotification = {
  id: string
  user_id: string
  booking_id?: string
  title: string
  message: string
  type: NotificationType
  /** Always an ISO string by the time anything outside this file sees it. */
  created_at: string
  read: boolean
}

/** The shared inbox the Admin app reads. firestore.rules lets a Guest write to it, never read it. */
export const ADMIN_INBOX_ID = 'admin'

const LOCAL_NOTIFS_KEY = 'hdl_guest_notifications'
const LOCAL_EVENT = 'hdl:notifications-updated'

const KNOWN_TYPES: ReadonlySet<string> = new Set<NotificationType>([
  'booking_submitted',
  'booking_approved',
  'booking_rejected',
  'payment_verified',
  'payment_rejected',
  'cancellation_result',
  'cancellation_by_guest',
  'reschedule_result',
  'general',
])

// ---------------------------------------------------------------------------
// Reading what the two writers stored
// ---------------------------------------------------------------------------

/**
 * `created_at` as an ISO string, whatever shape it was stored in.
 *
 * A Firestore Timestamp (what the Admin app writes) has `toDate()`; a plain
 * object from a serialised one has `seconds`; the website writes a string. A
 * value that is none of those becomes "now" rather than "Invalid Date".
 */
export function normalizeCreatedAt(raw: unknown): string {
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw).toISOString()
  }
  if (raw && typeof raw === 'object') {
    const candidate = raw as { toDate?: () => Date; seconds?: unknown }
    if (typeof candidate.toDate === 'function') {
      try {
        const date = candidate.toDate()
        if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString()
      } catch {
        // fall through to "now"
      }
    }
    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000).toISOString()
  }
  return new Date().toISOString()
}

/** One stored document as the app reads it. Anything the app does not know becomes `general`. */
export function normalizeNotification(id: string, data: Record<string, unknown>): AppNotification {
  const type = typeof data.type === 'string' && KNOWN_TYPES.has(data.type) ? (data.type as NotificationType) : 'general'
  return {
    id,
    user_id: typeof data.user_id === 'string' ? data.user_id : '',
    ...(typeof data.booking_id === 'string' && data.booking_id ? { booking_id: data.booking_id } : {}),
    title: typeof data.title === 'string' && data.title ? data.title : 'Notification',
    message: typeof data.message === 'string' ? data.message : '',
    type,
    created_at: normalizeCreatedAt(data.created_at),
    read: data.read === true,
  }
}

/** Newest first, by the normalised date. Sorted here so no composite index is needed. */
function newestFirst(list: AppNotification[]): AppNotification[] {
  return [...list].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

// ---------------------------------------------------------------------------
// Demo / offline fallback
// ---------------------------------------------------------------------------

function readAllLocal(): AppNotification[] {
  try {
    const raw = localStorage.getItem(LOCAL_NOTIFS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AppNotification[]) : []
  } catch {
    return []
  }
}

function getLocalNotifications(userId: string): AppNotification[] {
  return readAllLocal().filter((n) => n.user_id === userId)
}

function saveLocalNotifications(notifications: AppNotification[]): void {
  try {
    localStorage.setItem(LOCAL_NOTIFS_KEY, JSON.stringify(notifications))
    window.dispatchEvent(new Event(LOCAL_EVENT))
  } catch {
    // Ignore storage quota errors
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Creates a notification in Firestore (or localStorage in demo mode).
 *
 * Never throws: a notification that cannot be written must not undo the Booking
 * action that caused it.
 */
export async function createNotification(params: {
  userId: string
  bookingId?: string
  title: string
  message: string
  type: NotificationType
}): Promise<void> {
  const item: Omit<AppNotification, 'id'> = {
    user_id: params.userId,
    ...(params.bookingId ? { booking_id: params.bookingId } : {}),
    title: params.title,
    message: params.message,
    type: params.type,
    created_at: new Date().toISOString(),
    read: false,
  }

  if (isFirebaseConfigured && db) {
    try {
      await addDoc(collection(db, 'notifications'), item)
      return
    } catch (err) {
      console.warn('[Notifications] Firestore create failed, falling back to local:', err)
    }
  }

  // Demo / local fallback
  const notif: AppNotification = {
    ...item,
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  }
  saveLocalNotifications([notif, ...readAllLocal()])
}

/** Tell the Admin app something happened on a Booking. Same guarantees as `createNotification`. */
export function notifyAdmin(params: {
  bookingId?: string
  title: string
  message: string
  type: NotificationType
}): Promise<void> {
  return createNotification({ userId: ADMIN_INBOX_ID, ...params })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Fetches notifications for a given user, newest first. */
export async function fetchUserNotifications(userId: string): Promise<AppNotification[]> {
  if (!userId) return []

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(query(collection(db, 'notifications'), where('user_id', '==', userId)))
      return newestFirst(snap.docs.map((d) => normalizeNotification(d.id, d.data())))
    } catch (err) {
      console.warn('[Notifications] Firestore fetch failed, trying local fallback:', err)
    }
  }

  return newestFirst(getLocalNotifications(userId))
}

/**
 * Keep a Guest's notifications live: the callback runs now and again every time
 * one arrives or is read, so the bell updates without a page reload.
 *
 * Returns the unsubscribe function.
 */
export function subscribeUserNotifications(
  userId: string | null | undefined,
  onChange: (list: AppNotification[]) => void,
): () => void {
  if (!userId) {
    onChange([])
    return () => {}
  }

  const emitLocal = () => onChange(newestFirst(getLocalNotifications(userId)))

  if (isFirebaseConfigured && db) {
    let fellBack = false
    const unsubscribe = onSnapshot(
      query(collection(db, 'notifications'), where('user_id', '==', userId)),
      (snap) => onChange(newestFirst(snap.docs.map((d) => normalizeNotification(d.id, d.data())))),
      (err) => {
        // A refused or unreachable listener is not a reason to show nothing: the
        // local list still holds anything written while offline.
        console.warn('[Notifications] Live listener failed, using the local list:', err)
        fellBack = true
        emitLocal()
      },
    )
    const onLocal = () => {
      if (fellBack) emitLocal()
    }
    window.addEventListener(LOCAL_EVENT, onLocal)
    return () => {
      unsubscribe()
      window.removeEventListener(LOCAL_EVENT, onLocal)
    }
  }

  emitLocal()
  window.addEventListener(LOCAL_EVENT, emitLocal)
  window.addEventListener('storage', emitLocal)
  return () => {
    window.removeEventListener(LOCAL_EVENT, emitLocal)
    window.removeEventListener('storage', emitLocal)
  }
}

// ---------------------------------------------------------------------------
// Marking read
// ---------------------------------------------------------------------------

/** Marks a notification as read. */
export async function markNotificationRead(id: string, userId: string): Promise<void> {
  if (isFirebaseConfigured && db && !id.startsWith('notif_')) {
    try {
      const ref = doc(db, 'notifications', id)
      await updateDoc(ref, { read: true })
      return
    } catch (err) {
      console.warn('[Notifications] Firestore update failed:', err)
    }
  }

  const updated = readAllLocal().map((item) =>
    item.id === id && item.user_id === userId ? { ...item, read: true } : item,
  )
  saveLocalNotifications(updated)
}

/** Marks every unread notification in `list` as read. */
export async function markAllNotificationsRead(list: readonly AppNotification[], userId: string): Promise<void> {
  const unread = list.filter((n) => !n.read)
  await Promise.all(unread.map((n) => markNotificationRead(n.id, userId)))
}
