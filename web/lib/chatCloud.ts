// ----------------------------------------------------------------------------
// Conversations — the Guest ↔ Admin chat, page by page.
//
// One Guest owns one conversation, and only that Guest or the Admin can reach
// it (`firestore.rules`, `isConversationMember`). This module is how the website
// gets at it without ever holding the whole thread.
//
// Three decisions live here, and all three are about cost:
//
//   1. **A page, not a conversation.** The first read is the newest
//      `CHAT_PAGE_SIZE` messages. Older ones are fetched one page at a time
//      behind a cursor, and only when the Guest asks for them. A five-hundred
//      message thread is never downloaded to show its last forty.
//
//   2. **One listener, and it is bounded.** The realtime listener watches the
//      newest page only — it is what makes a reply appear without a refresh —
//      and it is created once per conversation and torn down with the page.
//      Older pages are plain one-shot reads: a page that was read is finished
//      with, so it has no reason to keep a listener alive.
//
//   3. **A limit the rules enforce too.** `MESSAGE_MAX` is 1,000 characters and
//      `firestore.rules` refuses anything longer, so the cap is not this
//      module's opinion. See `src/lib/validation.ts`.
//
// With no Firebase project configured the same three decisions run against this
// browser's `hdl:chat`, so pagination is exercised by `npm test` and not only
// in a deployment.
// ----------------------------------------------------------------------------

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
  startAfter,
  Timestamp,
  updateDoc,
  getDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { validateMessage } from './validation'
import { isActiveCategory } from './categories'
import { dateToISOString, parseDate } from './formatDate'

export type ChatMessage = {
  id: string
  text: string
  /** ISO-8601, so a page and a listener hand the UI the same shape. */
  at: string
  mine: boolean
  sender_uid: string
}

/**
 * Where the oldest message of a loaded page sits, so the next (older) page can
 * start after it. ISO rather than a `Timestamp`: the demo adapter and the cloud
 * adapter hand the same cursor shape to the same caller.
 */
export type MessageCursor = { at: string; id: string }

export type MessagePage = {
  /** Oldest first, the way a chat reads. */
  messages: ChatMessage[]
  /** The cursor for the page *before* this one; null when there is none. */
  cursor: MessageCursor | null
  /** True when the Guest may ask for another, older page. */
  hasMore: boolean
}

/** How many messages the thread opens with, and the most a page may carry. */
export const CHAT_PAGE_SIZE = 40
export const CHAT_MAX_PAGE_SIZE = 50

/**
 * The document id a Guest's conversation for a category has to have.
 *
 * Derived rather than random, because `ensureConversation` used to *find* the
 * thread with `query(conversations, where('guest_uid', '==', uid))` and the rules
 * refuse that query. `allow read: if isAdmin() || isConversationMember(convoId)`
 * reads the conversation **by id**, and Firestore cannot prove that a field
 * filter satisfies it — so the query came back "Missing or insufficient
 * permissions" and the page said "Could not open the conversation." (Verified
 * against production: the query is denied, a `getDoc` on the same document is
 * allowed.)
 *
 * The contrast is the point. `bookings` *can* be listed with `where('uid','==',uid)`
 * because `isOwnDoc()` tests that very field, so Firestore proves the filter
 * satisfies the rule. Nothing here does, because membership is a lookup of
 * another document rather than a field on this one.
 *
 * Loosening `allow list` would make the query legal and is not an option: it would
 * let any signed-in Guest list every conversation in the database, which is the
 * one thing this collection exists to prevent. Deriving the id instead is one
 * document read instead of a collection scan, and it is provable.
 *
 * One Guest gets one thread per inquiry category, which is what a topic picker
 * means anyway. Threads created under the old random ids are not reachable this
 * way any more — they remain readable by id, so nothing is lost, but they will
 * not appear in the picker.
 */
export function conversationDocId(uid: string, category: string): string {
  return `inquiry-${uid}-${category}`
}

/** The preview the Admin's inbox shows — never the whole message. */
export const CHAT_PREVIEW_CHARS = 140

const LOCAL_KEY = 'hdl:chat'

/** The `conversations` collection, typed through the demo-mode null check. */
function conversations() {
  return collection(db as never, 'conversations')
}

function messagesOf(convoId: string) {
  return collection(db as never, 'conversations', convoId, 'messages')
}

function toMessage(snap: QueryDocumentSnapshot<DocumentData>, uid: string): ChatMessage {
  const data = snap.data()
  const at = dateToISOString(data.created_at, new Date().toISOString())
  return {
    id: snap.id,
    text: String(data.text ?? ''),
    at,
    sender_uid: String(data.sender_uid ?? ''),
    mine: data.sender_uid === uid,
  }
}

// ---------------------------------------------------------------------------
// Demo mode — this browser, so every decision above is still exercised offline
// ---------------------------------------------------------------------------

function localLoad(): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as ChatMessage[]
  } catch {
    return []
  }
}

