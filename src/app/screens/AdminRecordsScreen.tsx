import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { smartLockDB, DOORS, type SmartLockRecord } from '../../lib/smartLockStorage'
import { Screen, ScreenTitle } from '../components/Screen'
import { Lock, Unlock, Key, Refresh, Check, Sparkle, ArrowRight } from '../../lib/icons'
import { useAuth } from '../../hooks/useAuth'

export function AdminRecordsScreen() {
  // Which of the two websites this role may open, so nobody is handed a link
  // that would only turn them away.
  const { canOpen } = useAuth()
  const [records, setRecords] = useState<SmartLockRecord[]>([])
  const [activeDoor, setActiveDoor] = useState(DOORS[0].id)
  const [simMessage, setSimMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsub = smartLockDB.subscribe(setRecords)
    return () => unsub()
  }, [])

  const stats = useMemo(() => smartLockDB.getStats(records), [records])

  const handleTestUnlock = async (doorId: string) => {
    setBusy(true)
    try {
      const door = DOORS.find((d) => d.id === doorId) || DOORS[0]
      await smartLockDB.simulateUnlock(door.id, 'Bisita (Live Test Booker)', 'HDL-TEST', 'mobile_key')
      setSimMessage(`🟢 Na-unlock ang ${door.name}! Mag-auto-relock ito sa loob ng 5 segundo.`)
      setTimeout(() => setSimMessage(null), 6000)
    } finally {
      setBusy(false)
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <Screen>
      <ScreenTitle eyebrow="App for Client · Smart Lock" title="Pinto at Smart Lock">
        <p className="mt-1 text-sm text-forest-800/70">
          Smart lock overview para sa Client. Subaybayan ang pagbukas at pagsara ng pinto sa resort.
        </p>
      </ScreenTitle>

      {/* Simulator Notice */}
      {simMessage && (
        <div className="mb-4 rounded-2xl bg-emerald-700 text-cream-50 p-3.5 text-xs font-medium shadow-md flex items-center gap-2 animate-fadeIn">
          <Check size={16} className="text-emerald-200 shrink-0" />
          <span>{simMessage}</span>
        </div>
      )}

      {/* Primary KPI Counters */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <div className="bg-white rounded-2xl p-3 border border-forest-900/5 shadow-sm text-center">
          <div className="text-[10px] uppercase tracking-eyebrow text-emerald-700 font-semibold flex items-center justify-center gap-1">
            <Unlock size={12} /> Unlocks
          </div>
          <div className="font-serif text-2xl text-forest-900 mt-1">{stats.totalUnlocks}</div>
          <div className="text-[10px] text-forest-700/60">Pagkabukas</div>
        </div>

        <div className="bg-white rounded-2xl p-3 border border-forest-900/5 shadow-sm text-center">
          <div className="text-[10px] uppercase tracking-eyebrow text-forest-700 font-semibold flex items-center justify-center gap-1">
            <Lock size={12} /> Locks
          </div>
          <div className="font-serif text-2xl text-forest-900 mt-1">{stats.totalLocks}</div>
          <div className="text-[10px] text-forest-700/60">Pagsara / Relock</div>
        </div>

        <div className="bg-white rounded-2xl p-3 border border-forest-900/5 shadow-sm text-center">
          <div className="text-[10px] uppercase tracking-eyebrow text-red-700 font-semibold flex items-center justify-center gap-1">
            Denied
          </div>
          <div className="font-serif text-2xl text-forest-900 mt-1">{stats.totalDenied}</div>
          <div className="text-[10px] text-forest-700/60">Tanggihan</div>
        </div>
      </div>

      {/* Door Status Cards */}
      <div className="bg-white rounded-3xl border border-forest-900/5 shadow-card p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-serif text-lg text-forest-900">Mga Pinto sa Hacienda</h3>
          <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            4 Smart Locks Online
          </span>
        </div>

        <div className="space-y-3">
          {DOORS.map((door) => {
            const doorStats = stats.perDoor[door.id] || { unlocks: 0, locks: 0 }
            return (
              <div key={door.id} className="p-3.5 rounded-2xl bg-cream-50/70 border border-forest-900/5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-xs text-forest-900">{door.name}</div>
                  <div className="text-[10px] text-forest-700/70">{door.location}</div>
                  <div className="mt-1 text-[11px] text-forest-800">
                    <span className="text-emerald-700 font-medium">{doorStats.unlocks} unlocks</span> ·{' '}
                    <span className="text-forest-700 font-medium">{doorStats.locks} locks</span>
                  </div>
                </div>

                <button
                  disabled={busy}
                  onClick={() => handleTestUnlock(door.id)}
                  className="px-3 py-1.5 rounded-xl text-xs bg-forest-800 text-cream-50 hover:bg-forest-900 disabled:opacity-50 transition font-medium"
                >
                  Test Unlock
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Link to Full Admin Website — hidden for anyone who cannot open it */}
      {canOpen('/admin') ? (
        <div className="rounded-3xl bg-forest-900 text-cream-50 p-5 shadow-card">
          <div className="eyebrow text-cream-100/60">Website for Admin</div>
          <h4 className="font-serif text-xl text-cream-50 mt-1">Buong Smart Lock Records & Oras</h4>
          <p className="mt-1 text-xs text-cream-100/75 leading-relaxed">
            Para sa buong audit trail, detalyadong timestamp kung anong oras at ilang lock/unlock ang nagawa, pumunta sa Website for Admin:
          </p>
          <Link
            to="/admin"
            className="mt-4 px-4 py-2.5 rounded-xl bg-cream-50 text-forest-900 font-semibold text-xs inline-flex items-center gap-1.5 hover:bg-white transition"
          >
            Buksan ang Website for Admin <ArrowRight size={14} />
          </Link>
        </div>
      ) : null}

      {/* Recent Access Logs List */}
      <div className="mt-6">
        <div className="eyebrow text-forest-600 mb-2">Kamakailang Talaan (Recent Logs)</div>
        <div className="space-y-2">
          {records.slice(0, 6).map((rec) => {
            const isUnlock = rec.action === 'unlock'
            const isLock = rec.action === 'lock' || rec.action === 'auto_relock'

            return (
              <div key={rec.id} className="p-3 rounded-2xl bg-white border border-forest-900/5 text-xs flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isUnlock
                          ? 'bg-emerald-100 text-emerald-800'
                          : isLock
                          ? 'bg-forest-100 text-forest-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {rec.action.toUpperCase()}
                    </span>
                    <span className="font-medium text-forest-900">{rec.door_name}</span>
                  </div>
                  <div className="text-[11px] text-forest-700/70 mt-0.5">
                    {rec.guest_name} · {rec.reason}
                  </div>
                </div>
                <div className="text-right text-[11px] text-forest-700/60 font-mono">
                  {formatTime(rec.timestamp)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Screen>
  )
}
