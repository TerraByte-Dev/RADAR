import { describe, it, expect } from 'vitest'
import { THEMES, getTheme, resolveCrtOff, themeSupportsCrt, DEFAULT_THEME_ID } from './theme'

describe('theme registry', () => {
  it('the default theme exists and is TERRABYTE.SYS; unknown ids fall back to it', () => {
    expect(getTheme(DEFAULT_THEME_ID).id).toBe('terrabyte')
    expect(getTheme('does-not-exist').id).toBe('terrabyte')
    expect(getTheme(undefined).id).toBe('terrabyte')
    expect(getTheme(null).id).toBe('terrabyte')
  })

  it('has both families and unique ids', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(THEMES.some((t) => t.family === 'universal')).toBe(true)
    expect(THEMES.some((t) => t.family === 'crt')).toBe(true)
  })

  it('every theme carries a full swatch (bg/accent/ink)', () => {
    for (const t of THEMES) {
      expect(t.swatch.bg).toMatch(/^#/)
      expect(t.swatch.accent).toMatch(/^#/)
      expect(t.swatch.ink).toMatch(/^#/)
    }
  })

  it('themeSupportsCrt is true only for the CRT family', () => {
    expect(themeSupportsCrt('terrabyte')).toBe(true)
    expect(themeSupportsCrt('synthwave')).toBe(true)
    expect(themeSupportsCrt('dark')).toBe(false)
    expect(themeSupportsCrt('light')).toBe(false)
  })
})

describe('resolveCrtOff', () => {
  it('universal themes force the overlay OFF regardless of the manual preference', () => {
    expect(resolveCrtOff(getTheme('dark'), false)).toBe(true)
    expect(resolveCrtOff(getTheme('light'), true)).toBe(true)
  })

  it('CRT themes honor the manual CRT preference', () => {
    expect(resolveCrtOff(getTheme('terrabyte'), false)).toBe(false)
    expect(resolveCrtOff(getTheme('terrabyte'), true)).toBe(true)
    expect(resolveCrtOff(getTheme('synthwave'), true)).toBe(true)
  })
})
