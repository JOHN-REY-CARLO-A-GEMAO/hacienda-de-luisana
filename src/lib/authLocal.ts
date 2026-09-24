// ----------------------------------------------------------------------------
// The local demo adapter — accounts, passwords and Profiles in this browser
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The adapter that stands in for Firebase Auth and the Firestore `profiles`
// collection when the project has no Firebase keys, so the website is still
// something a person can click through: sign up as a Guest, sign in, sign out,
// and come back after a reload with the same account.
//
// It satisfies the same two ports the Firebase adapter does, which is why the
// session above it needs no idea which one it is holding. It is *not* a second
// authentication system: one session, one catalogue of permissions, two adapters.
//
// Passwords are stretched with PBKDF2-SHA256 (210,000 rounds, a 16-byte salt per
// account) through WebCrypto and only the derived key is written down — never the
// password. That is honest cryptography in a place that cannot keep a secret: the
// store is this browser's localStorage, where anybody with the machine can read
// the Bookings anyway. Real deployments use Firebase, where the password never
// reaches the client's disk at all.
// ----------------------------------------------------------------------------

import {
  AuthError,
  DEFAULT_ROLE,
  normalizeProfile,
  type AuthPort,
  type Profile,
  type ProfilePort,
  type SessionUser,
} from './auth'

/** Where demo accounts, the current session and the Profiles live. */
export const LOCAL_ACCOUNTS_KEY = 'hdl:auth:accounts'
export const LOCAL_SESSION_KEY = 'hdl:auth:session'
export const LOCAL_PROFILES_KEY = 'hdl:auth:profiles'

/** OWASP's floor for PBKDF2-HMAC-SHA256; slow enough to resist a guess, fast enough to type. */
const ITERATIONS = 210_000
const SALT_BYTES = 16
const HASH_BYTES = 32

type StoredPassword = {
  algorithm: 'pbkdf2-sha256'
  iterations: number
  /** Base64. */
  salt: string
  /** Base64 of the derived key. */
  hash: string
}

type StoredAccount = {
  uid: string
  email: string
  display_name: string | null
  password: StoredPassword
  created_at: string
}

// ----------------------------------------------------------------------------
// Small utilities
// ----------------------------------------------------------------------------

function randomId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  if (random) return random
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    // Private browsing, a full quota, a document written by hand: the browser is
    // telling us there is no store, not that the person did something wrong.
    return fallback
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Nothing to do: demo mode without storage simply forgets on reload.
  }
}

function clearStore(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* as above */
  }
}

/** Compare two derived keys without letting the answer depend on where they differ. */
function sameSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new AuthError(
      'hdl/unavailable',
      'This browser cannot hash a password securely. Open the site over HTTPS, or configure Firebase.',
    )
  }
  const material = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    material,
    HASH_BYTES * 8,
  )
  return toBase64(new Uint8Array(bits))
}

async function hashPassword(password: string): Promise<StoredPassword> {
  const salt = randomBytes(SALT_BYTES)
  return {
    algorithm: 'pbkdf2-sha256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    hash: await deriveKey(password, salt, ITERATIONS),
  }
}

