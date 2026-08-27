import type { CapacitorConfig } from '@capacitor/cli'

const liveReload = process.env.CAP_SERVER_URL

const config: CapacitorConfig = {
  appId: 'com.haciendadeluisana.app',
  appName: 'Hacienda de LuisAna',
  webDir: 'dist',
  server: liveReload
    ? {
        url: liveReload,
        cleartext: true,
      }
    : {
        androidScheme: 'https',
      },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,
    backgroundColor: '#fbf9f3',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1400,
      launchAutoHide: true,
      backgroundColor: '#0f1c11',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#fbf9f3',
    },
  },
}

export default config
