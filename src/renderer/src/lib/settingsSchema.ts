// Versioned export/import for RADAR's UI preferences (theme + CRT + behavior knobs). Pure + DOM-free so a
// corrupt or hand-edited file can never push malformed data into the app — every field is validated or
// clamped on the way in. Mirrors OpenEdu's settings-schema pattern. (Workspace roots/config are NOT
// included: those live in the main-process config and always go through the radar IPC, never a file blob.)

import { THEMES } from './theme'

export const EXPORT_KIND = 'radar-settings'
export const EXPORT_VERSION = 1

/** The portable preference bag (renderer-local prefs only). */
export interface RadarSettingsBag {
  showCompleted: boolean
  neglectedDays: number
}

export interface SettingsExport {
  kind: typeof EXPORT_KIND
  version: number
  exportedAt: string
  theme: string
  crtOff: boolean
  settings: RadarSettingsBag
}

const DEFAULTS: RadarSettingsBag = { showCompleted: true, neglectedDays: 30 }

/** True when `id` is a string naming a real theme. Unknown ids are skipped on import (never coerced). */
export function isKnownThemeId(id: unknown): id is string {
  return typeof id === 'string' && THEMES.some((t) => t.id === id)
}

/** Coerce/clamp an untrusted prefs object into a valid bag, filling missing fields from defaults. */
export function sanitizeSettingsBag(raw: unknown): RadarSettingsBag {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  const r = raw as Record<string, unknown>
  const days = Number(r.neglectedDays)
  return {
    showCompleted: typeof r.showCompleted === 'boolean' ? r.showCompleted : DEFAULTS.showCompleted,
    neglectedDays: Number.isFinite(days) ? Math.min(365, Math.max(1, Math.round(days))) : DEFAULTS.neglectedDays
  }
}

/** Assemble the export envelope (timestamp injected so this stays pure + testable). */
export function buildSettingsExport(
  theme: string,
  crtOff: boolean,
  settings: RadarSettingsBag,
  exportedAt: string
): SettingsExport {
  return { kind: EXPORT_KIND, version: EXPORT_VERSION, exportedAt, theme, crtOff, settings }
}

export function serializeSettings(payload: SettingsExport): string {
  return JSON.stringify(payload, null, 2)
}

/**
 * Parse + friendly-validate an imported settings file. Throws a human-readable error on bad JSON, a wrong
 * `kind`, or a missing `settings` block. Field-level clamping is deferred to the applier (sanitizeSettingsBag
 * / isKnownThemeId) so this stays a thin gate.
 */
export function parseSettingsExport(text: string): SettingsExport {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  if (!obj || typeof obj !== 'object') throw new Error('Not a RADAR settings file.')
  const o = obj as Record<string, unknown>
  if (o.kind !== EXPORT_KIND) throw new Error('Not a RADAR settings file.')
  if (!o.settings || typeof o.settings !== 'object' || Array.isArray(o.settings)) {
    throw new Error('Settings file is missing its settings block.')
  }
  return {
    kind: EXPORT_KIND,
    version: typeof o.version === 'number' ? o.version : EXPORT_VERSION,
    exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
    theme: typeof o.theme === 'string' ? o.theme : '',
    crtOff: o.crtOff === true,
    settings: sanitizeSettingsBag(o.settings)
  }
}