function localStore(next: ChatMessage[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
}

function localPage(uid: string, before: MessageCursor | null, pageSize: number): MessagePage {
  // Newest first internally, oldest first on the way out — the same shape the
  // cloud path returns, so the page above this module does not branch.
  const all = localLoad().slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const older = before ? all.filter((m) => m.at < before.at) : all
  const slice = older.slice(0, pageSize)
  const oldest = slice.length ? slice[slice.length - 1] : null
  return {
    messages: slice
      .map((m) => ({ ...m, mine: m.sender_uid === uid }))
      .reverse(),
    cursor: oldest ? { at: oldest.at, id: oldest.id } : null,
    hasMore: older.length > slice.length,
  }
}

const isLocal = (convoId: string) => convoId.startsWith('local:')
const offline = (): boolean => !isFirebaseConfigured || !db

// ---------------------------------------------------------------------------
// Opening a conversation
// ---------------------------------------------------------------------------

export type Conversation = {
  id: string
  /** Firestore TTL stamp: when this thread is scheduled to be swept. Null = kept. */
  retentionExpiresAt: Date | null
}

/**
 * Find (or open) the signed-in Guest's conversation for a topic, and hand back
 * what the page needs to say about it.
 *
 * The retention stamp comes back with the conversation because this already
 * reads it — returning it costs nothing, and a second `getDoc` for one field on
 * every open is a read the Guest should not pay for.
 */
export async function ensureConversation(uid: string, category: string): Promise<Conversation> {
  if (!isActiveCategory(category, 'inquiry')) {
    throw new Error('Choose a valid inquiry category.')
  }
  if (offline()) return { id: `local:${uid}`, retentionExpiresAt: null }

  const id = conversationDocId(uid, category)
  const ref = doc(conversations(), id)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    // The derived id is this Guest's alone, so a document there carrying another
    // uid is not theirs to open — and the rules would refuse the read anyway.
    if (snap.data().guest_uid !== uid) {
      throw new Error('That conversation belongs to somebody else.')
    }
    const expires = parseDate(snap.data().messages_expires_at)
    return { id, retentionExpiresAt: expires }
  }
  await setDoc(ref, {
    guest_uid: uid,
    category,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    last_message: '',
    unread_admin: 0,
    unread_guest: 0,
  })
  return { id, retentionExpiresAt: null }
}

// ---------------------------------------------------------------------------
// Reading — one page at a time
// ---------------------------------------------------------------------------

/**
 * One page of the thread, oldest first.
 *
 * `before` is the cursor of the oldest message already loaded; null asks for the
 * newest page. The query asks for one message more than the page holds: if it
 * comes back, there *is* an older page, and the Guest is told so.
 */
export async function loadMessagePage(input: {
  convoId: string
  uid: string
  before?: MessageCursor | null
  pageSize?: number
}): Promise<MessagePage> {
  const pageSize = Math.min(CHAT_MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? CHAT_PAGE_SIZE)))
  if (offline() || isLocal(input.convoId)) return localPage(input.uid, input.before ?? null, pageSize)

  const constraints = [
    orderBy('created_at', 'desc'),
    limit(pageSize + 1),
    ...(input.before ? [startAfter(Timestamp.fromMillis(Date.parse(input.before.at)))] : []),
  ]
  const snap = await getDocs(query(messagesOf(input.convoId), ...constraints))
  const docs = snap.docs.slice(0, pageSize)
  const oldest = docs.length ? docs[docs.length - 1] : null
  return {
    messages: docs.map((d) => toMessage(d, input.uid)).reverse(),
    cursor: oldest ? { at: toMessage(oldest, input.uid).at, id: oldest.id } : null,
    hasMore: snap.docs.length > pageSize,
  }
}

/**
 * The newest page, live.
 *
 * This is the only listener the chat opens. It is bounded to the newest page —
 * it is what makes a reply appear — and it stops when the page unmounts. It
 * answers with a `MessagePage` rather than a bare array so the caller learns
 * whether an older page exists from the same delivery, without a second read.
 *
 * The query asks for one message more than the page holds, exactly as the
 * one-shot read does: an extra document in a listener costs no extra read.
 */
export function subscribeMessages(
  convoId: string,
  uid: string,
  onPage: (page: MessagePage) => void,
  pageSize: number = CHAT_PAGE_SIZE,
  onError?: (error: unknown) => void,
): () => void {
  const size = Math.min(CHAT_MAX_PAGE_SIZE, pageSize)
  if (offline() || isLocal(convoId)) {
    onPage(localPage(uid, null, size))
    return () => {}
  }
  const q = query(messagesOf(convoId), orderBy('created_at', 'desc'), limit(size + 1))
  return onSnapshot(
    q,
    (snap) => {
      const docs = snap.docs.slice(0, size)
      const messages = docs.map((d) => toMessage(d, uid)).reverse()
      const oldest = docs.length ? docs[docs.length - 1] : null
      onPage({
        messages,
        cursor: oldest ? { at: toMessage(oldest, uid).at, id: oldest.id } : null,
        hasMore: snap.docs.length > size,
      })
    },
    (error) => {
      console.error('[Chat] messages listener failed', error)
      onError?.(error)
    },
  )
}

/**
 * Fold a freshly-read page into what is already on screen.
 *
 * Pages overlap at their boundary and the listener re-delivers the newest page
 * whenever a message lands, so merging by id — keeping the order the newest
 * known timestamp implies — is what stops a message appearing twice.
 */
export function mergeMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  for (const m of [...existing, ...incoming]) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)))
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function sendChatMessage(input: {
  convoId: string
  uid: string
  text: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const v = validateMessage(input.text)
  if (!v.ok) return { ok: false, message: v.message }

  if (offline() || isLocal(input.convoId)) {
    const next = [
      ...localLoad(),
      { id: crypto.randomUUID(), text: v.value, at: new Date().toISOString(), mine: true, sender_uid: input.uid },
    ]
    localStore(next)
    return { ok: true }
  }

  await addDoc(messagesOf(input.convoId), {
    sender_uid: input.uid,
    sender_role: 'guest',
    text: v.value,
    created_at: serverTimestamp(),
  })
  await updateDoc(doc(db as never, 'conversations', input.convoId), {
    updated_at: serverTimestamp(),
    last_message: v.value.slice(0, CHAT_PREVIEW_CHARS),
    unread_admin: 1,
  })
  return { ok: true }
}
