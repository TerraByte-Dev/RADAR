// The key dispatcher (renderer spec 9.1). Views register what each keymap id does while they
// are on screen; one window listener turns key presses into those actions, and controls that
// show a keycap run the same action by id.
import { useShell } from '../store/shell'
import { bindingFor, combo, type KeyId } from './keymap'

/** A handler gets the combo that ran it (`J`, `ArrowUp`, …), for the ids one key table row binds to several keys. */
export type Handlers = Partial<Record<KeyId, (combo?: string) => void>>

const layers: Handlers[] = []
const listeners = new Set<() => void>()
const changed = (): void => listeners.forEach((l) => l())

/** Adds a set of handlers on top of the others (a later layer wins); returns its removal. */
export function register(handlers: Handlers): () => void {
  layers.push(handlers)
  changed()
  return () => {
    const i = layers.indexOf(handlers)
    if (i >= 0) {
      layers.splice(i, 1)
      changed()
    }
  }
}

/** Calls `listener` whenever a set of handlers comes or goes; returns its removal. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function handler(id: KeyId): ((combo?: string) => void) | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const h = layers[i][id]
    if (h) return h
  }
  return undefined
}

/** Whether anything on screen does the action bound to `id`. */
export const has = (id: KeyId): boolean => !!handler(id)

/** Runs the action bound to `id`, if anything on screen does it. */
export function run(id: KeyId, key?: string): boolean {
  const h = handler(id)
  h?.(key)
  return !!h
}

/** The only actions a held key repeats; every other one acts once per press. */
const REPEATS: KeyId[] = ['list.move', 'scope.move']

const isTextField = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)))

/** A focused control that Enter or Space activates: the key is the control's, not the keymap's. */
const ACTIVATES = 'button, a[href], summary, select, input, [role=button], [role=link], [role=radio], [role=checkbox], [role=tab], [role=menuitem]'
const isControl = (t: EventTarget | null): boolean => t instanceof HTMLElement && t.matches(ACTIVATES)

export function onKeyDown(e: KeyboardEvent): void {
  if (e.isComposing || e.defaultPrevented) return
  // the palette and the keys sheet are modal: a key that gets past them reaches no view; Esc closes them
  const { overlay } = useShell.getState()
  if (overlay === 'palette' || overlay === 'keys') {
    if (e.key === 'Escape') useShell.setState({ overlay: null })
    return
  }
  const c = combo(e)
  if ((c === 'Enter' || c === 'Space') && isControl(e.target)) return
  const b = bindingFor(c, has, isTextField(e.target))
  if (!b) return
  e.preventDefault()
  if (e.repeat && !REPEATS.includes(b.id)) return
  run(b.id, c)
}
