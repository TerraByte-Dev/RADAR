import { describe, expect, it } from 'vitest'
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
})
