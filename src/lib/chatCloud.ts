import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { validateMessage } from './validation'
import { isActiveCategory } from './categories'

export type ChatMessage = {
  id: string
  text: string
  at: string
  mine: boolean
  sender_uid: string
}

const LOCAL_KEY = 'hdl:chat'

function localLoad(): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as ChatMessage[]
  } catch {
    return []
  }
}

export async function ensureConversation(uid: string, category: string): Promise<string> {
  if (!isActiveCategory(category, 'inquiry')) {
    throw new Error('Choose a valid inquiry category.')
  }
  if (!isFirebaseConfigured || !db) return `local:${uid}`

  const q = query(collection(db, 'conversations'), where('guest_uid', '==', uid), limit(1))
  const snap = await getDocs(q)
  if (snap.docs[0]) return snap.docs[0].id
  const ref = doc(collection(db, 'conversations'))
  await setDoc(ref, {
    guest_uid: uid,
    category,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    last_message: '',
    unread_admin: 0,
    unread_guest: 0,
  })
  return ref.id
}

export function subscribeMessages(
  convoId: string,
  uid: string,
  onPage: (msgs: ChatMessage[]) => void,
): () => void {
  if (!isFirebaseConfigured || !db || convoId.startsWith('local:')) {
    onPage(localLoad())
    return () => {}
  }
  const q = query(
    collection(db, 'conversations', convoId, 'messages'),
    orderBy('created_at', 'desc'),
    limit(30),
  )
  return onSnapshot(q, (snap) => {
    const items = snap.docs
      .map((d) => {
        const data = d.data()
        return {
          id: d.id,
          text: String(data.text ?? ''),
          at: data.created_at?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
          sender_uid: String(data.sender_uid ?? ''),
          mine: data.sender_uid === uid,
        }
      })
      .reverse()
    onPage(items)
  })
}

export async function sendChatMessage(input: {
  convoId: string
  uid: string
  text: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const v = validateMessage(input.text)
  if (!v.ok) return { ok: false, message: v.message }

  if (!isFirebaseConfigured || !db || input.convoId.startsWith('local:')) {
    const next = [
      ...localLoad(),
      { id: crypto.randomUUID(), text: v.value, at: new Date().toISOString(), mine: true, sender_uid: input.uid },
    ]
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
    return { ok: true }
  }

  await addDoc(collection(db, 'conversations', input.convoId, 'messages'), {
    sender_uid: input.uid,
    sender_role: 'guest',
    text: v.value,
    created_at: serverTimestamp(),
  })
  await updateDoc(doc(db, 'conversations', input.convoId), {
    updated_at: serverTimestamp(),
    last_message: v.value.slice(0, 140),
    unread_admin: 1,
  })
  return { ok: true }
}
