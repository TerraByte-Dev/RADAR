import { describe, expect, it } from 'vitest'
import { addMonths, buildMonthGrid, dayKey, monthLabel, sameDay } from './date'

describe('buildMonthGrid', () => {
  const ref = new Date(2026, 4, 15) // Fri 15 May 2026

  it('produces a 42-cell grid that starts on a Sunday', () => {
    const grid = buildMonthGrid({ year: 2026, month: 4 }, ref)
    expect(grid).toHaveLength(42)
    expect(new Date(grid[0].iso).getDay()).toBe(0)
  })

  it('flags in-month days and today', () => {
    const grid = buildMonthGrid({ year: 2026, month: 4 }, ref)
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31) // May has 31 days
    const today = grid.find((c) => c.isToday)
    expect(today?.day).toBe(15)
    expect(today?.inMonth).toBe(true)
  })

  it('marks weekends (Sun/Sat)', () => {
    const grid = buildMonthGrid({ year: 2026, month: 4 }, ref)
    expect(grid[0].isWeekend).toBe(true) // Sunday
    expect(grid[1].isWeekend).toBe(false) // Monday
    expect(grid[6].isWeekend).toBe(true) // Saturday
  })

  it('stays a stable 42-cell grid across leap/non-leap Feb and DST months', () => {
    // Non-leap Feb (28) and leap Feb (29).
    expect(buildMonthGrid({ year: 2026, month: 1 }).filter((c) => c.inMonth)).toHaveLength(28)
    expect(buildMonthGrid({ year: 2024, month: 1 }).filter((c) => c.inMonth)).toHaveLength(29)

    // March (US spring-forward) and November (fall-back): 42 unique day keys, correct in-month count.
    const mar = buildMonthGrid({ year: 2026, month: 2 })
    expect(mar.filter((c) => c.inMonth)).toHaveLength(31)
    expect(new Set(mar.map((c) => c.iso)).size).toBe(42)

    const nov = buildMonthGrid({ year: 2026, month: 10 })
    expect(nov.filter((c) => c.inMonth)).toHaveLength(30)
    expect(new Set(nov.map((c) => c.iso)).size).toBe(42)
  })
})

describe('month math', () => {
  it('rolls the year across December/January boundaries', () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })

  it('labels a month with its year', () => {
    expect(monthLabel({ year: 2026, month: 4 })).toMatch(/2026/)
  })

  it('handles multi-year deltas and a zero delta', () => {
    expect(addMonths({ year: 2026, month: 11 }, 13)).toEqual({ year: 2028, month: 0 })
    expect(addMonths({ year: 2026, month: 0 }, -13)).toEqual({ year: 2024, month: 11 })
    expect(addMonths({ year: 2026, month: 4 }, 0)).toEqual({ year: 2026, month: 4 })
  })
})

describe('sameDay / dayKey', () => {
  it('treats any times on the same calendar day as equal', () => {
    expect(sameDay(new Date(2026, 4, 26, 1, 0, 0), new Date(2026, 4, 26, 23, 0, 0))).toBe(true)
    expect(sameDay(new Date(2026, 4, 26), new Date(2026, 4, 27))).toBe(false)
  })

  it('normalizes dayKey to local midnight', () => {
    const k = dayKey(new Date(2026, 4, 26, 15, 30, 0))
    expect(new Date(k).getHours()).toBe(0)
  })
})
