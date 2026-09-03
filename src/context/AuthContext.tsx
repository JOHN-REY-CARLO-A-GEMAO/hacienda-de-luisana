import React, { createContext, useEffect, useState, useCallback } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updateProfile,
  type User,
} from 'firebase/auth'
import { auth, googleProvider, isFirebaseConfigured } from '../lib/firebase'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
export type AuthContextType = {
  user: User | null
  loading: boolean
  isConfigured: boolean
  // Actions
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName?: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isConfigured: false,
  login: async () => { throw new Error('Firebase not configured') },
  register: async () => { throw new Error('Firebase not configured') },
  loginWithGoogle: async () => { throw new Error('Firebase not configured') },
  logout: async () => { throw new Error('Firebase not configured') },
  resetPassword: async () => { throw new Error('Firebase not configured') },
})

// ----------------------------------------------------------------------------
// Provider
// ----------------------------------------------------------------------------
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false)
      return
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })

    return () => unsub()
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase Auth is not configured. Check your .env.local')
    await signInWithEmailAndPassword(auth, email, password)
  }, [])

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    if (!auth) throw new Error('Firebase Auth is not configured. Check your .env.local')
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    if (displayName && cred.user) {
      await updateProfile(cred.user, { displayName })
    }
  }, [])

  const loginWithGoogle = useCallback(async () => {
    if (!auth || !googleProvider) throw new Error('Firebase Auth is not configured. Check your .env.local')
    await signInWithPopup(auth, googleProvider)
  }, [])

  const logout = useCallback(async () => {
    if (!auth) throw new Error('Firebase Auth is not configured')
    await firebaseSignOut(auth)
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    if (!auth) throw new Error('Firebase Auth is not configured')
    await sendPasswordResetEmail(auth, email)
  }, [])

  const value: AuthContextType = {
    user,
    loading,
    isConfigured: isFirebaseConfigured,
    login,
    register,
    loginWithGoogle,
    logout,
    resetPassword,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
