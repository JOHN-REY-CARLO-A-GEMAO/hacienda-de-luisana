import * as React from 'react'
import { formatDateTime } from './formatDate'

/**
 * Convert values from Firestore (and other external data sources) into safe JSX
 * children. Keeping this at the rendering boundary prevents a malformed or
 * newly-added field from taking down an entire page with React error #31.
 */
export function renderSafeText(value: unknown): React.ReactNode {
  if (value === null || value === undefined || typeof value === 'boolean') return ''
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value !== 'object') return String(value)
  if (React.isValidElement(value)) return value

  // Dates and Firestore Timestamp objects have a useful human-readable form.
  // Unknown objects are serialized below rather than handed to React as children.
  const formattedDate = formatDateTime(value, '')
  if (formattedDate) return formattedDate

  console.warn('Attempted to render non-JSX object:', value)
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // A cyclic object (or an object with a throwing toJSON) must not take down
    // the page either. This last-resort label is intentionally not the object.
    return '[unavailable]'
  }
}
