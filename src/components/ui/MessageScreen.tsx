import type { ReactNode } from 'react'

/**
 * A whole screen that has one thing to say: "not found", "this page moved",
 * "this page is not yours", "something broke".
 *
 * These used to be four different hand-built centrings with slightly different
 * spacing and heading sizes. The message, the eyebrow and the actions are all
 * the shell provides; each screen supplies only its own words and its way out.
 */
export function MessageScreen({
  eyebrow,
  title,
  body,
  actions,
  tone = 'neutral',
}: {
  eyebrow: string
  title: ReactNode
  body: ReactNode
  actions?: ReactNode
  tone?: 'neutral' | 'danger'
}) {
  return (
    <div className="flex min-h-[70vh] items-center bg-cream-50 py-24 pt-32">
      <div className="mx-auto max-w-lg px-5 text-center">
        <div className={`eyebrow ${tone === 'danger' ? 'text-red-700' : ''}`}>{eyebrow}</div>
        <h1 className="h1 mt-3">{title}</h1>
        <div className="prose-lead">{body}</div>
        {actions && <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div>}
      </div>
    </div>
  )
}
