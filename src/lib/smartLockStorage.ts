// ----------------------------------------------------------------------------
// Smart Lock Storage & Service
// Hacienda de LuisAna — Smart Lock (RFID + Mobile Key / ESP32) Records
// ----------------------------------------------------------------------------
// Records every lock, unlock, auto-relock, and access attempt with exact timestamps,
// door identification, guest/booker reference, and method.
// Syncs in real time via custom events and supports Firestore access_logs when configured.
// ----------------------------------------------------------------------------

import { isFirebaseConfigured, db } from './firebase'
import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore'

export type SmartLockAction = 'unlock' | 'lock' | 'auto_relock' | 'denied' | 'master_override'

export type SmartLockMethod =
  | 'mobile_key'
  | 'rfid_card'
  | 'keypad_pin'
  | 'admin_remote'
  | 'auto_timer'
  | 'master_key'

export interface SmartLockRecord {
  id: string
  timestamp: string // ISO 8601 string: e.g. "2026-09-17T14:32:05.120Z"
  door_id: string // e.g. 'main_entrance', 'villa_front', 'casita_a', 'pool_gate'
  door_name: string // e.g. 'Villa LuisAna Front Door'
  action: SmartLockAction
  method: SmartLockMethod
  uid?: string
  guest_name: string
  booking_id?: string
  ref_id?: string
  rfid_uid?: string
  reason: string
  success: boolean
}

export interface DoorInfo {
  id: string
  name: string
  location: string
  status: 'locked' | 'unlocked'
  battery: number // percentage
  signalRssi: number // dBm
  lastEventAt: string
}

export const DOORS: DoorInfo[] = [
  {
    id: 'villa_front',
    name: 'Villa LuisAna — Front Door',
    location: 'Main Villa Ground Floor',
    status: 'locked',
    battery: 92,
    signalRssi: -58,
    lastEventAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    id: 'main_entrance',
    name: 'Resort Main Gate & Perimeter',
    location: 'Property Main Gate',
    status: 'locked',
    battery: 88,
    signalRssi: -64,
    lastEventAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: 'casita_a',
    name: 'Casita A — Garden Suite',
    location: 'Garden Casitas Wing',
    status: 'locked',
    battery: 95,
    signalRssi: -62,
    lastEventAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: 'pool_gate',
    name: 'Swimming Pool Safety Gate',
    location: 'Poolside Lawn',
    status: 'locked',
    battery: 84,
    signalRssi: -67,
    lastEventAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
]

const STORAGE_KEY = 'hdl:smartlock_records'
const EVENT_NAME = 'hdl:smartlock-updated'

// Generate rich realistic initial seed logs with varied timestamps and booker names
function generateSeedRecords(): SmartLockRecord[] {
  const now = Date.now()
  const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString()
  const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString()

  return [
    {
      id: 'sl-rec-1',
      timestamp: minutesAgo(4),
      door_id: 'villa_front',
      door_name: 'Villa LuisAna — Front Door',
      action: 'auto_relock',
      method: 'auto_timer',
      guest_name: 'Juan Dela Cruz',
      ref_id: 'HDL-7821',
      rfid_uid: 'RFID-E2049A1F',
      reason: 'Auto-relocked securely after 5s safety timeout',
      success: true,
    },
    {
      id: 'sl-rec-2',
      timestamp: minutesAgo(4.1),
      door_id: 'villa_front',
      door_name: 'Villa LuisAna — Front Door',
      action: 'unlock',
      method: 'mobile_key',
      guest_name: 'Juan Dela Cruz',
      ref_id: 'HDL-7821',
      reason: 'Mobile Key verified via BLE challenge-response handshake',
      success: true,
    },
    {
      id: 'sl-rec-3',
      timestamp: minutesAgo(28),
      door_id: 'main_entrance',
      door_name: 'Resort Main Gate & Perimeter',
      action: 'auto_relock',
      method: 'auto_timer',
      guest_name: 'Maria Reyes',
      ref_id: 'HDL-5510',
      reason: 'Auto-relocked after vehicle entry',
      success: true,
    },
    {
      id: 'sl-rec-4',
      timestamp: minutesAgo(28.2),
      door_id: 'main_entrance',
      door_name: 'Resort Main Gate & Perimeter',
      action: 'unlock',
      method: 'rfid_card',
      guest_name: 'Maria Reyes',
      ref_id: 'HDL-5510',
      rfid_uid: 'RFID-A8190B22',
      reason: 'RFID Keycard scanned and authorized',
      success: true,
    },
    {
      id: 'sl-rec-5',
      timestamp: hoursAgo(1.5),
      door_id: 'casita_a',
      door_name: 'Casita A — Garden Suite',
      action: 'denied',
      method: 'mobile_key',
      guest_name: 'Unregistered Device',
      ref_id: 'UNKNOWN',
      reason: 'Access Denied: Invalid key signature / check-in time not reached',
      success: false,
    },
    {
      id: 'sl-rec-6',
      timestamp: hoursAgo(2.1),
      door_id: 'villa_front',
      door_name: 'Villa LuisAna — Front Door',
      action: 'lock',
      method: 'admin_remote',
      guest_name: 'Admin / Caretaker',
      reason: 'Secured via Admin Remote Control',
      success: true,
    },
    {
      id: 'sl-rec-7',
      timestamp: hoursAgo(2.2),
      door_id: 'villa_front',
      door_name: 'Villa LuisAna — Front Door',
      action: 'unlock',
      method: 'master_key',
      guest_name: 'Admin / Caretaker',
      reason: 'Master physical override / Host inspection',
      success: true,
    },
    {
      id: 'sl-rec-8',
      timestamp: hoursAgo(3.8),
      door_id: 'pool_gate',
      door_name: 'Swimming Pool Safety Gate',
      action: 'auto_relock',
      method: 'auto_timer',
      guest_name: 'JP Santos',
      ref_id: 'HDL-3199',
      reason: 'Child-safety auto-relock after 8s',
      success: true,
    },
    {
      id: 'sl-rec-9',
      timestamp: hoursAgo(3.9),
      door_id: 'pool_gate',
      door_name: 'Swimming Pool Safety Gate',
      action: 'unlock',
      method: 'rfid_card',
      guest_name: 'JP Santos',
      ref_id: 'HDL-3199',
      rfid_uid: 'RFID-C4491D88',
      reason: 'RFID guest wristband tap verified',
      success: true,
    },
    {
      id: 'sl-rec-10',
      timestamp: hoursAgo(5.2),
      door_id: 'main_entrance',
      door_name: 'Resort Main Gate & Perimeter',
      action: 'auto_relock',
      method: 'auto_timer',
      guest_name: 'JP Santos',
      ref_id: 'HDL-3199',
      reason: 'Auto-relocked after guest arrival',
      success: true,
    },
    {
      id: 'sl-rec-11',
      timestamp: hoursAgo(5.3),
      door_id: 'main_entrance',
      door_name: 'Resort Main Gate & Perimeter',
      action: 'unlock',
      method: 'mobile_key',
      guest_name: 'JP Santos',
      ref_id: 'HDL-3199',
      reason: 'Guest initial arrival check-in unlock',
      success: true,
    },
  ]
}

function readLocalRecords(): SmartLockRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const initial = generateSeedRecords()
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
      return initial
    }
    return JSON.parse(raw) as SmartLockRecord[]
  } catch {
    return generateSeedRecords()
  }
}

