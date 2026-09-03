import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { isNativeApp } from '../lib/native'

export function useNativeShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    if (!isNativeApp) return

    StatusBar.setStyle({ style: Style.Light }).catch(() => {})
    StatusBar.setBackgroundColor({ color: '#fbf9f3' }).catch(() => {})
    StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
    SplashScreen.hide().catch(() => {})
  }, [])

  useEffect(() => {
    if (!isNativeApp) return

    const sub = App.addListener('backButton', ({ canGoBack }) => {
      const path = pathname.replace(/\/$/, '') || '/'
      if (path === '/app') {
        App.exitApp().catch(() => {})
        return
      }
      if (canGoBack) {
        navigate(-1)
        return
      }
      navigate('/app', { replace: true })
    })

    return () => {
      sub.then((handle) => handle.remove())
    }
  }, [navigate, pathname])
}
