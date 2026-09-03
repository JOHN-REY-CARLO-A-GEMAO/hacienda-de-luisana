import { Capacitor } from '@capacitor/core'

/** True when running inside the Android/iOS Capacitor shell. */
export const isNativeApp = Capacitor.isNativePlatform()
