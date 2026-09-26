import { useEffect, useMemo, useState } from 'react'
import { activeCategories } from '../lib/categories'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { paginate } from '../lib/pagination'
import { Pager } from '../components/Pager'
import { useAuth } from '../hooks/useAuth'
import { ensureConversation, sendChatMessage, subscribeMessages, type ChatMessage } from '../lib/chatCloud'
import { isFirebaseConfigured } from '../lib/firebase'

export function MessagesPage() {
  const { user } = useAuth()
  const [category, setCategory] = useState('booking')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [page, setPage] = useState(1)
  const [convoId, setConvoId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const inquiries = useMemo(() => activeCategories('inquiry'), [])

  useEffect(() => {
    if (!user?.uid) {
      setStatus('ready')
      return
    }
    let unsub = () => {}
    ensureConversation(user.uid, category)
      .then((id) => {
        setConvoId(id)
        setStatus('ready')
        unsub = subscribeMessages(id, user.uid, (list) => setMessages(list))
      })
      .catch(() => setStatus('error'))
    return () => unsub()
  }, [user?.uid, category])

  const paged = paginate([...messages].reverse(), { page, pageSize: 10 })

  const send = async () => {
    if (!user?.uid || !convoId) {
      setError('Sign in to message the Admin.')
      return
    }
    const rl = checkRateLimit(`chat:${user.uid}`, LIMITS.chat)
    if (!rl.ok) {
      setError(rl.message)
      return
    }
    const result = await sendChatMessage({ convoId, uid: user.uid, text })
    if (!result.ok) {
      setError(result.message)
      return
    }
    setText('')
    setError(null)
    if (!isFirebaseConfigured) {
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), text: text.trim(), at: new Date().toISOString(), mine: true, sender_uid: user.uid },
      ])
    }
  }

  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-xl px-5">
        <div className="eyebrow">Messages</div>
        <h1 className="display text-4xl mt-2 text-forest-900">Chat with the Admin</h1>
        <p className="mt-3 text-sm text-forest-800/80">
          Only your conversation is visible. {isFirebaseConfigured ? 'Messages sync to the Admin app.' : 'Demo mode: messages stay in this browser until Firebase is configured.'}
        </p>
        <label className="block mt-6">
          <span className="label">Topic</span>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
            {inquiries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 bg-white rounded-[24px] border border-forest-900/5 p-4 min-h-[240px]">
          {status === 'loading' && <p className="text-sm text-forest-700/70">Loading conversation…</p>}
          {status === 'error' && <p className="text-sm text-red-700">Could not open the conversation.</p>}
          {status === 'ready' && paged.items.length === 0 ? (
            <p className="text-sm text-forest-700/70">No messages yet. Send a question below.</p>
          ) : (
            <ul className="space-y-3">
              {paged.items.map((m) => (
                <li key={m.id} className={`text-sm ${m.mine ? 'text-right' : ''}`}>
                  <span className="inline-block rounded-2xl px-3 py-2 bg-cream-100 text-forest-900 max-w-[85%] text-left">
                    {m.text}
                  </span>
                  <div className="text-[10px] text-forest-600 mt-1">{new Date(m.at).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          )}
          <Pager page={paged} onPage={setPage} />
        </div>
        <div className="mt-4 flex gap-2" data-tour="message-composer">
          <input
            className="field flex-1"
            value={text}
            maxLength={2000}
            data-tour-field="message"
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a message"
          />
          <button type="button" className="btn-primary text-xs" onClick={() => void send()}>
            Send
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  )
}