async function passwordMatches(password: string, stored: StoredPassword): Promise<boolean> {
  if (stored.algorithm !== 'pbkdf2-sha256') return false
  try {
    const salt = Uint8Array.from(atob(stored.salt), (character) => character.charCodeAt(0))
    const derived = await deriveKey(password, salt, stored.iterations)
    return sameSecret(derived, stored.hash)
  } catch {
    // A record that cannot be re-derived is a record that does not sign anybody in.
    return false
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

/**
 * The record a login is checked against when there is no account to check.
 * Deriving a key for nobody costs exactly what deriving one for somebody costs.
 */
const NOBODY_SECRET: StoredPassword = {
  algorithm: 'pbkdf2-sha256',
  iterations: ITERATIONS,
  salt: toBase64(new Uint8Array(SALT_BYTES)),
  hash: toBase64(new Uint8Array(HASH_BYTES)),
}


function toSessionUser(account: StoredAccount): SessionUser {
  return {
    uid: account.uid,
    email: account.email,
    displayName: account.display_name,
    isAnonymous: false,
    provider: 'local',
  }
}

// ----------------------------------------------------------------------------
// The two ports, over one store
// ----------------------------------------------------------------------------

/**
 * Demo-mode accounts and Profiles.
 *
 * One factory for both ports because they share the storage a reload reads back.
 * Every account this adapter makes is a Guest: the website is the Guest's
 * application, and demo mode has no Admin to be (ADR-0007).
 */
export function createLocalPorts(): { auth: AuthPort; profiles: ProfilePort } {
  const listeners = new Set<(user: SessionUser | null) => void>()

  const accounts = () => readStore<StoredAccount[]>(LOCAL_ACCOUNTS_KEY, [])
  const saveAccounts = (next: StoredAccount[]) => writeStore(LOCAL_ACCOUNTS_KEY, next)
  const findAccount = (email: string) => accounts().find((account) => account.email === normalizeEmail(email))
  const storedProfiles = () => readStore<Profile[]>(LOCAL_PROFILES_KEY, [])
  const saveProfiles = (next: Profile[]) => writeStore(LOCAL_PROFILES_KEY, next)

  function emit() {
    for (const listener of [...listeners]) listener(current)
  }

  function signIn(account: StoredAccount): SessionUser {
    current = toSessionUser(account)
    writeStore(LOCAL_SESSION_KEY, { uid: account.uid, at: new Date().toISOString() })
    emit()
    return current
  }

  /** Whoever the stored session says is signed in, if their account is still here. */
  function restore(): SessionUser | null {
    const stored = readStore<{ uid?: string } | null>(LOCAL_SESSION_KEY, null)
    if (!stored?.uid) return null
    const account = accounts().find((candidate) => candidate.uid === stored.uid)
    if (!account) {
      // A session pointing at an account that is gone is not a session.
      clearStore(LOCAL_SESSION_KEY)
      return null
    }
    return toSessionUser(account)
  }

  let current: SessionUser | null = restore()

  async function createAccount(input: {
    email: string
    password: string
    displayName?: string | null
  }): Promise<StoredAccount> {
    const email = normalizeEmail(input.email)
    const account: StoredAccount = {
      uid: randomId(),
      email,
      display_name: input.displayName?.trim() || null,
      password: await hashPassword(input.password),
      created_at: new Date().toISOString(),
    }
    saveAccounts([...accounts(), account])
    return account
  }

  /** Write a Profile, keeping the role it is given and nothing it was not. */
  function putProfile(profile: Profile): Profile {
    const others = storedProfiles().filter((stored) => stored.uid !== profile.uid)
    saveProfiles([...others, profile])
    return profile
  }

  const auth: AuthPort = {
    isCloud: false,
    supportsGoogle: false,

    subscribe(listener) {
      listeners.add(listener)
      listener(current)
      return () => {
        listeners.delete(listener)
      }
    },

    current: () => current,

    async register(input) {
      if (findAccount(input.email)) throw new AuthError('auth/email-already-in-use')
      return signIn(await createAccount(input))
    },

    async login(credentials) {
      const account = findAccount(credentials.email)
      // Two different refusals, but the same words and the same wait: an
      // attacker who can tell "no such account" from "wrong password" — by the
      // message or by the clock — has a list of who is here.
      if (!account) {
        await passwordMatches(credentials.password, NOBODY_SECRET)
        throw new AuthError('auth/invalid-credential')
      }
      if (!(await passwordMatches(credentials.password, account.password))) {
        throw new AuthError('auth/invalid-credential')
      }
      return signIn(account)
    },

    async loginWithGoogle() {
      throw new AuthError('hdl/unavailable', 'Google sign-in needs Firebase to be configured.')
    },

    async logout() {
      current = null
      clearStore(LOCAL_SESSION_KEY)
      emit()
    },

    async resetPassword() {
      throw new AuthError(
        'hdl/unavailable',
        'Demo mode has no email to send a reset link from. Configure Firebase for password resets.',
      )
    },
  }

  const profiles: ProfilePort = {
    async read(uid) {
      const stored = storedProfiles().find((profile) => profile.uid === uid)
      return stored ? normalizeProfile(stored) : null
    },

    async create(profile) {
      // A sign-up writes its own Profile, and a sign-up is always a Guest —
      // the same constraint firestore.rules puts on a self-written Profile.
      return putProfile({ ...profile, role: DEFAULT_ROLE })
    },
  }

  return { auth, profiles }
}
