import { ReactNode } from 'react'

/**
 * Safe rendering helper for JSX text content.
 * 
 * Detects Firestore Timestamp objects and other non-string objects
 * that would cause "Objects are not valid as a React child" errors.
 * 
 * @param value - Any value that might be rendered in JSX
 * @returns React.ReactNode safe for rendering
 */
export function renderSafeText(value: any): ReactNode {
  if (value === null || value === undefined) return ''

  // Detect Firestore Timestamp objects (both SDK shapes)
  if (typeof value === 'object' && value !== null) {
    // Check for 'seconds' property (Firestore Timestamp shape)
    if ('seconds' in value && typeof value.seconds === 'number') {
      const millis = value.nanoseconds ? value.seconds * 1000 + Math.floor(value.nanoseconds / 1_000_000) : value.seconds * 1000
      const date = new Date(millis)
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
    }
    // Check for 'toDate' method (Admin SDK Timestamp shape)
    if (typeof value.toDate === 'function') {
      const date = value.toDate()
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : ''
    }
    // Check for 'toMillis' method
    if (typeof value.toMillis === 'function') {
      const millis = value.toMillis()
      if (typeof millis === 'number') {
        const date = new Date(millis)
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
      }
    }
  }

  // Fallback: stringify any other object that isn't a valid React element
  if (typeof value === 'object') {
    // Check if it's a valid React element (though React.isValidElement is not available here)
    // We'll check for common React element properties
    if (typeof value === 'object' && value !== null && '$$typeof' in value) {
      return value
    }
    console.warn('Attempted to render non-JSX object:', value)
    try {
      return JSON.stringify(value)
    } catch {
      return '[Object]'
    }
  }

  return value
}

/**
 * Safe rendering helper specifically for timestamp values.
 * Returns a formatted date string or empty string if invalid.
 */
export function renderSafeTimestamp(value: any): string {
  if (value === null || value === undefined) return ''

  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  }

  if (typeof value === 'object' && value !== null) {
    if ('seconds' in value && typeof value.seconds === 'number') {
      const millis = value.nanoseconds ? value.seconds * 1000 + Math.floor(value.nanoseconds / 1_000_000) : value.seconds * 1000
      const date = new Date(millis)
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
    }
    if (typeof value.toDate === 'function') {
      const date = value.toDate()
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : ''
    }
    if (typeof value.toMillis === 'function') {
      const millis = value.toMillis()
      if (typeof millis === 'number') {
        const date = new Date(millis)
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
      }
    }
  }

  return ''
}