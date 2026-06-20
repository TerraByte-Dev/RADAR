import { describe, expect, it } from 'vitest'
import { PROJECT_COLORS } from './palette'

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
