import { describe, expect, it } from 'vitest'
import type { ProjectRecord } from '@shared/radar'
import {
  categoryColor,
  currentDayBucket,
  daysUntilDeadline,
  deadlineForFrac,
  isOverdueProject,
  prioSize,
  projectRadiusFrac,
  projectRelativeDeadline,
  scheduleForDrop,
  taskRatio
} from './projectRadar'

const REF = new Date('2026-06-03T12:00:00')

function p(over: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    path: '/x',
    blipPath: '/x/BLIP.md',
    horizon: 'someday',
    priority: 3,
    category: '',
    status: 'active',
    tasks: [],
    unknown: {},
    ...over
  }
}

describe('daysUntilDeadline', () => {
  it('uses a hard deadline as whole days from today', () => {
    expect(daysUntilDeadline(p({ deadline: '2026-06-10' }), REF)).toBe(7)
    expect(daysUntilDeadline(p({ deadline: '2026-06-03' }), REF)).toBe(0)
    expect(daysUntilDeadline(p({ deadline: '2026-06-01' }), REF)).toBe(-2)
  })

  it('falls back to the horizon band with no deadline', () => {
    expect(daysUntilDeadline(p({ horizon: 'today' }), REF)).toBe(0)
    expect(daysUntilDeadline(p({ horizon: 'week' }), REF)).toBe(7)
    expect(daysUntilDeadline(p({ horizon: 'someday' }), REF)).toBeNull()
  })
})

describe('projectRadiusFrac', () => {
  it('is monotonic: sooner deadline sits closer to center', () => {
    const soon = projectRadiusFrac(p({ deadline: '2026-06-04' }), REF)
    const mid = projectRadiusFrac(p({ deadline: '2026-07-03' }), REF)
    const someday = projectRadiusFrac(p({ horizon: 'someday' }), REF)
    expect(soon).toBeLessThan(mid)
    expect(mid).toBeLessThan(someday)
  })
})

describe('deadlineForFrac', () => {
  it('clears to null at the someday rim and returns a monotonic YYYY-MM-DD near center', () => {
    expect(deadlineForFrac(0.97)).toBeNull()
    const near = deadlineForFrac(0.05)
    expect(near).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(deadlineForFrac(0.4)! >= near!).toBe(true) // larger radius → later (or equal) date
  })
})

describe('scheduleForDrop', () => {
  it('a someday-band drop clears the deadline and pins horizon someday (stays at the rim)', () => {
    expect(scheduleForDrop(0.97)).toEqual({ deadline: null, horizon: 'someday' })
    expect(scheduleForDrop(0.95)).toEqual({ deadline: null, horizon: 'someday' })
  })

  it('a nearer drop sets an exact deadline and leaves horizon untouched', () => {
    const s = scheduleForDrop(0.4)
    expect(s.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(s.horizon).toBeUndefined()
  })
})

describe('currentDayBucket', () => {
  it('round-trips the radius back to the day bucket (null for someday)', () => {
    expect(currentDayBucket(p({ horizon: 'someday' }), REF)).toBeNull()
    expect(currentDayBucket(p({ deadline: '2026-06-10' }), REF)).toBe(7) // REF = 2026-06-03
    expect(currentDayBucket(p({ deadline: '2026-06-03' }), REF)).toBe(0)
  })
})

describe('isOverdueProject', () => {
  it('is true only for a real past deadline', () => {
    expect(isOverdueProject(p({ deadline: '2026-06-01' }), REF)).toBe(true)
    expect(isOverdueProject(p({ deadline: '2026-06-10' }), REF)).toBe(false)
    expect(isOverdueProject(p({ horizon: 'today' }), REF)).toBe(false) // fuzzy horizon never "overdue"
  })
})

describe('taskRatio + prioSize + labels + color', () => {
  it('computes the done ratio', () => {
    expect(taskRatio(p())).toBe(0)
    expect(
      taskRatio(
        p({
          tasks: [
            { text: 'a', done: true },
            { text: 'b', done: false }
          ]
        })
      )
    ).toBe(0.5)
  })

  it('sizes blips by priority (P1 largest)', () => {
    expect(prioSize(1)).toBeGreaterThan(prioSize(5))
    expect(prioSize(99)).toBe(prioSize(5)) // clamped
  })

  it('labels deadlines and horizons', () => {
    expect(projectRelativeDeadline(p({ deadline: '2026-06-03' }), REF)).toBe('due today')
    expect(projectRelativeDeadline(p({ deadline: '2026-06-01' }), REF)).toBe('2d overdue')
    expect(projectRelativeDeadline(p({ horizon: 'week' }), REF)).toBe('this week')
  })

  it('gives curated categories a stable color and is deterministic', () => {
    expect(categoryColor('Product')).toBe('#a78bfa')
    expect(categoryColor('Whatever')).toBe(categoryColor('Whatever'))
  })
})
