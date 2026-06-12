import { Component, type ReactNode } from 'react'

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Last line of defense around the view area — one bad record (a hand-edited BLIP.md,
 * a hostile field) must never white-screen the whole app. Catches a render crash and
 * shows a TERRABYTE.SYS-styled fault panel with the error + a reload escape hatch.
 * Keyed by view in App.tsx, so switching views retries a fresh render.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('view render crashed', error)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8">
        <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-p1">
          TERRABYTE.SYS // RENDER FAULT
        </div>
        <div className="max-w-md break-words text-center font-mono text-[11px] leading-relaxed text-muted">
          {this.state.error.message || String(this.state.error)}
        </div>
        <div className="max-w-md text-center font-mono text-[10px] leading-relaxed text-faint">
          A record on disk crashed this view. The rest of your data is untouched — reload to
          re-scan, or fix the offending BLIP.md by hand.
        </div>
        <button
          onClick={() => location.reload()}
          className="border border-phosphor bg-phosphor/[0.08] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-phosphor transition-colors hover:bg-phosphor/20"
        >
          reload
        </button>
      </div>
    )
  }
}
