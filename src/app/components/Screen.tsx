export function Screen({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={`px-4 pt-4 pb-8 ${className}`}>{children}</div>
}

export function ScreenTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-5">
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <h1 className="display text-[28px] leading-[1.1] text-forest-900 mt-1">{title}</h1>
      {children}
    </div>
  )
}
