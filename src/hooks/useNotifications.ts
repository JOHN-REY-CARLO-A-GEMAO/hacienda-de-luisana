import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './useAuth'
import {
  markAllNotificationsRead,
  markNotificationRead,
  subscribeUserNotifications,
  type AppNotification,
} from '../lib/notifications'

/**
 * The signed-in Guest's notifications, kept live.
 *
 * Used by the header bell and the account page, so both show the same list and
 * the same unread count. An anonymous Guest (somebody who booked without an
 * account) has no inbox to open, so nothing is subscribed for them.
 */
export function useNotifications() {
  const { user } = useAuth()
  const uid = user && !user.isAnonymous ? user.uid : null
  const [items, setItems] = useState<AppNotification[]>([])

  useEffect(() => {
    if (!uid) {
      setItems([])
      return
    }
    return subscribeUserNotifications(uid, setItems)
  }, [uid])

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const markRead = useCallback(
    async (id: string) => {
      if (!uid) return
      await markNotificationRead(id, uid)
      // The live listener will confirm; this makes the badge drop immediately.
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    },
    [uid],
  )

  const markAllRead = useCallback(async () => {
    if (!uid) return
    await markAllNotificationsRead(items, uid)
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [uid, items])

  return { items, unreadCount, markRead, markAllRead, signedIn: Boolean(uid) }
}
