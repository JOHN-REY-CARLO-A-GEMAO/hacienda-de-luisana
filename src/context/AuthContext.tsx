// ----------------------------------------------------------------------------
// The authentication context every page reads
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// A thin React seam over `src/lib/authSession`: it holds the session's state, and
// hands pages the two questions they actually ask — "which of the three roles am
// I" and "may I do this" — plus the actions the sign-in form needs.
//
// The answers come from the session, never from a component's own state, so a
// role cannot be changed by editing what the browser holds: the Profile is read
// again on every reload, and firestore.rules reads it again on every request.
// ----------------------------------------------------------------------------

import React, { createContext, useEffect, useMemo, useState } from 'react'
import {
  canOpenPage,
  type Permission,
  type Profile,
  type Role,
  type SessionState,
  type SessionUser,
} from '../lib/auth'
import { appSession } from '../lib/authSession'
import type { Actor } from '../lib/booking'
import { isFirebaseConfigured } from '../lib/firebase'

export type AuthContextType = {
  /** Who is signed in, or null. */
  user: SessionUser | null
  /** The stored Profile the role was read from, when there is one. */
  profile: Profile | null
  /** One of the three roles, or null while loading and while signed out. */
  role: Role | null
  /** True while a session is being restored or a Profile is being read. */
  loading: boolean
  status: SessionState['status']
  /** Firebase is configured: accounts and enforcement live in the cloud. */
  isConfigured: boolean
  isCloud: boolean
  /** May the signed-in person do this? */
  can: (permission: Permission) => boolean
  /** May they open this page? */
  canOpen: (path: string) => boolean
  /** The actor to put on a Booking action, or null when nobody is signed in. */
  actor: Actor | null
  // Actions
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName?: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  /** Demo mode only: step into a role there is no Host to grant. */
  signInAsRole: (role: Role) => Promise<void>
  /** Host only: decide which of the three roles somebody has. */
  assignRole: (
    target: { uid: string; email?: string | null; displayName?: string | null },
    role: Role,
  ) => Promise<Profile>
  /** Host only: everybody who has a Profile. */
  team: () => Promise<Profile[]>
  /** Re-read the signed-in person's Profile. */
  refresh: () => Promise<void>
}

const notAvailable = async (): Promise<never> => {
  throw new Error('Firebase not configured')
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  role: null,
  loading: true,
  status: 'loading',
  isConfigured: false,
  isCloud: false,
  can: () => false,
  canOpen: () => false,
  actor: null,
  login: notAvailable,
  register: notAvailable,
  loginWithGoogle: notAvailable,
  logout: notAvailable,
  resetPassword: notAvailable,
  signInAsRole: notAvailable,
  assignRole: notAvailable,
  team: notAvailable,
  refresh: notAvailable,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const session = useMemo(() => appSession(), [])
  const [state, setState] = useState<SessionState>(() => session.getState())

  useEffect(() => session.subscribe(setState), [session])

  const value = useMemo<AuthContextType>(
    () => ({
      user: state.user,
      profile: state.profile,
      role: state.role,
      loading: state.status === 'loading',
      status: state.status,
      isConfigured: isFirebaseConfigured,
      isCloud: state.isCloud,
      can: (permission) => session.can(permission),
      canOpen: (path) => canOpenPage(state.role, path),
      actor: session.actor(),
      login: async (email, password) => {
        await session.login(email, password)
      },
      register: async (email, password, displayName) => {
        await session.register({ email, password, displayName })
      },
      loginWithGoogle: async () => {
        await session.loginWithGoogle()
      },
      logout: async () => {
        await session.logout()
      },
      resetPassword: async (email) => {
        await session.resetPassword(email)
      },
      signInAsRole: async (role) => {
        await session.signInAsRole(role)
      },
      assignRole: (target, role) => session.assignRole(target, role),
      team: () => session.team(),
      refresh: () => session.refresh(),
    }),
    [session, state],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
