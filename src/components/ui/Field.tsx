import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

/**
 * Form field — the label, the control, the hint and the error, in that order.
 *
 * The site had four ways to draw the same field: a local `Field` in the booking
 * form, hand-written `<label><span class="label">` blocks in the account page,
 * another in the status lookup, and unlabelled inputs in Support. They now all
 * come through here, which is what makes the label style, the error placement
 * and the disabled/readonly look the same everywhere.
 *
 * The control is wrapped in its `<label>`, so clicking the label focuses the
 * input without every call site needing a matching `id`/`htmlFor` pair.
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
  return (
    <label className={`block ${className}`} data-tour={tour}>
      <span className="label">
        {label}
        {required && <span className="text-forest-500"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className = '', invalid, ...rest }, ref) {
    return <input ref={ref} className={`field ${className}`} aria-invalid={invalid || undefined} {...rest} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', ...rest }, ref) {
    return <select ref={ref} className={`field ${className}`} {...rest} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={`field ${className}`} {...rest} />
  },
)

/** A labelled checkbox row: the control, then the sentence that explains it. */
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
    <label className={`flex items-start gap-2.5 text-xs text-forest-800 ${className}`} data-tour={tour}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-forest-300 text-forest-700 focus:ring-forest-600"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="leading-relaxed">{children}</span>
    </label>
  )
}
