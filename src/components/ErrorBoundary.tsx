import { Component, type ErrorInfo, type ReactNode } from 'react'
import { MessageScreen } from './ui/MessageScreen'

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
      <MessageScreen
        tone="danger"
        eyebrow="Something went wrong"
        title="This page could not be shown"
        body={
          <>
            <p>
              The rest of the site is still working — this one screen hit an error while it was drawing. Nothing you
              submitted was lost. Try again, and if it keeps happening tell the Admin what you were doing.
            </p>
            <pre className="mx-auto mt-4 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-forest-900/10 bg-cream-100 px-3 py-2 text-left text-[11px] text-forest-800 dark:border-cream-100/15 dark:bg-forest-950 dark:text-cream-100">
              {error.message}
            </pre>
          </>
        }
        actions={
          <>
            <button type="button" className="btn-primary btn-sm" onClick={this.reset}>
              Try again
            </button>
            <a href="/" className="btn-ghost btn-sm">
              Back to the home page
            </a>
          </>
        }
      />
    )
  }
}