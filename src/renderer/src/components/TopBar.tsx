// The top bar (renderer spec 2, section 4): wordmark, three tabs with no numerals, the command
// field, and 138px at the right where the native window controls are drawn.
import { run } from '../lib/actions'
import type { KeyId } from '../lib/keymap'
import { nothingTracked, useBoard } from '../store/board'
import { useShell, type Route } from '../store/shell'
import { Keys } from './atoms'
import { Logo } from './glyphs'

const TABS: { view: Route['view']; label: string; id: KeyId }[] = [
  { view: 'pickup', label: 'Pick up', id: 'view.pickup' },
  { view: 'scope', label: 'Scope', id: 'view.scope' },
  { view: 'log', label: 'Log', id: 'view.log' }
]

export function TopBar(): JSX.Element {
  const view = useShell((s) => s.route.view)
  // The project page belongs to Pick up, where it was opened from; so does first run while it is forced.
  const empty = useBoard(nothingTracked)
  const on = view === 'project' || empty ? 'pickup' : view
  return (
    <header className="top">
      <div className="brand">
        <Logo />
        <span>
          RADAR<b>.v3</b>
        </span>
      </div>
      <nav className="tabs" aria-label="Views">
        {TABS.map((t) => (
          <button key={t.view} type="button" aria-current={on === t.view ? 'page' : undefined} onClick={() => run(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <span className="sp" />
      <button type="button" className="cmd" aria-label="Search or run a command" aria-keyshortcuts="Control+K" onClick={() => run('palette.open')}>
        <span className="long">Search or run a command</span>
        <span className="short">Search</span>
        <span className="caps">
          <Keys caps="Ctrl K" />
        </span>
      </button>
      <div className="wc" aria-hidden="true" />
    </header>
  )
}
