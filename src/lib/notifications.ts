// ----------------------------------------------------------------------------
// Guest and Admin Notifications Service (Firestore)
// Hacienda de LuisAna
// ----------------------------------------------------------------------------

import { addDoc, collection, doc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'

export type NotificationType =
  | 'booking_submitted'
  | 'booking_approved'
  | 'booking_rejected'
  | 'payment_verified'
  | 'payment_rejected'
  | 'cancellation_result'
  | 'reschedule_result'
  | 'general'

export type AppNotification = {
  id: string
  user_id: string
  booking_id?: string
  title: string
  message: string
  type: NotificationType
  created_at: string
  read: boolean
}

const LOCAL_NOTIFS_KEY = 'hdl_guest_notifications'

function getLocalNotifications(userId: string): AppNotification[] {
  try {
    const raw = localStorage.getItem(LOCAL_NOTIFS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AppNotification[]
    return parsed.filter((n) => n.user_id === userId)
  } catch {
    return []
  }
}

function saveLocalNotifications(notifications: AppNotification[]): void {
  try {
    localStorage.setItem(LOCAL_NOTIFS_KEY, JSON.stringify(notifications))
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Creates a notification in Firestore (or localStorage in demo mode).
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
  const existing = getLocalNotifications(params.userId)
  const notif: AppNotification = {
    ...item,
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  }
  saveLocalNotifications([notif, ...existing])
}

/**
 * Fetches notifications for a given user.
 */
export async function fetchUserNotifications(userId: string): Promise<AppNotification[]> {
  if (!userId) return []

  if (isFirebaseConfigured && db) {
    try {
      const q = query(
        collection(db, 'notifications'),
        where('user_id', '==', userId),
        orderBy('created_at', 'desc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AppNotification, 'id'>),
      }))
    } catch (err) {
      console.warn('[Notifications] Firestore fetch failed, trying local fallback:', err)
    }
  }

  return getLocalNotifications(userId)
}

/**
 * Marks a notification as read.
 */
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

  const items = getLocalNotifications(userId)
  const updated = items.map((item) => (item.id === id ? { ...item, read: true } : item))
  saveLocalNotifications(updated)
}
