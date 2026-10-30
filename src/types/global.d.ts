declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement | string, options: {
        sitekey: string
        callback: (token: string) => void
        'expired-callback': () => void
      }) => number
      remove: (widgetId: number) => void
    }
  }
}
