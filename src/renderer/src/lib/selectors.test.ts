import { describe, expect, it } from 'vitest'
import type { ProjectRecord } from '@shared/radar'
import { dayKey } from './date'
import {
  activityCounts,
  buildLogbook,
  calendarItemsByDay,
  deadlineDate,
  isNeglected,
  parseSessionLog,
  projectsForView
} from './selectors'

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

describe('isNeglected', () => {
  it('flags projects untouched longer than the threshold', () => {
    expect(isNeglected(p({ last_session: '2026-04-01T00:00:00Z' }), REF)).toBe(true) // > 30d
    expect(isNeglected(p({ last_session: '2026-06-01T00:00:00Z' }), REF)).toBe(false) // 2d
  })
  it('exempts shipped / archived / ghost projects', () => {
    expect(isNeglected(p({ last_session: '2026-01-01T00:00:00Z', status: 'shipped' }), REF)).toBe(false)
    expect(isNeglected(p({ last_session: '2026-01-01T00:00:00Z', status: 'archived' }), REF)).toBe(false)
    expect(isNeglected(p({ last_session: '2026-01-01T00:00:00Z', ghost: true }), REF)).toBe(false)
  })
})

describe('projectsForView', () => {
  const projects = [
    p({ blipPath: 'a', name: 'A', deadline: '2026-06-05' }), // due soon
    p({ blipPath: 'b', name: 'B', deadline: '2026-09-01' }), // far
    p({ blipPath: 'c', name: 'C', horizon: 'today' }), // horizon soon
    p({ blipPath: 'd', name: 'D', horizon: 'someday' }), // not soon
    p({ blipPath: 'e', name: 'E', status: 'archived', deadline: '2026-06-04' }) // archived → excluded
  ]

  it('"today" keeps due-soon deadlines and today/week horizons, excludes archived', () => {
    const ids = projectsForView(projects, { kind: 'today' }, REF).map((x) => x.blipPath)
    expect(ids).toContain('a')
    expect(ids).toContain('c')
    expect(ids).not.toContain('b')
    expect(ids).not.toContain('d')
    expect(ids).not.toContain('e')
  })

  it('"today" includes a project pulled in by a soon TASK due (no project deadline)', () => {
    // someday horizon, no deadline, but an incomplete task due in 3 days → effective deadline is soon.
    const taskDriven = p({ blipPath: 'f', name: 'F', tasks: [{ text: 'ship (due 2026-06-05)', done: false }] })
    const ids = projectsForView([...projects, taskDriven], { kind: 'today' }, REF).map((x) => x.blipPath)
    expect(ids).toContain('f')
  })

  it('"all" lists every non-archived project sorted by name', () => {
    const names = projectsForView(projects, { kind: 'all' }, REF).map((x) => x.name)
    expect(names).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('calendarItemsByDay', () => {
  it('buckets task milestones and hard deadlines by local calendar day', () => {
    const items = calendarItemsByDay([
      p({ blipPath: 'a', name: 'A', deadline: '2026-07-01' }),
      p({ blipPath: 'b', name: 'B', tasks: [{ text: 'ship (due 2026-07-01)', done: false }] })
    ])
    const key = dayKey(deadlineDate('2026-07-01'))
    const onDay = items.get(key) ?? []
    expect(onDay).toHaveLength(2)
    expect(onDay.find((i) => i.kind === 'deadline')?.blipPath).toBe('a')
    const task = onDay.find((i) => i.kind === 'task')
    expect(task).toMatchObject({ blipPath: 'b', label: 'ship', taskIndex: 0 })
  })

  it('ignores done tasks, archived projects, and ghosts', () => {
    const items = calendarItemsByDay([
      p({ blipPath: 'a', tasks: [{ text: 'done one (due 2026-07-01)', done: true }] }),
      p({ blipPath: 'b', status: 'archived', deadline: '2026-07-01' }),
      p({ blipPath: 'c', ghost: true, tasks: [{ text: 'x (due 2026-07-01)', done: false }] })
    ])
    expect(items.size).toBe(0)
  })
})

describe('parseSessionLog + buildLogbook', () => {
  const log = `## 2026-05-20 — Ada
- did one
- did two

## 2026-05-25 — Tate
- did three
`

  it('parses dated entries with their bullets', () => {
    const entries = parseSessionLog(log)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ date: '2026-05-20', author: 'Ada' })
    expect(entries[0].lines).toEqual(['did one', 'did two'])
  })

  it('builds a portfolio feed grouped by day, newest first', () => {
    const days = buildLogbook([p({ name: 'Proj', sessionLog: log })], REF)
    expect(days[0].key).toBe('2026-05-25') // newest first
    expect(days[0].items[0].projectName).toBe('Proj')
    expect(days[1].key).toBe('2026-05-20')
  })

  it('counts session entries per day across projects (heatmap data)', () => {
    const counts = activityCounts([
      p({ blipPath: 'x', sessionLog: log }),
      p({ blipPath: 'y', sessionLog: `## 2026-05-25 — Other\n- more\n` })
    ])
    expect(counts.get('2026-05-20')).toBe(1)
    expect(counts.get('2026-05-25')).toBe(2)
  })
})
