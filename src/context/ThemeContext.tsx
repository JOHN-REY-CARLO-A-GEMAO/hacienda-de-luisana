import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type Theme = 'light' | 'dark' | 'system'

type ThemeContextType = {
  theme: Theme
  isDark: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

const THEME_STORAGE_KEY = 'hdl_theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(THEME_STORAGE_KEY)
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          return stored
        }
      }
    } catch {
      // Ignore private browsing errors
    }
    return 'system'
  })

  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored === 'dark') return true
      if (stored === 'light') return false
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  })

  const applyTheme = useCallback((targetTheme: Theme) => {
    if (typeof document === 'undefined') return
    const systemDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    const effectiveDark = targetTheme === 'dark' || (targetTheme === 'system' && systemDark)

    setIsDark(effectiveDark)
    const root = document.documentElement
    if (effectiveDark) {
      root.classList.add('dark')
      root.style.colorScheme = 'dark'
    } else {
      root.classList.remove('dark')
      root.style.colorScheme = 'light'
    }

    // Update theme-color meta tag
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', effectiveDark ? '#0D1711' : '#243D2E')
    }
  }, [])

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme)
      try {
        if (typeof window !== 'undefined') {
          if (newTheme === 'system') {
            localStorage.removeItem(THEME_STORAGE_KEY)
          } else {
            localStorage.setItem(THEME_STORAGE_KEY, newTheme)
          }
        }
      } catch {
        // Ignore
      }
      applyTheme(newTheme)
    },
    [applyTheme],
  )

  const toggleTheme = useCallback(() => {
    setTheme(isDark ? 'light' : 'dark')
  }, [isDark, setTheme])

  useEffect(() => {
    applyTheme(theme)

    if (theme === 'system' && typeof window !== 'undefined') {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const listener = () => applyTheme('system')
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    }
  }, [theme, applyTheme])

  return (
    <ThemeContext.Provider value={{ theme, isDark, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) {
    // Graceful fallback for tests that do not wrap in ThemeProvider
    return {
      theme: 'system',
      isDark: false,
      setTheme: () => {},
      toggleTheme: () => {},
    }
  }
  return context
}
