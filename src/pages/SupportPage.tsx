import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmailAuthProvider, linkWithCredential, linkWithPopup } from 'firebase/auth'
import { useAuth } from '../hooks/useAuth'
import { auth, googleProvider } from '../lib/firebase'
import { DisputeForm } from '../components/DisputeForm'
import { EMAIL_MAX } from '../lib/validation'
import { caseInbox, readCaseNotification, caseDate, type CaseNotification } from '../lib/disputes'

export function SupportPage() {
  const { user, role, refresh } = useAuth()
  const [inbox, setInbox] = useState<CaseNotification[]>([])
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!user || user.isAnonymous || role !== 'guest') return
    let alive = true
    const load = () => void caseInbox().then(rows => { if (alive) setInbox(rows) }).catch(e => { if (alive) setError(e.message) })
    load(); const timer = window.setInterval(load, 60000)
    return () => { alive = false; clearInterval(timer) }
  }, [user?.uid, user?.isAnonymous, role])
  async function link(google: boolean) {
    setBusy(true); setError('')
    try {
      if (!auth?.currentUser?.isAnonymous) throw new Error('The original anonymous booking session must still be present.')
      if (google && googleProvider) await linkWithPopup(auth.currentUser, googleProvider)
      else await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password))
      await auth.currentUser?.getIdToken(true); await refresh(); setPassword('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Linking failed. Contact official support; never infer ownership from email alone.') }
    finally { setBusy(false) }
  }
  return <div className="pt-32 pb-24 px-5 max-w-4xl mx-auto text-forest-900"><h1 className="display text-4xl">Support &amp; Disputes</h1>
    <p className="my-4">Report a booking concern from <Link className="underline" to="/account">My Bookings</Link>, or submit a general concern here. For urgent assistance, use <Link className="underline" to="/contact">official contact channels</Link>. This is not an emergency-response channel.</p>
    {error && <div role="alert" className="my-3 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800">{error}</div>}
    {!user ? <p><Link className="btn-primary" to="/guest/auth">Sign in to report or track a case</Link></p> : role === 'admin' ? <p>Manage cases in the Admin mobile app.</p> : user.isAnonymous ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); void link(false) }}><h2 className="font-semibold">Secure this booking identity</h2><p>Link the identity already attached to your booking. This keeps the same UID. If your email is already used by another account, stop and request verified recovery through official support; do not sign out expecting the booking to transfer.</p><label className="block">Email<input className="field block" type="email" required maxLength={EMAIL_MAX} value={email} onChange={e => { setEmail(e.target.value); if (error) setError('') }} autoComplete="email" /></label><label className="block">New account password<input className="field block" type="password" required minLength={12} maxLength={200} value={password} onChange={e => { setPassword(e.target.value); if (error) setError('') }} autoComplete="new-password" /></label><button disabled={busy || !email.trim() || password.length < 12 || Boolean(error)} className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed">{busy ? 'Linking…' : 'Link with email'}</button><button type="button" disabled={busy} className="btn-secondary disabled:opacity-60 disabled:cursor-not-allowed" onClick={() => void link(true)}>Link with Google</button></form> : <>
      <section className="border rounded-xl p-4 my-4" aria-label="Case notifications"><h2 className="font-serif text-xl">Case notifications</h2><p className="text-xs my-2">In-app delivery only. Opening a notification does not accept a resolution.</p>{!inbox.length && <p>No notifications yet.</p>}{inbox.filter(n => n.user_id === user.uid).map(n => <div className="border-b py-2" key={n.id}><strong>{n.title}</strong><p>{n.message}</p><p className="text-xs">{caseDate(n.created_at)}</p><button type="button" className="underline text-xs" disabled={n.read} onClick={() => void readCaseNotification(n.id).then(() => setInbox(rows => rows.map(row => row.id === n.id ? { ...row, read: true } : row))).catch(e => setError(e.message))}>{n.read ? 'Read' : 'Mark read'}</button></div>)}{inbox.length >= 50 && <button type="button" className="underline" onClick={() => void caseInbox(inbox.at(-1)?.id).then(rows => setInbox(prev => [...new Map([...prev, ...rows].map(n => [n.id, n])).values()])).catch(e => setError(e.message))}>Load older notifications</button>}</section>
      <DisputeForm key={user.uid} guestId={user.uid} />
    </>}
  </div>
}
