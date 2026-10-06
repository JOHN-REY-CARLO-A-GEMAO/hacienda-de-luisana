import * as React from 'react'

/**
 * Convert values from Firestore (and other external data sources) into safe JSX
 * children. Keeping this at the rendering boundary prevents a malformed or
 * newly-added field from taking down an entire page with React error #31.
 */
export function renderSafeText(value: any): React.ReactNode {
  if (value === null || value === undefined) return ''

  // Firestore Timestamps expose their wire representation as seconds and
  // nanoseconds. Do not pass the object itself to React.
  if (typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toLocaleString()
  }

  // Elements are already valid React children. Other objects are not.
  if (typeof value === 'object' && !React.isValidElement(value)) {
    console.warn('Attempted to render non-JSX object:', value)
    return JSON.stringify(value)
  }

  return value
}
