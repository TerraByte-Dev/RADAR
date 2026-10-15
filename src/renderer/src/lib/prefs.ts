// What the renderer keeps between runs (renderer spec 2): one localStorage entry, `radar.v3`.
// Never project data. Storage can be missing or throw (a cleared or locked profile); every read
// and write survives that and the app runs on defaults.

export type Theme = 'dark' | 'light'
export type Density = 'comfortable' | 'one-line'

export interface Prefs {
  theme?: Theme
  density?: Density
  lastOpenedAt?: number
  bearings?: Record<string, number>
}

const KEY = 'radar.v3'

export function readPrefs(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Prefs {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? '{}') as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const p = raw as Record<string, unknown>
    const out: Prefs = {}
    if (p.theme === 'dark' || p.theme === 'light') out.theme = p.theme
    if (p.density === 'comfortable' || p.density === 'one-line') out.density = p.density
    if (typeof p.lastOpenedAt === 'number') out.lastOpenedAt = p.lastOpenedAt
    if (typeof p.bearings === 'object' && p.bearings !== null && !Array.isArray(p.bearings)) out.bearings = p.bearings as Record<string, number>
    return out
  } catch {
    return {}
  }
}

/** Merges `patch` into what is stored. */
export function writePrefs(patch: Prefs, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ ...readPrefs(storage), ...patch }))
  } catch {
    /* a profile that cannot store keeps the defaults next run */
  }
}