function writeLocalRecords(list: SmartLockRecord[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export const smartLockDB = {
  get isCloud() {
    return isFirebaseConfigured && Boolean(db)
  },

  list(): SmartLockRecord[] {
    return readLocalRecords().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  },

  async add(input: Omit<SmartLockRecord, 'id' | 'timestamp'> & { timestamp?: string }): Promise<SmartLockRecord> {
    const record: SmartLockRecord = {
      ...input,
      id: 'sl-' + crypto.randomUUID().slice(0, 8),
      timestamp: input.timestamp || new Date().toISOString(),
    }

    const current = readLocalRecords()
    current.unshift(record)
    // keep cap to 300 records
    if (current.length > 300) {
      current.length = 300
    }
    writeLocalRecords(current)

    // Also persist to Firestore collection 'access_logs' if configured
    if (this.isCloud && db) {
      try {
        await addDoc(collection(db, 'access_logs'), {
          ...record,
          created_at: serverTimestamp(),
        })
      } catch (err) {
        console.warn('[smartLockDB] Cloud sync failed, stored locally', err)
      }
    }

    return record
  },

  subscribe(callback: (records: SmartLockRecord[]) => void): () => void {
    const notify = () => callback(this.list())
    notify()

    if (typeof window !== 'undefined') {
      window.addEventListener(EVENT_NAME, notify)
    }

    let unsubFirestore: (() => void) | null = null
    if (this.isCloud && db) {
      try {
        const q = query(collection(db, 'access_logs'), orderBy('created_at', 'desc'))
        unsubFirestore = onSnapshot(q, (snapshot) => {
          if (!snapshot.empty) {
            const cloudRecords = snapshot.docs.map((docSnap) => {
              const data = docSnap.data() as DocumentData
              return {
                id: docSnap.id,
                timestamp: data.created_at?.toDate?.()?.toISOString() || data.timestamp || new Date().toISOString(),
                door_id: data.door_id || 'villa_front',
                door_name: data.door_name || 'Villa LuisAna Front Door',
                action: data.action || (data.result === 'granted' ? 'unlock' : 'denied'),
                method: data.method || 'mobile_key',
                guest_name: data.guest_name || 'Guest',
                ref_id: data.ref_id,
                rfid_uid: data.rfid_uid,
                reason: data.reason || '',
                success: data.success !== false && data.result !== 'denied',
              } as SmartLockRecord
            })
            // Merge with local records
            const mergedMap = new Map<string, SmartLockRecord>()
            cloudRecords.forEach((r) => mergedMap.set(r.id, r))
            readLocalRecords().forEach((r) => {
              if (!mergedMap.has(r.id)) mergedMap.set(r.id, r)
            })
            const sorted = Array.from(mergedMap.values()).sort((a, b) =>
              a.timestamp < b.timestamp ? 1 : -1,
            )
            callback(sorted)
          }
        })
      } catch (e) {
        console.warn('[smartLockDB] Firestore listener failed, using local', e)
      }
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(EVENT_NAME, notify)
      }
      unsubFirestore?.()
    }
  },

  // Calculate detailed stats for the admin records view
  getStats(records: SmartLockRecord[]) {
    const unlocks = records.filter((r) => r.action === 'unlock')
    const locks = records.filter((r) => r.action === 'lock' || r.action === 'auto_relock')
    const denied = records.filter((r) => r.action === 'denied' || !r.success)
    const master = records.filter((r) => r.action === 'master_override')

    // Breakdown per door
    const perDoor: Record<string, { name: string; unlocks: number; locks: number; denied: number }> = {}
    DOORS.forEach((d) => {
      perDoor[d.id] = { name: d.name, unlocks: 0, locks: 0, denied: 0 }
    })

    records.forEach((r) => {
      if (!perDoor[r.door_id]) {
        perDoor[r.door_id] = { name: r.door_name, unlocks: 0, locks: 0, denied: 0 }
      }
      if (r.action === 'unlock') perDoor[r.door_id].unlocks += 1
      else if (r.action === 'lock' || r.action === 'auto_relock') perDoor[r.door_id].locks += 1
      else if (r.action === 'denied') perDoor[r.door_id].denied += 1
    })

    // Breakdown per guest/booker
    const perGuest: Record<string, { guest_name: string; unlocks: number; locks: number; ref_id?: string }> = {}
    records.forEach((r) => {
      if (!r.guest_name || r.guest_name === 'Unregistered Device') return
      if (!perGuest[r.guest_name]) {
        perGuest[r.guest_name] = { guest_name: r.guest_name, unlocks: 0, locks: 0, ref_id: r.ref_id }
      }
      if (r.action === 'unlock') perGuest[r.guest_name].unlocks += 1
      if (r.action === 'lock' || r.action === 'auto_relock') perGuest[r.guest_name].locks += 1
    })

    return {
      totalEvents: records.length,
      totalUnlocks: unlocks.length,
      totalLocks: locks.length,
      totalDenied: denied.length,
      totalMaster: master.length,
      perDoor,
      perGuest: Object.values(perGuest),
    }
  },

  // Helper to simulate smart lock action (e.g. testing unlock then auto-relock)
  async simulateUnlock(
    doorId: string,
    guestName: string,
    refId?: string,
    method: SmartLockMethod = 'mobile_key',
  ) {
    const door = DOORS.find((d) => d.id === doorId) || DOORS[0]
    // 1. Record UNLOCK
    const unlockRecord = await this.add({
      door_id: door.id,
      door_name: door.name,
      action: 'unlock',
      method,
      guest_name: guestName,
      ref_id: refId,
      rfid_uid: method === 'rfid_card' ? 'RFID-' + Math.random().toString(36).substring(2, 10).toUpperCase() : undefined,
      reason:
        method === 'mobile_key'
          ? 'Mobile Key authenticated via BLE challenge-response'
          : method === 'rfid_card'
          ? 'RFID Card UID scanned & verified at door reader'
          : 'Remote unlock triggered',
      success: true,
    })

    // 2. Schedule Auto-Relock after 5 seconds
    setTimeout(async () => {
      await smartLockDB.add({
        door_id: door.id,
        door_name: door.name,
        action: 'auto_relock',
        method: 'auto_timer',
        guest_name: guestName,
        ref_id: refId,
        reason: 'Door securely auto-relocked after 5s safety timer',
        success: true,
      })
    }, 5000)

    return unlockRecord
  },

  async simulateDenied(doorId: string, guestName: string = 'Unknown / Guest') {
    const door = DOORS.find((d) => d.id === doorId) || DOORS[0]
    return this.add({
      door_id: door.id,
      door_name: door.name,
      action: 'denied',
      method: 'mobile_key',
      guest_name: guestName,
      reason: 'Access Denied: Key expired or not yet valid for this date/time',
      success: false,
    })
  },

  async simulateMasterOverride(doorId: string) {
    const door = DOORS.find((d) => d.id === doorId) || DOORS[0]
    return this.add({
      door_id: door.id,
      door_name: door.name,
      action: 'master_override',
      method: 'master_key',
      guest_name: 'Property Caretaker / Host',
      reason: 'Physical master key code entered on door keypad',
      success: true,
    })
  },
}
