import { describe, expect, it } from 'vitest'
import type { Task } from '@shared/types'
import {
  angleFromPoint,
  blipAngle,
  type BlipLayoutInput,
  daysFromFrac,
  daysUntilDue,
  hash01,
  layoutBlipAngles,
  radiusFracForDays,
  relativeDue,
  R_SOMEDAY,
  sectorBase,
  subtaskRatio
} from './radar'

const REF = new Date(2026, 4, 26, 9, 0, 0) // Tue 26 May 2026, 09:00

let seq = 0
function makeTask(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    priority: 'none',
    projectId: null,
    tags: [],
    completed: false,
    createdAt: REF.toISOString(),
    order: seq,
    subtasks: [],
    activity: [],
    starred: false,
    ...overrides
  }
}

const allDay = (y: number, m: number, d: number): Task['due'] => ({
  date: new Date(y, m, d, 0, 0, 0).toISOString(),
  hasTime: false
})
const timed = (y: number, m: number, d: number, h: number, min = 0): Task['due'] => ({
  date: new Date(y, m, d, h, min, 0).toISOString(),
  hasTime: true
})

describe('daysUntilDue', () => {
  it('uses whole calendar days for all-day dues (time-of-day independent)', () => {
    expect(daysUntilDue(makeTask({ due: allDay(2026, 4, 26) }), REF)).toBe(0)
    expect(daysUntilDue(makeTask({ due: allDay(2026, 4, 29) }), REF)).toBe(3)
    expect(daysUntilDue(makeTask({ due: allDay(2026, 4, 24) }), REF)).toBe(-2)
  })

  it('uses fractional clock time for timed dues', () => {
    expect(daysUntilDue(makeTask({ due: timed(2026, 4, 26, 21) }), REF)).toBeCloseTo(0.5, 5) // +12h
    expect(daysUntilDue(makeTask({ due: timed(2026, 4, 26, 3) }), REF)).toBeCloseTo(-0.25, 5) // 6h overdue
  })

  it('returns null for undated tasks', () => {
    expect(daysUntilDue(makeTask({}), REF)).toBeNull()
  })
})

describe('radiusFracForDays — continuous time scale', () => {
  it('is monotonically increasing with the deadline', () => {
    const r = [0, 1, 7, 30, 90, 365].map(radiusFracForDays)
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1])
  })

  it('keeps every radius within the unit disk', () => {
    for (const d of [-100, -1, 0, 5, 50, 5000, null]) {
      const f = radiusFracForDays(d)
      expect(f).toBeGreaterThan(0)
      expect(f).toBeLessThanOrEqual(1)
    }
  })

  it('eases overdue tasks inside the NOW ring and parks undated at the someday band', () => {
    expect(radiusFracForDays(-10)).toBeLessThan(radiusFracForDays(0))
    expect(radiusFracForDays(null)).toBe(R_SOMEDAY)
  })

  it('clamps far-future tasks rather than running off the rim', () => {
    expect(radiusFracForDays(100000)).toBeLessThan(R_SOMEDAY)
    expect(radiusFracForDays(100000)).toBeCloseTo(radiusFracForDays(99999), 2)
  })
})

describe('daysFromFrac — drag-to-reschedule inverse', () => {
  it('round-trips the labeled horizons within rounding', () => {
    for (const d of [3, 7, 30, 90]) {
      expect(daysFromFrac(radiusFracForDays(d))).toBe(d)
    }
  })

  it('maps the center to today and the outer band to someday', () => {
    expect(daysFromFrac(0.05)).toBe(0)
    expect(daysFromFrac(0.96)).toBeNull()
  })
})

describe('relativeDue', () => {
  it('summarizes the deadline in human terms', () => {
    expect(relativeDue(makeTask({}), REF)).toBe('someday')
    expect(relativeDue(makeTask({ due: allDay(2026, 4, 26) }), REF)).toBe('today')
    expect(relativeDue(makeTask({ due: allDay(2026, 4, 27) }), REF)).toBe('tomorrow')
    expect(relativeDue(makeTask({ due: allDay(2026, 4, 31) }), REF)).toBe('in 5d')
    expect(relativeDue(makeTask({ due: allDay(2026, 4, 24) }), REF)).toBe('2d overdue')
    expect(relativeDue(makeTask({ due: timed(2026, 4, 26, 11) }), REF)).toBe('in 2h')
  })
})

