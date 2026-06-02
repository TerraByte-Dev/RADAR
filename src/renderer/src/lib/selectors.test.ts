import { describe, expect, it } from 'vitest'
import type { Task } from '@shared/types'
import { dayKey } from './date'
import { tasksByDayKey, tasksForView, tasksOnDay, tasksOnRadar } from './selectors'

const REF = new Date(2026, 4, 26, 9, 0, 0) // Tue 26 May 2026, 09:00

const dueToday = (h = 12): Task['due'] => ({
  date: new Date(2026, 4, 26, h, 0, 0).toISOString(),
  hasTime: true
})

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

describe('tasksForView — snooze', () => {
  it('hides a snoozed task from Today but shows it under Snoozed', () => {
    const snoozed = makeTask({
      due: { date: new Date(2026, 4, 26, 12, 0, 0).toISOString(), hasTime: true },
      snoozedUntil: new Date(2026, 4, 27, 9, 0, 0).toISOString() // tomorrow → future
    })

    const today = tasksForView([snoozed], { kind: 'today' }, REF)
    expect(today).toHaveLength(0)

    const snoozedView = tasksForView([snoozed], { kind: 'snoozed' }, REF)
    expect(snoozedView.map((t) => t.id)).toEqual([snoozed.id])
  })

  it('returns a task to Today once its snooze has elapsed', () => {
    const due = makeTask({
      due: { date: new Date(2026, 4, 26, 12, 0, 0).toISOString(), hasTime: true },
      snoozedUntil: new Date(2026, 4, 25, 9, 0, 0).toISOString() // yesterday → past
    })
    const today = tasksForView([due], { kind: 'today' }, REF)
    expect(today.map((t) => t.id)).toEqual([due.id])
  })
})

describe('tasksForView — sorting', () => {
  it('sorts starred tasks ahead of higher-priority unstarred ones', () => {
    const p1 = makeTask({ priority: 'P1' })
    const starred = makeTask({ priority: 'none', starred: true })

    const inbox = tasksForView([p1, starred], { kind: 'inbox' }, REF)
    expect(inbox.map((t) => t.id)).toEqual([starred.id, p1.id])
  })
})

describe('tasksForView — completion stays in place', () => {
  it('keeps a completed task in Today, sunk below active ones', () => {
    const active = makeTask({ due: dueToday(15) })
    const done = makeTask({
      due: dueToday(9),
      completed: true,
      completedAt: new Date(2026, 4, 26, 10, 0, 0).toISOString()
    })

    const list = tasksForView([done, active], { kind: 'today' }, REF)
    expect(list.map((t) => t.id)).toEqual([active.id, done.id])
  })

  it('hides completed tasks when showCompleted is false', () => {
    const active = makeTask({ due: dueToday(15) })
    const done = makeTask({ due: dueToday(9), completed: true })

    const list = tasksForView([done, active], { kind: 'today' }, REF, false)
    expect(list.map((t) => t.id)).toEqual([active.id])
  })

  it('keeps a completed Inbox task (no due) visible in Inbox', () => {
    const done = makeTask({ completed: true })
    const list = tasksForView([done], { kind: 'inbox' }, REF)
    expect(list.map((t) => t.id)).toEqual([done.id])
  })

  it('does not leak a completed no-due task into Today', () => {
    const done = makeTask({ completed: true }) // no due date
    expect(tasksForView([done], { kind: 'today' }, REF)).toHaveLength(0)
  })
})

describe('calendar selectors', () => {
  it('tasksOnDay returns that day, active before completed', () => {
    const active = makeTask({ due: dueToday(15) })
    const done = makeTask({
      due: dueToday(9),
      completed: true,
      completedAt: new Date(2026, 4, 26, 16, 0, 0).toISOString()
    })
    const otherDay = makeTask({
      due: { date: new Date(2026, 4, 27, 9, 0, 0).toISOString(), hasTime: false }
    })

    const res = tasksOnDay([done, active, otherDay], dayKey(new Date(2026, 4, 26, 0, 0, 0)))
    expect(res.map((t) => t.id)).toEqual([active.id, done.id])
  })

  it('tasksByDayKey buckets dated tasks and ignores undated ones', () => {
    const a = makeTask({ due: dueToday(9) })
    const b = makeTask({ due: dueToday(18) })
    const undated = makeTask({})

    const map = tasksByDayKey([a, b, undated])
    expect(map.size).toBe(1)
    expect(map.get(dayKey(new Date(2026, 4, 26, 0, 0, 0)))?.length).toBe(2)
  })

  it('tasksByDayKey sorts active before completed within a day (drives the pill cap)', () => {
    const active = makeTask({ due: dueToday(15) })
    const done = makeTask({
      due: dueToday(9),
      completed: true,
      completedAt: new Date(2026, 4, 26, 16, 0, 0).toISOString()
    })
    const bucket = tasksByDayKey([done, active]).get(dayKey(new Date(2026, 4, 26, 0, 0, 0)))
    expect(bucket?.map((t) => t.id)).toEqual([active.id, done.id])
  })

  it('all-day due dates round-trip through dayKey for bucketing + tasksOnDay', () => {
    const key = dayKey(new Date(2026, 4, 26, 0, 0, 0))
    const t = makeTask({ due: { date: key, hasTime: false } })
    expect(tasksByDayKey([t]).get(key)?.map((x) => x.id)).toEqual([t.id])
    expect(tasksOnDay([t], key).map((x) => x.id)).toEqual([t.id])
  })
})

