import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Stops one broken component from taking the whole site down.
 *
 * Without this a render-time throw in any page unmounts the entire React tree
 * and the visitor gets a blank white screen with no way back. Here the failure
 * is contained, named, and given a way out: the page around it still renders,
 * and a Guest can reload or go back to the home page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[boundary] render failed', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center px-5">
        <div className="w-full max-w-lg rounded-[28px] bg-white border border-forest-900/5 shadow-card p-8">
          <div className="eyebrow">Something went wrong</div>
          <h1 className="font-serif text-3xl text-forest-900 mt-3">This page could not be shown</h1>
          <p className="mt-3 text-sm text-forest-800/85 leading-relaxed">
            The rest of the site is still working — this one screen hit an error while it was drawing. Nothing you
            submitted was lost. Try again, and if it keeps happening tell the Admin what you were doing.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-xl bg-cream-100 border border-forest-900/10 px-3 py-2 text-[11px] text-forest-800 whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn-primary text-xs" onClick={this.reset}>
              Try again
            </button>
            <a href="/" className="btn-ghost text-xs">
              Back to the home page
            </a>
          </div>
        </div>
      </div>
    )
  }
}