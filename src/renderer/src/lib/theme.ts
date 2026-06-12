// Color / appearance themes for RADAR. The whole UI is CSS-variable driven (styles/index.css) and the
// CRT overlay is toggled by an `html.crt-off` class. A theme is just a named bundle of CSS-var overrides —
// declared in index.css under `html[data-theme="…"]` — plus a CRT/font intent (derived from `family`).
// We persist the choice to localStorage so it can be applied before first paint (no flash). Mirrors the
// pattern Tate already shipped in OpenEdu (src/lib/theme.ts), retargeted to RADAR's tokens.
//
// Two families:
//   • "crt"        — keep the TERRABYTE.SYS look (scanlines + grid + phosphor glow), just recolored.
//   • "universal"  — drop the CRT overlay + neutral palette, so the app "feels like a new app" for users
//                    who don't want the retro skin.

export type ThemeFamily = 'crt' | 'universal'

export interface Theme {
  id: string
  name: string
  blurb: string
  family: ThemeFamily
  /** Swatch shown on the picker card — must mirror the [data-theme] block in index.css. */
  swatch: { bg: string; accent: string; ink: string }
}

export const THEMES: Theme[] = [
  // CRT family — ordered around the color wheel. `terrabyte` is the default and IS `:root` (no override block).
  { id: 'terrabyte',   name: 'TERRABYTE.SYS', blurb: 'Phosphor-green CRT — the original.',      family: 'crt',       swatch: { bg: '#000000', accent: '#00FF88', ink: '#9bf5b8' } },
  { id: 'ice',         name: 'Ice',           blurb: 'Cool cyan-white on deep navy.',           family: 'crt',       swatch: { bg: '#02040c', accent: '#6FE6FF', ink: '#BFEFFF' } },
  { id: 'amber',       name: 'Amber',         blurb: 'Warm amber terminal glow.',               family: 'crt',       swatch: { bg: '#000000', accent: '#FFB000', ink: '#FFD074' } },
  { id: 'tangerine',   name: 'Tangerine',     blurb: 'Hot orange on charred black.',            family: 'crt',       swatch: { bg: '#060300', accent: '#FF7A18', ink: '#FFC089' } },
  { id: 'crimson',     name: 'Crimson',       blurb: 'Blood-red neon on deep maroon.',          family: 'crt',       swatch: { bg: '#060102', accent: '#FF2E4D', ink: '#FF94A2' } },
  { id: 'vapor',       name: 'Vapor',         blurb: 'Vaporwave pink + cyan duotone.',          family: 'crt',       swatch: { bg: '#070213', accent: '#FF8AD8', ink: '#93E6FF' } },
  { id: 'synthwave',   name: 'Synthwave',     blurb: 'Magenta neon on deep violet.',            family: 'crt',       swatch: { bg: '#05000c', accent: '#FF3AC8', ink: '#FF9CE6' } },
  { id: 'ultraviolet', name: 'Ultraviolet',   blurb: 'Electric violet on midnight indigo.',     family: 'crt',       swatch: { bg: '#050316', accent: '#A06BFF', ink: '#C9B0FF' } },
  // Universal family — neutral, no CRT, clean palette.
  { id: 'dark',        name: 'Dark',          blurb: 'Clean neutral dark — no CRT.',            family: 'universal', swatch: { bg: '#0d1117', accent: '#4493f8', ink: '#c9d1d9' } },
  { id: 'light',       name: 'Light',         blurb: 'Bright neutral light — no CRT.',          family: 'universal', swatch: { bg: '#ffffff', accent: '#0969da', ink: '#1f2328' } }
]

export const DEFAULT_THEME_ID = 'terrabyte'
const STORAGE_KEY = 'radar.theme'
const CRT_OFF_KEY = 'radar.crt-off'
/** Legacy pref bag — `{ crtEffects, showCompleted }`. `crtEffects: false` migrates to `crt-off`. */
const LEGACY_SETTINGS_KEY = 'radar.settings'