describe('tasksForView — completion scoping (no pile-up)', () => {
  it('drops a task completed on a previous day from Today', () => {
    const yesterdayDone = makeTask({
      due: dueToday(9),
      completed: true,
      completedAt: new Date(2026, 4, 25, 12, 0, 0).toISOString() // finished yesterday
    })
    expect(tasksForView([yesterdayDone], { kind: 'today' }, REF)).toHaveLength(0)
  })

  it('keeps a completed Inbox task even when finished days ago (finite checklist)', () => {
    const oldDone = makeTask({
      completed: true,
      completedAt: new Date(2026, 3, 1, 9, 0, 0).toISOString()
    })
    expect(tasksForView([oldDone], { kind: 'inbox' }, REF).map((t) => t.id)).toEqual([oldDone.id])
  })
})

describe('tasksForView — snooze / project / completed branches', () => {
  it('keeps a snoozed task in its project but hides it from the action views', () => {
    const t = makeTask({
      projectId: 'pX',
      due: dueToday(12),
      snoozedUntil: new Date(2026, 4, 27, 9, 0, 0).toISOString() // future
    })
    expect(tasksForView([t], { kind: 'project', id: 'pX' }, REF).map((x) => x.id)).toEqual([t.id])
    expect(tasksForView([t], { kind: 'today' }, REF)).toHaveLength(0)
    expect(tasksForView([t], { kind: 'upcoming' }, REF)).toHaveLength(0)
  })

  it('excludes a completed task from the Snoozed view even with a future snooze', () => {
    const t = makeTask({
      completed: true,
      snoozedUntil: new Date(2026, 4, 27, 9, 0, 0).toISOString()
    })
    expect(tasksForView([t], { kind: 'snoozed' }, REF)).toHaveLength(0)
  })

  it('Completed view lists every completed task newest-first, ignoring membership', () => {
    const older = makeTask({
      completed: true,
      completedAt: new Date(2026, 4, 20, 9, 0, 0).toISOString()
    })
    const newer = makeTask({
      completed: true,
      completedAt: new Date(2026, 4, 25, 9, 0, 0).toISOString()
    })
    expect(tasksForView([older, newer], { kind: 'completed' }, REF).map((t) => t.id)).toEqual([
      newer.id,
      older.id
    ])
  })

  it('orders completed tasks lacking completedAt deterministically by manual order', () => {
    const a = makeTask({ completed: true, order: 5 }) // no completedAt
    const b = makeTask({ completed: true, order: 2 })
    expect(tasksForView([a, b], { kind: 'completed' }, REF).map((t) => t.id)).toEqual([b.id, a.id])
  })
})

describe('tasksForView — merged Today (horizon)', () => {
  it('lists future-dated tasks after today/overdue ones', () => {
    const today = makeTask({ due: dueToday(9) })
    const future = makeTask({
      due: { date: new Date(2026, 5, 10, 9, 0, 0).toISOString(), hasTime: false } // ~2 weeks out
    })
    const list = tasksForView([future, today], { kind: 'today' }, REF)
    expect(list.map((t) => t.id)).toEqual([today.id, future.id])
  })

  it('still excludes tasks with no due date from Today', () => {
    expect(tasksForView([makeTask({})], { kind: 'today' }, REF)).toHaveLength(0)
  })
})

describe('tasksOnRadar', () => {
  it('keeps active dated + undated tasks, drops completed and snoozed', () => {
    const dated = makeTask({ due: dueToday(9) })
    const someday = makeTask({}) // no due → someday ring
    const done = makeTask({ completed: true })
    const napping = makeTask({ snoozedUntil: new Date(2026, 4, 27, 9, 0, 0).toISOString() })

    const ids = tasksOnRadar([dated, someday, done, napping], REF).map((t) => t.id)
    expect(ids).toContain(dated.id)
    expect(ids).toContain(someday.id)
    expect(ids).not.toContain(done.id)
    expect(ids).not.toContain(napping.id)
  })
})
