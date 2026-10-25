import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

/**
 * Form field — the visible label, control, hint and error in one reading order.
 * The wrapping label gives every control a name; the generated ids also connect
 * its hint/error for screen-reader users without requiring call-site ids.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className = '',
  tour,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  /** Optional tour anchor (`data-tour`) for the interactive Guest tutorial. */
  tour?: string
  children: ReactNode
}) {
  const id = useId()
  const messageId = `${id}-message`
  const control = isValidElement<{
    'aria-describedby'?: string
    'aria-invalid'?: boolean | 'false' | 'true'
    'aria-required'?: boolean | 'false' | 'true'
  }>(children) ? children : null
  const describedBy = [
    control?.props['aria-describedby'],
    error || hint ? messageId : null,
  ].filter(Boolean).join(' ') || undefined
  const enhancedControl = control
    ? cloneElement(control, {
        'aria-describedby': describedBy,
        ...(required ? { 'aria-required': true as const } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })
    : children

  return (
    <label className={`block ${className}`}>
      <span className="label">
        {label}
        {required && (
          <>
            <span className="text-forest-500" aria-hidden="true"> *</span>
            <span className="sr-only"> (kailangan)</span>
          </>
        )}
        {tour && <span data-tour={tour} className="hidden" aria-hidden="true" />}
      </span>
      {enhancedControl}
      {error ? (
        <span id={messageId} className="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span id={messageId} className="field-hint">{hint}</span>
      )}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className = '', invalid, ...rest }, ref) {
    return <input ref={ref} className={`field ${className}`} aria-invalid={invalid || undefined} {...rest} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className = '', invalid, ...rest }, ref) {
    return <select ref={ref} className={`field ${className}`} aria-invalid={invalid || undefined} {...rest} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className = '', invalid, ...rest }, ref) {
    return <textarea ref={ref} className={`field ${className}`} aria-invalid={invalid || undefined} {...rest} />
  },
)

/** A labelled checkbox row with a full-width, at-least-44px tap area. */
export function CheckboxRow({
  checked,
  onChange,
  children,
  className = '',
  tour,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  className?: string
  tour?: string
}) {
  return (
    <label className={`flex min-h-11 items-start gap-3 py-2 text-base text-forest-800 ${className}`} data-tour={tour}>
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 rounded border-forest-300 text-forest-700 focus:ring-forest-600"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="leading-relaxed">{children}</span>
    </label>
  )
}
