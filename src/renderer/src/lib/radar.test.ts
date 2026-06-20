import { describe, expect, it } from 'vitest'
import {
  angleFromPoint,
  type BlipLayoutInput,
  daysFromFrac,
  hash01,
  layoutBlipAngles,
  radiusFracForDays,
  R_SOMEDAY,
  sectorBase
} from './radar'

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

describe('blip helpers', () => {
  it('hash01 is deterministic and bounded to [0, 1)', () => {
    expect(hash01('x')).toBe(hash01('x'))
    expect(hash01('x')).not.toBe(hash01('y'))
    expect(hash01('x')).toBeGreaterThanOrEqual(0)
    expect(hash01('x')).toBeLessThan(1)
  })

  it('sectorBase spreads sectors around the dial', () => {
    expect(sectorBase(0, 4)).toBe(18)
    expect(sectorBase(2, 4)).toBe(198)
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

  it('maps a dead-center delta to 0, not the atan2(0,-0)=180 artifact', () => {
    expect(angleFromPoint(0, 0)).toBe(0)
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

  it('fans auto blips away from a pinned obstacle in the same wedge + day', () => {
    const delta = (x: number, y: number): number => {
      const d = Math.abs(((x % 360) + 360) % 360 - (((y % 360) + 360) % 360))
      return d > 180 ? 360 - d : d
    }
    const m = layoutBlipAngles(
      [input({ id: 'pin', override: 90 }), input({ id: 'a' }), input({ id: 'b' })],
      OPTS
    )
    expect(m.get('pin')).toBe(90) // obstacle stays put
    const a = m.get('a')!
    const b = m.get('b')!
    expect(a).not.toBe(b)
    // Neither auto blip lands on (or hard against) the pinned blip's angle.
    expect(delta(a, 90)).toBeGreaterThan(10)
    expect(delta(b, 90)).toBeGreaterThan(10)
  })

  it('keeps a lone blip inside its wedge even when wedges are narrow', () => {
    const narrow = { R: 300, wedgeSpacing: 15 } // ~24 sectors → 15° wedges, 7.5° half-wedge
    const a = layoutBlipAngles([input({ id: 'solo', base: 30 })], narrow).get('solo')!
    // Clamped to the fan half-span (< the 7.5° half-wedge), not the full ±8° jitter → no bleed.
    expect(Math.abs(a - 30)).toBeLessThanOrEqual((15 * 0.72) / 2 + 1e-9)
  })
})
