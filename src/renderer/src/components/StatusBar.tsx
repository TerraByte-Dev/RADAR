// The status bar (renderer spec 2, section 4): key hints for the current view, from the
// keymap by id, and one quiet status at the right. A hint is drawn only while something on
// screen does its action, and a project action only while there is a project to act on, as a
// control that cannot act is not drawn (section 0, rule 12).
import { useSyncExternalStore } from 'react'
import { has, subscribe } from '../lib/actions'
import { GIT_WARNING } from '../lib/derive'
import { binding, type KeyId } from '../lib/keymap'
import { useShell, type Route } from '../store/shell'
import { Keys } from './atoms'

const HINTS: Partial<Record<Route['view'], KeyId[]>> = {
  pickup: ['list.move', 'project.open', 'pick.open', 'project.copyPrompt', 'density.toggle', 'palette.open'],
  project: ['list.move', 'task.expand', 'task.done', 'task.notNow', 'project.prevNext', 'nav.back'],
  scope: ['scope.move', 'project.open', 'project.focus', 'nav.back'],
  log: ['list.move', 'project.open', 'palette.projects', 'nav.back'],
  settings: ['nav.back', 'palette.open']
}

/** Hints shown under 1180: the first five on Pick up, three elsewhere. */
const keep = (view: Route['view']): number => (view === 'pickup' ? 5 : 3)

export interface StatusBarProps {
  view: Route['view']
  /** The project the keys act on (named in Pick up's `↵` hint); null when there is none. */
  target: string | null
  /** `activity read HH:MM` (dropped under 1180), or the git warning (section 8), which is said nowhere else so stays at every width. */
  status?: string | null
}

/** The hints that can act right now, space-separated (a string, so the snapshot compares by value). */
const live = (view: Route['view'], target: string | null): string =>
  (HINTS[view] ?? []).filter((id) => has(id) && (target !== null || binding(id).scope === 'Anywhere')).join(' ')

export function StatusBar({ view, target, status }: StatusBarProps): JSX.Element {
  const snapshot = (): string => live(view, target)
  const ids = useSyncExternalStore(subscribe, snapshot, snapshot).split(' ').filter(Boolean) as KeyId[]
  return (
    <footer className="foot">
      {ids.map((id, i) => {
        const b = binding(id)
        // only Pick up's ↵ names its project: elsewhere the project it opens is the one on screen
        const words = id === 'project.open' && target && view === 'pickup' ? `open ${target}` : (b.hint ?? b.label)
        return (
          <span key={id} className={i >= keep(view) ? 'opt' : undefined}>
            <Keys caps={b.caps} />
            <b>{words}</b>
          </span>
        )
      })}
      <span className="sp" />
      {status === GIT_WARNING ? (
        // under 1180 it keeps its first words and the way to the details, so it fits beside the hints
        <span className="mono">
          git was not found<span className="opt"> · recency is from file times</span> ·{' '}
          <button type="button" className="u" onClick={() => useShell.getState().go({ view: 'settings', section: 'setup' })}>
            details
          </button>
        </span>
      ) : (
        status && <span className="opt mono">{status}</span>
      )}
    </footer>
  )
}
