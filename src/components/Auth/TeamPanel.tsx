import { useCallback, useEffect, useState } from 'react'
import { ROLE_LABELS, ROLES, describeAuthError, type Profile, type Role } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'

/**
 * The Host's team panel: who has which of the three roles.
 *
 * There is no way to make an account here — Firebase Auth will not let one
 * signed-in person create another — so the flow is the honest one: somebody signs
 * up as a Guest, and the Host makes them Staff from this list. What the panel
 * writes is the same `profiles/{uid}` document `firestore.rules` reads, and only
 * a Host may write it, so a refusal here is a refusal that would have happened
 * anyway with the panel deleted (ADR-0005).
 */
export function TeamPanel() {
  const { team, assignRole, user, can } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Record<string, Role>>({})
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const listed = await team()
      setProfiles(listed)
      setChosen(Object.fromEntries(listed.map((profile) => [profile.uid, profile.role])))
    } catch (error) {
      setNotice({ tone: 'bad', text: describeAuthError(error).message })
    } finally {
      setLoading(false)
    }
  }, [team])

  useEffect(() => {
    void load()
  }, [load])

  if (!can('team:manage')) {
    return (
      <div className="rounded-3xl bg-white border border-forest-900/5 shadow-card p-6 text-sm text-forest-800">
        Only the Host decides who has which role.
      </div>
    )
  }

  const save = async (profile: Profile) => {
    const role = chosen[profile.uid] ?? profile.role
    if (role === profile.role) return
    setPending(profile.uid)
    setNotice(null)
    try {
      const saved = await assignRole(
        { uid: profile.uid, email: profile.email, displayName: profile.display_name },
        role,
      )
      setProfiles((current) => current.map((entry) => (entry.uid === saved.uid ? saved : entry)))
      setNotice({
        tone: 'good',
        text: `${profile.display_name || profile.email || profile.uid} is now ${ROLE_LABELS[saved.role]}. It takes effect on their next page load.`,
      })
    } catch (error) {
      setNotice({ tone: 'bad', text: describeAuthError(error).message })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-white border border-forest-900/5 shadow-card p-6">
        <div className="eyebrow">Host only · Roles</div>
        <h3 className="font-serif text-2xl text-forest-900 mt-2">Sino ang may alagang papel</h3>
        <p className="mt-2 text-sm text-forest-700/80 leading-relaxed max-w-3xl">
          Everybody who signs up arrives as a <strong>Guest</strong>. Make somebody <strong>Staff</strong> here and they
          can read the Bookings and the Access log and mark a cleaned stay Complete — never approve a Booking, verify a
          payment or open a government ID. Only a <strong>Host</strong> may change this list, and the change is written
          to Firestore, where the rules read it back.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => void load()} className="btn-ghost text-xs">
            Refresh
          </button>
          {notice && (
            <span
              className={`text-xs rounded-xl px-3 py-2 border ${
                notice.tone === 'good'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  : 'bg-red-50 text-red-800 border-red-200'
              }`}
            >
              {notice.text}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-3xl bg-white border border-forest-900/5 shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-50 text-[11px] uppercase tracking-eyebrow text-forest-600">
            <tr>
              <th className="px-5 py-3 text-left font-semibold">Account</th>
              <th className="px-5 py-3 text-left font-semibold">Role now</th>
              <th className="px-5 py-3 text-left font-semibold">Change to</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-forest-600 text-xs">
                  Reading the team…
                </td>
              </tr>
            )}
            {!loading && profiles.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-forest-600 text-xs">
                  Nobody has a Profile yet. Accounts appear here once somebody signs up — or once you step into a role
                  in demo mode.
                </td>
              </tr>
            )}
            {profiles.map((profile) => {
              const isSelf = profile.uid === user?.uid
              const next = chosen[profile.uid] ?? profile.role
              return (
                <tr key={profile.uid} className="border-t border-forest-900/5">
                  <td className="px-5 py-4">
                    <div className="font-medium text-forest-900">{profile.display_name || 'No name given'}</div>
                    <div className="text-xs text-forest-700/70">{profile.email || '—'}</div>
                    <div className="text-[10px] font-mono text-forest-500/70">{profile.uid}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-forest-100 text-forest-800">
                      {ROLE_LABELS[profile.role]}
                    </span>
                    {isSelf && <span className="ml-2 text-[11px] text-forest-600">that's you</span>}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <select
                        className="field !py-1.5 !text-xs"
                        value={next}
                        disabled={isSelf || pending === profile.uid}
                        onChange={(event) =>
                          setChosen((current) => ({ ...current, [profile.uid]: event.target.value as Role }))
                        }
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => void save(profile)}
                        disabled={isSelf || next === profile.role || pending === profile.uid}
                        className="btn-primary !py-1.5 text-xs disabled:opacity-50"
                      >
                        {pending === profile.uid ? 'Saving…' : 'Save'}
                      </button>
                      {isSelf && (
                        <span className="text-[11px] text-forest-600">
                          You cannot change your own role — ask another Host.
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