/** Custom DOM events broadcast on `window` so decoupled surfaces (title bar, Appearance tab, store) sync. */
export const THEME_CHANGE_EVENT = 'radar-theme-change'
export const CRT_CHANGE_EVENT = 'radar-crt-change'

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function getThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

/** Only CRT-family themes expose the manual CRT on/off toggle (universal themes are intrinsically off). */
export function themeSupportsCrt(id: string): boolean {
  return getTheme(id).family === 'crt'
}

// ── Manual CRT preference (the title-bar toggle + Appearance tab share this) ──────────────────────────────
/**
 * The user's manual "CRT overlay off" preference. Defaults to **on** (off === false). Falls back to the
 * legacy `radar.settings.crtEffects` flag when the dedicated key is absent, so existing users who had CRT
 * disabled keep it disabled even before `themeBoot()` writes the migrated value through (order-independent).
 */
export function getCrtOff(): boolean {
  try {
    const v = localStorage.getItem(CRT_OFF_KEY)
    if (v !== null) return v === '1'
    const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as { crtEffects?: unknown }
      if (parsed && parsed.crtEffects === false) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Set the manual CRT preference: persist, toggle the class, and broadcast so any open surface (title bar,
 * Appearance tab, store) stays in sync. Only meaningful under CRT themes — universal themes force it off.
 */
export function setCrtOff(off: boolean): void {
  try {
    localStorage.setItem(CRT_OFF_KEY, off ? '1' : '0')
  } catch {
    /* ignore */
  }
  document.documentElement.classList.toggle('crt-off', off)
  try {
    window.dispatchEvent(new CustomEvent(CRT_CHANGE_EVENT, { detail: off }))
  } catch {
    /* ignore */
  }
}

/**
 * Pure decision: should the CRT overlay be OFF for this theme? Universal themes force it off; CRT themes
 * honor the user's manual preference. Extracted so the reconciliation is unit-testable without the DOM.
 */
export function resolveCrtOff(theme: Theme, manualCrtOff: boolean): boolean {
  return theme.family === 'universal' ? true : manualCrtOff
}

/** Whether the CRT overlay is currently visible — the single derived truth the store/UI mirror. */
export function crtVisible(): boolean {
  return !resolveCrtOff(getTheme(getThemeId()), getCrtOff())
}

/**
 * Apply (and persist) a theme: set `data-theme` on `<html>` and reconcile the CRT overlay —
 *   • universal theme → force the overlay off (CSS hides scanlines/grid/vignette) WITHOUT touching the
 *     stored manual preference, so returning to a CRT theme restores whatever the user last chose;
 *   • crt theme       → honor the user's manual CRT preference (`radar.crt-off`).
 * Dispatches `radar-theme-change` so decoupled listeners react. Returns the resolved theme.
 */
export function applyTheme(id: string): Theme {
  const theme = getTheme(id)
  const root = document.documentElement
  root.dataset.theme = theme.id
  root.classList.toggle('crt-off', resolveCrtOff(theme, getCrtOff()))
  try {
    localStorage.setItem(STORAGE_KEY, theme.id)
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme.id }))
  } catch {
    /* ignore */
  }
  return theme
}

/**
 * Pre-paint boot: migrate the legacy CRT flag (once), then apply the stored theme + crt-off class to
 * `<html>` before React renders, so there's no flash of the default theme. Call from `main.tsx` before
 * `createRoot().render()`.
 */
export function themeBoot(): void {
  try {
    // One-time migration: an old `crtEffects: false` becomes a persisted `crt-off` so future loads are clean.
    if (localStorage.getItem(CRT_OFF_KEY) === null) {
      const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY)
      if (legacy) {
        const parsed = JSON.parse(legacy) as { crtEffects?: unknown }
        if (parsed && parsed.crtEffects === false) localStorage.setItem(CRT_OFF_KEY, '1')
      }
    }
  } catch {
    /* ignore */
  }
  applyTheme(getThemeId())
}