describe('blip helpers (unchanged)', () => {
  it('hash01 is deterministic and bounded to [0, 1)', () => {
    expect(hash01('x')).toBe(hash01('x'))
    expect(hash01('x')).not.toBe(hash01('y'))
    expect(hash01('x')).toBeGreaterThanOrEqual(0)
    expect(hash01('x')).toBeLessThan(1)
  })

  it('blipAngle is stable per task and wraps into [0, 360)', () => {
    const t = makeTask()
    expect(blipAngle(t, 90)).toBe(blipAngle(t, 90))
    const a = blipAngle(t, 350)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(360)
  })

  it('blipAngle honors a manual radarAngle override (wrapped), ignoring the sector', () => {
    expect(blipAngle(makeTask({ radarAngle: 123 }), 90)).toBe(123)
    expect(blipAngle(makeTask({ radarAngle: 400 }), 90)).toBe(40)
    expect(blipAngle(makeTask({ radarAngle: -10 }), 90)).toBe(350)
  })

  it('sectorBase spreads sectors around the dial', () => {
    expect(sectorBase(0, 4)).toBe(18)
    expect(sectorBase(2, 4)).toBe(198)
  })

  it('subtaskRatio reports completion fraction', () => {
    expect(subtaskRatio(makeTask())).toBe(0)
    expect(
      subtaskRatio(
        makeTask({
          subtasks: [
            { id: 'a', title: 'x', completed: true },
            { id: 'b', title: 'y', completed: false }
          ]
        })
      )
    ).toBe(0.5)
  })
})

describe('angleFromPoint — drop bearing', () => {
  it('maps the cardinal directions (clockwise from straight up)', () => {
    expect(angleFromPoint(0, -1)).toBeCloseTo(0, 6) // up / north
    expect(angleFromPoint(1, 0)).toBeCloseTo(90, 6) // right / east
    expect(angleFromPoint(0, 1)).toBeCloseTo(180, 6) // down / south
    expect(angleFromPoint(-1, 0)).toBeCloseTo(270, 6) // left / west
  })

  it('inverts the canvas pt() bearing for arbitrary angles', () => {
    for (const b of [12, 47, 198, 350]) {
      const a = (b * Math.PI) / 180
      expect(angleFromPoint(Math.sin(a), -Math.cos(a))).toBeCloseTo(b, 6)
    }
  })
})

describe('layoutBlipAngles — crowd-aware fanning', () => {
  const input = (
    over: Partial<BlipLayoutInput> & Pick<BlipLayoutInput, 'id'>
  ): BlipLayoutInput => ({ frac: 0.1, base: 90, size: 5, override: null, ...over })
  const OPTS = { R: 300, wedgeSpacing: 90 }

  it('returns nothing for no blips, and one in-range angle per blip otherwise', () => {
    expect(layoutBlipAngles([], OPTS).size).toBe(0)
    const m = layoutBlipAngles([input({ id: 'a' }), input({ id: 'b', frac: 0.6 })], OPTS)
    expect(m.size).toBe(2)
    for (const v of m.values()) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(360)
    }
  })

  it('honors manual overrides verbatim (wrapped)', () => {
    const m = layoutBlipAngles(
      [input({ id: 'a', override: 200 }), input({ id: 'b', override: -10 })],
      OPTS
    )
    expect(m.get('a')).toBe(200)
    expect(m.get('b')).toBe(350)
  })

  it('keeps a lone blip within a small wobble of its wedge', () => {
    expect(Math.abs(layoutBlipAngles([input({ id: 'a' })], OPTS).get('a')! - 90)).toBeLessThanOrEqual(8)
  })

  it('fans an overlapping same-wedge cluster apart — distinct, centered, inside the wedge', () => {
    const ids = ['a', 'b', 'c', 'd']
    const m = layoutBlipAngles(ids.map((id) => input({ id })), OPTS)
    const angles = ids.map((id) => m.get(id)!).sort((x, y) => x - y)
    expect(new Set(angles).size).toBe(4)
    const mean = angles.reduce((s, v) => s + v, 0) / angles.length
    expect(mean).toBeCloseTo(90, 4)
    expect(angles[3] - angles[0]).toBeLessThanOrEqual(90 * 0.72 + 1e-6)
  })

  it('does not fan blips that are already far apart radially', () => {
    const m = layoutBlipAngles(
      [input({ id: 'a', frac: 0.1 }), input({ id: 'b', frac: 0.85 })],
      OPTS
    )
    expect(Math.abs(m.get('a')! - 90)).toBeLessThanOrEqual(8)
    expect(Math.abs(m.get('b')! - 90)).toBeLessThanOrEqual(8)
  })

  it('opens a wider arc for clusters nearer the crowded center', () => {
    const wide = { R: 300, wedgeSpacing: 3600 } // huge wedge → fan never capped
    const inner = layoutBlipAngles(
      [input({ id: 'a', frac: 0.05 }), input({ id: 'b', frac: 0.05 })],
      wide
    )
    const outer = layoutBlipAngles(
      [input({ id: 'a', frac: 0.6 }), input({ id: 'b', frac: 0.6 })],
      wide
    )
    expect(Math.abs(inner.get('a')! - inner.get('b')!)).toBeGreaterThan(
      Math.abs(outer.get('a')! - outer.get('b')!)
    )
  })

  it('lets a manual override escape its cluster while siblings still fan', () => {
    const m = layoutBlipAngles(
      [input({ id: 'a' }), input({ id: 'b' }), input({ id: 'c', override: 250 })],
      OPTS
    )
    expect(m.get('c')).toBe(250)
    expect(m.get('a')).not.toBe(m.get('b'))
  })
})
