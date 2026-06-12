import { describe, it, expect } from 'vitest'
import {
  EXPORT_KIND,
  EXPORT_VERSION,
  buildSettingsExport,
  isKnownThemeId,
  parseSettingsExport,
  sanitizeSettingsBag
} from './settingsSchema'

describe('isKnownThemeId', () => {
  it('accepts real theme ids, rejects everything else', () => {
    expect(isKnownThemeId('terrabyte')).toBe(true)
    expect(isKnownThemeId('synthwave')).toBe(true)
    expect(isKnownThemeId('dark')).toBe(true)
    expect(isKnownThemeId('solarized')).toBe(false)
    expect(isKnownThemeId(undefined)).toBe(false)
    expect(isKnownThemeId(42)).toBe(false)
  })
})

describe('sanitizeSettingsBag', () => {
  it('fills defaults for non-objects', () => {
    expect(sanitizeSettingsBag(null)).toEqual({ showCompleted: true, neglectedDays: 30 })
    expect(sanitizeSettingsBag('nope')).toEqual({ showCompleted: true, neglectedDays: 30 })
  })

  it('clamps neglectedDays into [1, 365] and rounds', () => {
    expect(sanitizeSettingsBag({ neglectedDays: 0 }).neglectedDays).toBe(1)
    expect(sanitizeSettingsBag({ neglectedDays: 9999 }).neglectedDays).toBe(365)
    expect(sanitizeSettingsBag({ neglectedDays: 14.6 }).neglectedDays).toBe(15)
    expect(sanitizeSettingsBag({ neglectedDays: 'x' }).neglectedDays).toBe(30)
  })

  it('coerces showCompleted to a boolean default', () => {
    expect(sanitizeSettingsBag({ showCompleted: false }).showCompleted).toBe(false)
    expect(sanitizeSettingsBag({ showCompleted: 'yes' }).showCompleted).toBe(true)
  })
})

describe('parseSettingsExport', () => {
  const valid = JSON.stringify(
    buildSettingsExport('amber', true, { showCompleted: false, neglectedDays: 60 }, '2026-06-05T00:00:00.000Z')
  )

  it('round-trips a valid file', () => {
    const p = parseSettingsExport(valid)
    expect(p.kind).toBe(EXPORT_KIND)
    expect(p.version).toBe(EXPORT_VERSION)
    expect(p.theme).toBe('amber')
    expect(p.crtOff).toBe(true)
    expect(p.settings).toEqual({ showCompleted: false, neglectedDays: 60 })
  })

  it('rejects invalid JSON', () => {
    expect(() => parseSettingsExport('{not json')).toThrow(/valid JSON/)
  })

  it('rejects a non-RADAR file', () => {
    expect(() => parseSettingsExport(JSON.stringify({ kind: 'something-else' }))).toThrow(/RADAR/)
  })

  it('rejects a missing/invalid settings block', () => {
    expect(() => parseSettingsExport(JSON.stringify({ kind: EXPORT_KIND }))).toThrow(/settings block/)
    expect(() => parseSettingsExport(JSON.stringify({ kind: EXPORT_KIND, settings: [] }))).toThrow(
      /settings block/
    )
  })
})
