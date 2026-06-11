import { describe, expect, it } from 'vitest'
import type { ProjectRecord } from '@shared/radar'
import {
  categoryColor,
  currentDayBucket,
  datedDeadlineDays,
  daysUntilDeadline,
  deadlineForFrac,
  deadlineWholeDays,
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

describe('effective deadline (deadlines live on tasks)', () => {
  it('a project with no deadline is positioned by its nearest incomplete task due', () => {
    const tasked = p({
      horizon: 'someday',
      tasks: [
        { text: 'later (due 2026-09-01)', done: false },
        { text: 'soon (due 2026-06-06)', done: false }
      ]
    })
    expect(datedDeadlineDays(tasked, REF)).toBe(3) // nearest = 2026-06-06
    expect(daysUntilDeadline(tasked, REF)).toBe(3) // overrides the someday horizon
    expect(deadlineWholeDays(tasked, REF)).toBe(3)
    expect(projectRelativeDeadline(tasked, REF)).toBe('in 3d')
  })

  it('completed tasks do not pull the blip in', () => {
    const done = p({ horizon: 'someday', tasks: [{ text: 'shipped (due 2026-06-04)', done: true }] })
    expect(datedDeadlineDays(done, REF)).toBeNull() // no open dated task
    expect(daysUntilDeadline(done, REF)).toBeNull() // → someday
  })

  it('uses the soonest of the hard deadline and the nearest task due', () => {
    const both = p({ deadline: '2026-06-10', tasks: [{ text: 'milestone (due 2026-06-05)', done: false }] })
    expect(datedDeadlineDays(both, REF)).toBe(2) // task (2026-06-05) sooner than deadline (2026-06-10)
    const hardSooner = p({ deadline: '2026-06-04', tasks: [{ text: 'm (due 2026-06-20)', done: false }] })
    expect(datedDeadlineDays(hardSooner, REF)).toBe(1) // hard deadline wins
  })

  it('an overdue TASK pulls the blip toward center but does not mark the whole project overdue', () => {
    const lateTask = p({ horizon: 'someday', tasks: [{ text: 'oops (due 2026-06-01)', done: false }] })
    expect(daysUntilDeadline(lateTask, REF)).toBe(-2) // sits in the bullseye
    expect(isOverdueProject(lateTask, REF)).toBe(false) // reserved for the project's own hard deadline
    expect(isOverdueProject(p({ deadline: '2026-06-01' }), REF)).toBe(true)
  })
})

describe('garbage deadline guards (hand-edited/hostile BLIP.md)', () => {
  it('treats an unparseable deadline as "no dated driver" — never NaN', () => {
    const bad = p({ deadline: 'tomorrow', horizon: 'week' })
    expect(datedDeadlineDays(bad, REF)).toBeNull()
    expect(daysUntilDeadline(bad, REF)).toBe(7) // falls back to the horizon band
    expect(Number.isFinite(projectRadiusFrac(bad, REF))).toBe(true)
  })

  it('a garbage "timed" deadline (contains a T) parks at the rim instead of vanishing', () => {
    const bad = p({ deadline: 'TBD' }) // includes('T') → live-clock branch → NaN math pre-guard
    expect(daysUntilDeadline(bad, REF)).toBeNull() // → its someday horizon
    expect(projectRadiusFrac(bad, REF)).toBeGreaterThan(0.9) // someday band, still visible
    expect(isOverdueProject(bad, REF)).toBe(false)
  })

  it('never renders a "NaNd overdue" label', () => {
    expect(projectRelativeDeadline(p({ deadline: 'asap' }), REF)).toBe('someday')
    expect(projectRelativeDeadline(p({ deadline: 'asap', horizon: 'today' }), REF)).toBe('today')
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
