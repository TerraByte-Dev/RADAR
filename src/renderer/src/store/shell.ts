// The shell store (renderer spec 2): the route and everything about how the board is being
// looked at. No project data lives here.
import { create } from 'zustand'
import { readPrefs, writePrefs, type Density, type Theme } from '../lib/prefs'

export type Route =
  | { view: 'pickup' }
  | { view: 'project'; id: string }
  | { view: 'scope' }
  | { view: 'log' }
  | { view: 'settings'; section?: SettingsSection }
  | { view: 'first-run'; step: 'start' | 'diff' | 'found' }

export type SettingsSection = 'projects' | 'setup' | 'appearance' | 'about'

export interface Toast {
  /** Set in bold before the text: what happened, when a change could not be made. */
  lead?: string
  text: string
  /** One ghost button: Undo, or Try again. */
  action?: { label: string; caps?: string; run(): void }
  /** How long it stays; TOAST_MS when not set. */
  ms?: number
}

/** How long a toast stays (section 4); the undo toast stays UNDO_TOAST_MS. */
export const TOAST_MS = 6_000
export const UNDO_TOAST_MS = 10_000

export interface Shell {
  route: Route
  /** Esc pops; at most 20. */
  back: Route[]
  /** One selection shared by the Pick up list, the Scope and its list. */
  selectedId: string | null
  density: Density
  theme: Theme
  overlay: null | 'palette' | 'pick' | 'keys'
  /** What the palette offers: everything (`Ctrl K`), or projects alone (`/`). */
  palette: 'all' | 'projects'
  pickIndex: number
  expanded: Record<string, true>
  queueOpen: Record<string, true>
  sinceOpen: boolean
  toast: Toast | null
  undo: { id: string; token: string; expiresAt: number } | null
  /** Project ids with a write in flight: their write controls show aria-busy (renderer spec 8). */
  writing: Record<string, true>
  /** When RADAR was last left (section 2, persisted): the digest lists what moved since. Null before a first visit. */
  lastOpenedAt: number | null
  /** The registry-recovered banner on Pick up was dismissed (section 8); for this run only. */
  recoveredSeen: boolean
}

export interface ShellActions {
  /** Moves to `route` and closes any overlay; the same route again does nothing. */
  go(route: Route): void
  /** Esc: close the overlay, else clear the selection, else go back. */
  goBack(): void
  setTheme(theme: Theme): void
  toggleTheme(): void
  setDensity(density: Density): void
  toggleDensity(): void
  /** Shows one toast, in place of any other, for TOAST_MS. */
  say(toast: Toast): void
}

const BACK_MAX = 20
const same = (a: Route, b: Route): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The theme to start in: the one chosen with T, else the system's. */
export function initialTheme(prefs = readPrefs(), prefersLight = globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ?? false): Theme {
  return prefs.theme ?? (prefersLight ? 'light' : 'dark')
}

export const createShell = (prefs = readPrefs()) =>
  create<Shell & ShellActions>()((set, get) => ({
    route: { view: 'pickup' },
    back: [],
    selectedId: null,
    density: prefs.density ?? 'comfortable',
    theme: initialTheme(prefs),
    overlay: null,
    palette: 'all',
    pickIndex: 0,
    expanded: {},
    queueOpen: {},
    sinceOpen: false,
    toast: null,
    undo: null,
    writing: {},
    lastOpenedAt: prefs.lastOpenedAt ?? null,
    recoveredSeen: false,

    go: (route) => {
      const { route: from, back } = get()
      if (same(from, route)) return
      // an overlay belongs to the view that drew it, so it does not follow a change of route
      set({ route, back: [...back, from].slice(-BACK_MAX), overlay: null })
    },
    goBack: () => {
      const { overlay, selectedId, back, route } = get()
      if (overlay) return set({ overlay: null })
      // the project page shows no list, so the selection kept for the list's return is not on screen
      if (selectedId && route.view !== 'project') return set({ selectedId: null })
      const prev = back[back.length - 1]
      if (prev) set({ route: prev, back: back.slice(0, -1) })
    },
    setTheme: (theme) => {
      writePrefs({ theme })
      set({ theme })
    },
    toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    setDensity: (density) => {
      writePrefs({ density })
      set({ density })
    },
    toggleDensity: () => get().setDensity(get().density === 'comfortable' ? 'one-line' : 'comfortable'),
    say: (toast) => {
      set({ toast })
      setTimeout(() => {
        if (get().toast === toast) set({ toast: null })
      }, toast.ms ?? TOAST_MS)
    }
  }))

export const useShell = createShell()
