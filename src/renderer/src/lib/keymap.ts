// The keymap (renderer spec 9.1): the one table. The status-bar hints, the palette's action
// list and the keys sheet are all generated from it; a binding that is not here does not exist.

export type KeyScope = 'Anywhere' | 'A project' | 'Project page' | 'Scope'

export type KeyId =
  | 'palette.open'
  | 'palette.projects'
  | 'view.pickup'
  | 'view.scope'
  | 'view.log'
  | 'pick.open'
  | 'density.toggle'
  | 'theme.toggle'
  | 'edit.undo'
  | 'keys.show'
  | 'view.settings'
  | 'nav.back'
  | 'list.move'
  | 'project.open'
  | 'project.resume'
  | 'project.copyPrompt'
  | 'project.editor'
  | 'task.done'
  | 'task.notNow'
  | 'project.focus'
  | 'project.catchUp'
  | 'project.hide'
  | 'task.add'
  | 'task.expand'
  | 'project.prevNext'
  | 'scope.move'

export interface Binding {
  scope: KeyScope
  /** How the keys are drawn, keycap by keycap (space-separated). */
  caps: string
  /** The combos that trigger it, as `combo()` spells them. */
  keys: string[]
  id: KeyId
  label: string
  /** The shorter name the palette and the keys sheet show, where the label is long. */
  short?: string
  /** The status bar's word for it. */
  hint?: string
}

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']

export const KEYMAP: Binding[] = [
  { scope: 'Anywhere', caps: 'Ctrl K', keys: ['Ctrl+K'], id: 'palette.open', label: 'Command palette', hint: 'commands' },
  { scope: 'Anywhere', caps: '/', keys: ['/'], id: 'palette.projects', label: 'Jump to a project', hint: 'filter' },
  { scope: 'Anywhere', caps: '1', keys: ['1'], id: 'view.pickup', label: 'Pick up' },
  { scope: 'Anywhere', caps: '2', keys: ['2'], id: 'view.scope', label: 'Scope' },
  { scope: 'Anywhere', caps: '3', keys: ['3'], id: 'view.log', label: 'Log' },
  { scope: 'Anywhere', caps: 'P', keys: ['P'], id: 'pick.open', label: 'Pick one for me', hint: 'pick one for me' },
  { scope: 'Anywhere', caps: 'D', keys: ['D'], id: 'density.toggle', label: 'One-line density on or off', short: 'One-line density', hint: 'density' },
  { scope: 'Anywhere', caps: 'T', keys: ['T'], id: 'theme.toggle', label: 'Light or dark' },
  { scope: 'Anywhere', caps: 'Ctrl Z', keys: ['Ctrl+Z'], id: 'edit.undo', label: 'Undo the last change' },
  { scope: 'Anywhere', caps: '?', keys: ['?'], id: 'keys.show', label: 'Show these keys', hint: 'keys' },
  { scope: 'Anywhere', caps: 'Ctrl ,', keys: ['Ctrl+,'], id: 'view.settings', label: 'Settings' },
  { scope: 'Anywhere', caps: 'Esc', keys: ['Escape'], id: 'nav.back', label: 'Close, or go back', hint: 'back' },
  { scope: 'A project', caps: 'J K', keys: ['J', 'K', 'ArrowDown', 'ArrowUp'], id: 'list.move', label: 'Move down or up', hint: 'move' },
  { scope: 'A project', caps: 'Enter', keys: ['Enter'], id: 'project.open', label: 'Open the project page', short: 'Open', hint: 'open' },
  { scope: 'A project', caps: 'R', keys: ['R'], id: 'project.resume', label: 'Resume: copy the re-entry prompt and open in editor', short: 'Resume', hint: 'resume' },
  { scope: 'A project', caps: 'C', keys: ['C'], id: 'project.copyPrompt', label: 'Copy a re-entry prompt for an agent', short: 'Copy a re-entry prompt', hint: 'copy re-entry prompt' },
  { scope: 'A project', caps: 'E', keys: ['E'], id: 'project.editor', label: 'Open in editor' },
  { scope: 'A project', caps: 'X', keys: ['X'], id: 'task.done', label: 'Mark the next step done', short: 'Mark next step done', hint: 'mark done' },
  { scope: 'A project', caps: 'N', keys: ['N'], id: 'task.notNow', label: 'Not now: move the next step down one', short: 'Not now: next step down one', hint: 'not now' },
  { scope: 'A project', caps: 'F', keys: ['F'], id: 'project.focus', label: 'Pin or unpin as focus', hint: 'pin as focus' },
  { scope: 'A project', caps: 'L', keys: ['L'], id: 'project.catchUp', label: 'Copy a prompt that has an agent catch the log up', short: 'Have an agent catch the log up' },
  { scope: 'A project', caps: 'H', keys: ['H'], id: 'project.hide', label: 'Hide from the board' },
  { scope: 'Project page', caps: 'A', keys: ['A'], id: 'task.add', label: 'Add a task', hint: 'add a task' },
  { scope: 'Project page', caps: 'Space', keys: ['Space'], id: 'task.expand', label: "Show or hide a task's detail", short: "Show a task's detail", hint: 'detail' },
  { scope: 'Project page', caps: '[ ]', keys: ['[', ']'], id: 'project.prevNext', label: 'Previous or next project', hint: 'previous / next project' },
  { scope: 'Scope', caps: 'Arrows', keys: ARROWS, id: 'scope.move', label: 'Move between blips: left and right by bearing, up and down by ring', short: 'Move between blips', hint: 'move between blips' }
]

export const binding = (id: KeyId): Binding => KEYMAP.find((b) => b.id === id) as Binding

/** What the palette and the keys sheet call a binding. */
export const nameOf = (b: Binding): string => b.short ?? b.label

/**
 * A key event as the table spells it: `Ctrl+K`, `J`, `?`, `Enter`, `Space`. Shift is part of the
 * character (`?`), not a prefix, except on a letter: Shift+T is `Shift+T`, which nothing binds.
 */
export function combo(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey?: boolean }): string {
  const key = e.key === ' ' ? 'Space' : e.key === 'Esc' ? 'Escape' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  const shift = e.shiftKey && /^[a-z]$/i.test(e.key) ? 'Shift+' : ''
  return `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${shift}${key}`
}

/**
 * The binding a key event triggers: the first in the table for this combo whose action is
 * live right now (`live`), so one key can belong to two scopes (the arrows: a list and the scope)
 * and the view decides. Inside a text field only `Esc` and Ctrl chords reach the keymap.
 */
export function bindingFor(c: string, live: (id: KeyId) => boolean, inTextField = false): Binding | null {
  if (inTextField && c !== 'Escape' && !c.startsWith('Ctrl+')) return null
  return KEYMAP.find((b) => b.keys.includes(c) && live(b.id)) ?? null
}
