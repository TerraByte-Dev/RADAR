import { describe, expect, it } from 'vitest'
import { fuzzy } from './fuzzy'

describe('fuzzy', () => {
  it('ranks a prefix over a word start over a substring over scattered letters, ignoring case', () => {
    const s = ['Open studio', 'Tidewatch open', 'Reopen', 'Old portfolio, one pen'].map((t) => fuzzy(t, 'OPEN'))
    expect(s[0]).toBe(1)
    expect(s[1]).toBe(0.9)
    expect(s[2]).toBe(0.8)
    expect(s[3]).toBeGreaterThan(0)
    expect(s[3]).toBeLessThan(0.8)
  })

  it('is 0 when the letters are not there in order, and 1 for an empty query', () => {
    expect(fuzzy('Scope', 'xs')).toBe(0)
    expect(fuzzy('Scope', 'eps')).toBe(0)
    expect(fuzzy('Scope', '  ')).toBe(1)
  })

  it('fewer gaps rank higher', () => {
    expect(fuzzy('Trail maps', 'tmp')).toBeLessThan(fuzzy('Trail maps', 'tmap'))
  })
})
