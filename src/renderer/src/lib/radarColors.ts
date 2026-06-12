/**
 * Runtime bridge from the CSS theme tokens to the `<canvas>` radar. The canvas can't read Tailwind
 * classes, so we read the resolved CSS variables (`--phosphor-rgb`, `--ink-rgb`, …) once and cache them,
 * recomputing only on the `radar-theme-change` event — never per rAF frame. This is what lets the radar's
 * accent/sweep/center/rings recolor with the active theme. Semantic data colors (urgency red/amber, the
 * time-ring scale, category hues) stay fixed constants in `lib/radar`/`projectRadar` — they encode meaning,
 * not the skin, so they must read the same across every theme.
 */

export type Channels = [number, number, number]

/** Default = the TERRABYTE.SYS phosphor palette, used as the fallback if a var is missing/unreadable. */
export interface RadarPalette {
  /** `--phosphor-rgb` — the accent (sweep, rings, center, selection). */
  accent: Channels
  /** `--phosphor-bright-rgb` — a brighter accent for highlights. */
  bright: Channels
  /** `--ink-rgb` — soft text/ghost ink. */
  ink: Channels
}

const FALLBACK: RadarPalette = {
  accent: [0, 255, 136],
  bright: [124, 255, 107],
  ink: [155, 245, 184]
}

/**
 * Parse a CSS custom-property value holding RGB channels into a numeric triple. Accepts the
 * space-separated form we store (`"0 255 136"`) and a comma form (`"0, 255, 136"`); falls back when the
 * value is empty or malformed. Pure (no DOM) so it's unit-testable.
 */
export function parseChannels(raw: string, fallback: Channels): Channels {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : fallback
}

function readVar(name: string, fallback: Channels): Channels {
  try {
    return parseChannels(getComputedStyle(document.documentElement).getPropertyValue(name), fallback)
  } catch {
    return fallback
  }
}

/** Read the live theme accent/ink channels off the document root. Call on mount + on theme change. */
export function readRadarPalette(): RadarPalette {
  return {
    accent: readVar('--phosphor-rgb', FALLBACK.accent),
    bright: readVar('--phosphor-bright-rgb', FALLBACK.bright),
    ink: readVar('--ink-rgb', FALLBACK.ink)
  }
}

/** `rgba(...)` string from channels + alpha. */
export function rgba(ch: Channels, alpha: number): string {
  return `rgba(${ch[0]},${ch[1]},${ch[2]},${alpha})`
}

/** Opaque `rgb(...)` string from channels. */
export function rgb(ch: Channels): string {
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`
}
