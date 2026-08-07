import { describe, expect, it, vi } from 'vitest'

// Count real chrono parses so the cache is observable — the wrapper delegates, so behavior is
// identical and every other test in this file is unaffected.
const parses = { n: 0 }
vi.mock('chrono-node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('chrono-node')>()
  return { ...actual, parseDate: (...a: Parameters<typeof actual.parseDate>) => { parses.n++; return actual.parseDate(...a) } }
})
import {
  drivingTask,
  nearestTaskDue,
  setTaskDue,
  taskDueDate,
  taskText,
  taskUrgency,
  urgencyForDue
} from './taskDue'

const REF = new Date('2026-06-04T12:00:00')

describe('taskDueDate', () => {
  it('parses an explicit (due YYYY-MM-DD) marker', () => {
    expect(taskDueDate('Pay rent (due 2026-07-01)', REF)).toBe('2026-07-01')
    expect(taskDueDate('Review (due 2026-05-01)', REF)).toBe('2026-05-01')
  })

  it('parses a natural (due …) phrase forward', () => {
    const d = taskDueDate('Ship it (due friday)', REF)
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(d! >= '2026-06-04').toBe(true) // forward-dated
  })

  it('returns null with no marker or an unparseable phrase', () => {
    expect(taskDueDate('Just a task', REF)).toBeNull()
    expect(taskDueDate('Build (due somewhen-ish)', REF)).toBeNull()
  })
})

describe('taskText', () => {
  it('strips a trailing due marker for display', () => {
    expect(taskText('Pay rent (due 2026-07-01)')).toBe('Pay rent')
    expect(taskText('No marker here')).toBe('No marker here')
  })

  it('leaves a "(due …)" tail chrono rejects alone — task text, not a marker', () => {
    expect(taskText('Build (due somewhen-ish)')).toBe('Build (due somewhen-ish)')
    expect(taskText('Call Bob (due diligence review)')).toBe('Call Bob (due diligence review)')
  })
})

describe('urgency', () => {
  it('buckets relative to today', () => {
    expect(urgencyForDue('2026-05-01', REF)).toBe('overdue')
    expect(urgencyForDue('2026-06-05', REF)).toBe('soon') // tomorrow
    expect(urgencyForDue('2026-09-01', REF)).toBe('later')
    expect(urgencyForDue(null, REF)).toBe('later')
  })

  it('derives urgency straight from a task line', () => {
    expect(taskUrgency('x (due 2026-05-01)', REF)).toBe('overdue')
    expect(taskUrgency('x', REF)).toBeNull()
  })
})

describe('nearestTaskDue + drivingTask', () => {
  const tasks = [
    { text: 'no due', done: false },
    { text: 'far (due 2026-09-01)', done: false },
    { text: 'soon (due 2026-06-06)', done: false },
    { text: 'sooner but done (due 2026-06-05)', done: true }
  ]

  it('returns the soonest INCOMPLETE task due', () => {
    expect(nearestTaskDue(tasks, REF)).toBe('2026-06-06') // the done 06-05 is ignored
    expect(nearestTaskDue([{ text: 'plain', done: false }], REF)).toBeNull()
  })

  it('drivingTask points at the index of the soonest open dated task', () => {
    expect(drivingTask(tasks, REF)).toEqual({ index: 2, due: '2026-06-06' })
    expect(drivingTask([{ text: 'plain', done: false }], REF)).toBeNull()
  })
})

describe('setTaskDue', () => {
  it('sets, replaces, and clears a (due …) marker', () => {
    expect(setTaskDue('Pay rent', '2026-07-01')).toBe('Pay rent (due 2026-07-01)')
    expect(setTaskDue('Pay rent (due 2026-06-01)', '2026-07-01')).toBe('Pay rent (due 2026-07-01)')
    expect(setTaskDue('Pay rent (due 2026-06-01)', null)).toBe('Pay rent')
  })

  it('never destroys an unparseable "(due …)" tail — the marker lives alongside it', () => {
    expect(setTaskDue('Call Bob (due diligence review)', '2026-07-01')).toBe(
      'Call Bob (due diligence review) (due 2026-07-01)'
    )
    expect(setTaskDue('Call Bob (due diligence review)', null)).toBe('Call Bob (due diligence review)')
    // …and clearing the real marker later leaves the original text intact
    expect(setTaskDue('Call Bob (due diligence review) (due 2026-07-01)', null)).toBe(
      'Call Bob (due diligence review)'
    )
  })
})

describe('taskDueDate — the chrono parse is cached per (reference hour, phrase)', () => {
  it('parses a repeated phrase once, and still answers correctly', () => {
    const ref = new Date('2026-08-07T12:00:00')
    taskDueDate('Ship the build (due next tuesday)', ref) // priming parse (also resets the table)
    const before = parses.n
    const again = taskDueDate('Write the notes (due next tuesday)', ref)
    expect(parses.n).toBe(before) // served from the cache
    expect(again).toBe(taskDueDate('Ship the build (due next tuesday)', ref))
  })

  it('caches the null for an unparseable tail instead of re-parsing it', () => {
    const ref = new Date('2026-08-07T13:00:00')
    expect(taskDueDate('Call Bob (due diligence review)', ref)).toBeNull()
    const before = parses.n
    expect(taskDueDate('Call Ann (due diligence review)', ref)).toBeNull()
    expect(parses.n).toBe(before)
  })

  it('re-resolves a relative phrase when the reference day moves', () => {
    // A stale cache would hand back the first Monday for both.
    expect(taskDueDate('Ship it (due monday)', new Date('2026-08-07T12:00:00'))).toBe('2026-08-10')
    expect(taskDueDate('Ship it (due monday)', new Date('2026-08-14T12:00:00'))).toBe('2026-08-17')
  })

  it('re-resolves when only the hour moves — a duration can cross midnight', () => {
    // 09:00 + 3h is still the 7th; 23:00 + 3h is the 8th. A day-only key would freeze the first.
    expect(taskDueDate('Deploy (due in 3 hours)', new Date('2026-08-07T09:00:00'))).toBe('2026-08-07')
    expect(taskDueDate('Deploy (due in 3 hours)', new Date('2026-08-07T23:00:00'))).toBe('2026-08-08')
  })
})
