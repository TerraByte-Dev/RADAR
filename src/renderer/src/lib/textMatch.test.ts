import { describe, it, expect } from 'vitest'
import { matchText } from './textMatch'

describe('matchText', () => {
  it('matches when every term is a substring (case-insensitive)', () => {
    expect(matchText('Appearance theme color CRT', 'theme')).toBe(true)
    expect(matchText('Appearance theme color CRT', 'THEME color')).toBe(true)
    expect(matchText('Scanline overlay glow', 'scan glow')).toBe(true)
  })

  it('requires ALL terms (AND), not any', () => {
    expect(matchText('Appearance theme color', 'theme missing')).toBe(false)
  })

  it('an empty / whitespace query matches everything', () => {
    expect(matchText('anything', '')).toBe(true)
    expect(matchText('anything', '   ')).toBe(true)
  })

  it('misses when no term is present', () => {
    expect(matchText('Workspace roots dismissed', 'theme')).toBe(false)
  })
})
