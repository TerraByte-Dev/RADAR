import { describe, expect, it } from 'vitest'
import { nextProjectColor, PROJECT_COLORS } from './palette'

describe('PROJECT_COLORS', () => {
  it('is a healthy palette of unique, valid 6-digit hex colors', () => {
    expect(PROJECT_COLORS.length).toBeGreaterThanOrEqual(16)
    expect(new Set(PROJECT_COLORS).size).toBe(PROJECT_COLORS.length) // no duplicates
    for (const c of PROJECT_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('avoids the reserved accent and overdue colors', () => {
    const reserved = new Set(['#00ff88', '#ff3030'])
    for (const c of PROJECT_COLORS) expect(reserved.has(c.toLowerCase())).toBe(false)
  })
})

describe('nextProjectColor', () => {
  it('returns the first wheel color when nothing is used', () => {
    expect(nextProjectColor([])).toBe(PROJECT_COLORS[0])
  })

  it('hands out distinct colors until the palette is exhausted', () => {
    const used: string[] = []
    for (let i = 0; i < PROJECT_COLORS.length; i++) used.push(nextProjectColor(used))
    expect(new Set(used).size).toBe(PROJECT_COLORS.length) // every project got a unique color
    expect([...used].sort()).toEqual([...PROJECT_COLORS].sort())
  })

  it('reuses the least-crowded hue once the palette wraps (ties → wheel order)', () => {
    // Whole palette used once, plus the first color a second time.
    const used = [...PROJECT_COLORS, PROJECT_COLORS[0]]
    expect(nextProjectColor(used)).toBe(PROJECT_COLORS[1]) // first with the minimum count
  })

  it('ignores colors outside the palette', () => {
    expect(nextProjectColor(['#123456', 'not-a-color', ''])).toBe(PROJECT_COLORS[0])
  })
})
