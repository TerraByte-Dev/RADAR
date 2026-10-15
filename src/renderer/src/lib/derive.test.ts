// Renderer spec 3, 5 and 6.4 (and the digest of 6.3), one test per row, all at a fixed `now`.
import { describe, expect, it } from 'vitest'
import type { Activity, BlipDoc, LogEntry, ProjectRecord, Task } from '@shared/model'
import {
  activityReadAt,
  ageLabel,
  behind,
  branchLabel,
  commitDays,
  days,
  digest,
  displayTitle,
  dueLabel,
  groupOf,
  groups,
  lastWorkedOn,
  listOrder,
  localDate,
  ownerOnly,
  pickOrder,
  pickReason,
  rightStatus,
  sourceGlyph,
  startCost,
  touchedAt,
  touchedThisWeek,
  type BoardData
} from './derive'

// Tuesday 13 October 2026, 14:00 local.
const NOW = new Date(2026, 9, 13, 14, 0).getTime()
const DAY = 86_400_000
const ago = (d: number): string => new Date(NOW - d * DAY).toISOString()
const TODAY = localDate(NOW)

const task = (title: string, extra: Partial<Task> = {}): Task => ({ key: title, title, detail: [], due: null, done: false, doneOn: null, n: 1, ...extra })

function activity(d: number | null, extra: Partial<Activity> = {}): Activity {
  const at = d === null ? null : ago(d)
  return {
    source: 'git',
    lastWorkAt: at,
    lastLogAt: null,
    lastSyncAt: null,
    lastTouchedAt: at,
    unlogged: false,
    drift: { since: null, commits: null, files: null },
    git: null,
    daily: null,
    computedAt: new Date(NOW).toISOString(),
    error: null,
    ...extra
  }
}

interface Spec {
  id: string
  days?: number | null
  status?: BlipDoc['status']
  focus?: boolean
  next?: string | null
  live?: boolean
  state?: ProjectRecord['state']
  hidden?: boolean
  log?: LogEntry[]
  lastLogAt?: string | null
  act?: Activity | null
}

function rec(s: Spec): ProjectRecord {
  const next = s.next === undefined ? task(`step for ${s.id}`) : s.next === null ? null : task(s.next)
  const doc: BlipDoc = {
    schema: 3,
    name: s.id,
    nameSource: 'file',
    now: null,
    status: s.status ?? 'active',
    focus: s.focus ?? false,
    due: null,
    tags: [],
    links: [],
    tasks: { open: next ? [next] : [], done: [] },
    next,
    log: s.log ?? [],
    lastLogAt: s.lastLogAt ?? null,
    problems: [],
    writable: true
  }
  return {
    id: s.id,
    dir: `/p/${s.id}`,
    state: s.state ?? 'ok',
    doc,
    activity: s.act !== undefined ? s.act : activity(s.days === undefined ? 1 : s.days),
    agent: { live: s.live ?? false, sessions: s.live ? 1 : 0, lastSeenAt: null },
    hidden: s.hidden ?? false,
    rev: 'x'
  }
}

const board = (recs: ProjectRecord[], owner: string | null = 'Robin'): BoardData => ({
  projects: Object.fromEntries(recs.map((r) => [r.id, r])),
  owner,
  now: NOW
})
const ids = (rs: ProjectRecord[]): string[] => rs.map((r) => r.id)

describe('section 3', () => {
  it('touchedAt takes activity, else the last log entry, else null', () => {
    expect(touchedAt(rec({ id: 'a', days: 2 }))).toBe(ago(2))
    expect(touchedAt(rec({ id: 'a', act: null, lastLogAt: ago(5) }))).toBe(ago(5))
    expect(touchedAt(rec({ id: 'a', act: null }))).toBeNull()
  })

  it('days is null when never touched, and floored at 0 for a time in the future', () => {
    expect(days(rec({ id: 'a', days: 3 }), NOW)).toBeCloseTo(3)
    expect(days(rec({ id: 'a', act: null }), NOW)).toBeNull()
    expect(days(rec({ id: 'a', days: -1 }), NOW)).toBe(0)
  })

  it('ageLabel reads new, today, days, weeks, months with no space', () => {
    expect(ageLabel(null)).toBe('new')
    expect(ageLabel(0.5)).toBe('today')
    expect(ageLabel(2)).toBe('2d')
    expect(ageLabel(13.4)).toBe('13d')
    expect(ageLabel(21)).toBe('3w')
    expect(ageLabel(83)).toBe('12w')
    expect(ageLabel(120)).toBe('4mo')
    expect(ageLabel(1)).toBe('1d')
    expect(ageLabel(14)).toBe('2w')
    expect(ageLabel(84)).toBe('3mo')
  })

  it('dueLabel shows only a date strictly after today; a passed or today date is null', () => {
    expect(dueLabel(null, '2026-10-13')).toBeNull()
    expect(dueLabel('2026-10-12', '2026-10-13')).toBeNull()
    expect(dueLabel('2026-10-13', '2026-10-13')).toBeNull()
    expect(dueLabel('2026-11-06', '2026-10-13')).toBe('due 6 Nov')
    expect(dueLabel('2027-02-01', '2026-10-13')).toBe('due 1 Feb 2027')
  })

  it('ownerOnly matches the owner prefix case-insensitively, never when the owner is unknown', () => {
    expect(ownerOnly(task('Robin: proofread'), 'Robin')).toBe(true)
    expect(ownerOnly(task('robin: proofread'), 'ROBIN')).toBe(true)
    expect(ownerOnly(task('Robins nest'), 'Robin')).toBe(false)
    expect(ownerOnly(task('Robin: proofread'), null)).toBe(false)
    expect(displayTitle(task('Robin: proofread'), 'Robin')).toBe('proofread')
    expect(displayTitle(task('Robin: proofread'), null)).toBe('Robin: proofread')
  })

  it('startCost: live first, nothing without an owner, then needs you or an agent can start this', () => {
    const t = task('Robin: proofread')
    expect(startCost(rec({ id: 'a', live: true }), t, null)).toBe('an agent is in here now')
    expect(startCost(rec({ id: 'a' }), t, null)).toBeNull()
    expect(startCost(rec({ id: 'a' }), t, 'Robin')).toBe('needs you')
    expect(startCost(rec({ id: 'a' }), task('Build it'), 'Robin')).toBe('an agent can start this')
  })

  it('sourceGlyph and behind read the activity', () => {
    expect(sourceGlyph(rec({ id: 'a' }))).toBe('branch')
    expect(sourceGlyph(rec({ id: 'a', act: activity(1, { source: 'files' }) }))).toBe('page')
    expect(sourceGlyph(rec({ id: 'a', act: activity(null, { source: 'none' }) }))).toBeNull()
    expect(sourceGlyph(rec({ id: 'a', act: null }))).toBeNull()
    expect(behind(rec({ id: 'a', act: activity(1, { unlogged: true }) }))).toBe(true)
    expect(behind(rec({ id: 'a', act: null }))).toBe(false)
  })

  it('branchLabel keeps 20 characters and cuts a longer name in the middle', () => {
    expect(branchLabel('feat/widget-view')).toBe('feat/widget-view')
    expect(branchLabel('a'.repeat(20))).toBe('a'.repeat(20))
    expect(branchLabel('feat/italic-proof-masters')).toBe('feat/itali…f-masters')
    expect(branchLabel('feat/italic-proof-masters')).toHaveLength(20)
  })

  it('touchedThisWeek counts the visible week group only', () => {
    const b = board([rec({ id: 'a', days: 1 }), rec({ id: 'b', days: 20 }), rec({ id: 'c', days: 1, hidden: true }), rec({ id: 'd', days: 1, status: 'paused' })])
    expect(touchedThisWeek(b)).toBe(1)
  })
})

describe('section 5: groupOf', () => {
  it('status overrides activity: paused with commits today is paused, archived is archived', () => {
    expect(groupOf(rec({ id: 'a', days: 0, status: 'paused' }), NOW)).toBe('paused')
    expect(groupOf(rec({ id: 'a', days: 0, status: 'archived' }), NOW)).toBe('archived')
  })

  it('places by days: 7 is this week, 42 is the last six weeks, after that earlier, never touched earlier', () => {
    expect(groupOf(rec({ id: 'a', days: 7 }), NOW)).toBe('week')
    expect(groupOf(rec({ id: 'a', days: 7.01 }), NOW)).toBe('recent')
    expect(groupOf(rec({ id: 'a', days: 42 }), NOW)).toBe('recent')
    expect(groupOf(rec({ id: 'a', days: 43 }), NOW)).toBe('earlier')
    expect(groupOf(rec({ id: 'a', act: null }), NOW)).toBe('earlier')
  })

  it('blocked and a live session do not change the group', () => {
    expect(groupOf(rec({ id: 'a', days: 30, status: 'blocked' }), NOW)).toBe('recent')
    expect(groupOf(rec({ id: 'a', days: 60, live: true }), NOW)).toBe('earlier')
  })

  it('needs-repair and needs-migrate records group from what they have', () => {
    expect(groupOf(rec({ id: 'a', days: 2, state: 'needs-repair' }), NOW)).toBe('week')
    expect(groupOf(rec({ id: 'a', days: 2, state: 'needs-migrate', status: 'paused' }), NOW)).toBe('paused')
  })

  it('groups: group order, empty groups left out, focus first then most recent then name, hidden and missing out', () => {
    const b = board([
      rec({ id: 'old', days: 3 }),
      rec({ id: 'new', days: 1 }),
      rec({ id: 'pin', days: 5, focus: true }),
      rec({ id: 'b-same', days: 2 }),
      rec({ id: 'a-same', days: 2 }),
      rec({ id: 'never', act: null }),
      rec({ id: 'late', days: 50 }),
      rec({ id: 'gone', days: 1, state: 'missing' }),
      rec({ id: 'hid', days: 1, hidden: true })
    ])
    const g = groups(b)
    expect(g.map((x) => x.group)).toEqual(['week', 'earlier'])
    expect(ids(g[0]!.rows)).toEqual(['pin', 'new', 'a-same', 'b-same', 'old'])
    expect(ids(g[1]!.rows)).toEqual(['late', 'never'])
  })
})

describe('section 6.4: pickOrder', () => {
  it('first is the project last worked on, then pins, then the rest of this week', () => {
    const b = board([
      rec({ id: 'last', days: 0.1 }),
      rec({ id: 'pin-old', days: 30, focus: true }),
      rec({ id: 'pin-new', days: 4, focus: true }),
      rec({ id: 'week', days: 2 }),
      rec({ id: 'recent', days: 20 }),
      rec({ id: 'paused', days: 0, status: 'paused' }),
      rec({ id: 'archived', days: 0, status: 'archived' }),
      rec({ id: 'notask', days: 0, next: null }),
      rec({ id: 'repair', days: 0, state: 'needs-repair' }),
      rec({ id: 'v2', days: 0, state: 'needs-migrate' }),
      rec({ id: 'hidden', days: 0, hidden: true })
    ])
    expect(ids(pickOrder(b))).toEqual(['last', 'pin-new', 'pin-old', 'week'])
  })

  it('is empty when nothing is queued anywhere', () => {
    expect(pickOrder(board([rec({ id: 'a', next: null }), rec({ id: 'b', status: 'paused' })]))).toEqual([])
  })

  it('a blocked project can be first but is never dealt by Pick', () => {
    const b = board([rec({ id: 'waiting', days: 0, status: 'blocked' }), rec({ id: 'w2', days: 1, status: 'blocked', focus: true }), rec({ id: 'x', days: 2 })])
    expect(ids(pickOrder(b))).toEqual(['waiting', 'x'])
  })

  it('inside a tier a step an agent can start is dealt before one that needs the owner', () => {
    const recs = [
      rec({ id: 'first', days: 0 }),
      rec({ id: 'pin-you', days: 1, focus: true, next: 'Robin: sign it' }),
      rec({ id: 'pin-agent', days: 3, focus: true }),
      rec({ id: 'week-you', days: 1, next: 'robin: call them' }),
      rec({ id: 'week-agent', days: 6 })
    ]
    expect(ids(pickOrder(board(recs)))).toEqual(['first', 'pin-agent', 'pin-you', 'week-agent', 'week-you'])
    // owner unknown: no tie-break, recency alone
    expect(ids(pickOrder(board(recs, null)))).toEqual(['first', 'pin-you', 'pin-agent', 'week-you', 'week-agent'])
  })

  it('a live session moves nothing, and a name breaks a tie', () => {
    const b = board([rec({ id: 'b', days: 1 }), rec({ id: 'a', days: 1 }), rec({ id: 'old', days: 6, live: true })])
    expect(ids(pickOrder(b))).toEqual(['a', 'b', 'old'])
  })
})

describe('section 6.4: the reason Pick one for me gives', () => {
  const recs = [
    rec({ id: 'first', days: 0 }),
    rec({ id: 'pin-a', days: 1, focus: true }),
    rec({ id: 'pin-b', days: 3, focus: true, next: 'Robin: sign it' }),
    rec({ id: 'week', days: 2 })
  ]
  const order = pickOrder(board(recs))
  const first = order[0]!.doc!.name

  it('names the first pin after the Continue project, then the next pins, then the week', () => {
    expect(pickReason(order, 1, 'Robin')).toBe(`It is your most recent focus pin after ${first}, and an agent can start its next step.`)
    expect(pickReason(order, 2, 'Robin')).toBe('It is your next focus pin, and its next step needs you.')
    expect(pickReason(order, 3, 'Robin')).toBe('No focus pins left. It is the most recent project this week, and an agent can start its next step.')
  })

  it('says nothing about the start cost when the owner is unknown', () => {
    expect(pickReason(order, 3, null)).toBe('No focus pins left. It is the most recent project this week.')
  })
})

describe('section 6.3: digest', () => {
  const entry = (date: string, time: string | null, bullet: string): LogEntry => ({
    heading: `${date}${time ? ` ${time}` : ''} — Robin + claude`,
    date,
    time,
    author: 'Robin + claude',
    lines: [`- ${bullet}`],
    bullets: [bullet]
  })
  const OPENED = new Date(2026, 9, 10, 9, 0).getTime() // Saturday 10 October, 09:00
  const at = (d: number, h: number, m = 0): string => new Date(2026, 9, d, h, m).toISOString()
  const logged = (id: string, d: number, h: number, bullet: string, extra: Partial<Spec> = {}): ProjectRecord =>
    rec({ id, days: 13 - d + 0.1, log: [entry(`2026-10-${String(d).padStart(2, '0')}`, `${String(h).padStart(2, '0')}:00`, bullet)], lastLogAt: at(d, h), ...extra })

  it('nothing before a first visit', () => {
    expect(digest(board([logged('a', 12, 10, 'did a')]), undefined)).toEqual([])
  })

  it('lists projects whose newest entry is after the last visit, newest first, at most four, never Continue', () => {
    const b = board([
      logged('cont', 13, 12, 'continue work', { days: 0 }),
      logged('a', 11, 10, 'did a'),
      logged('b', 13, 9, 'did b'),
      logged('c', 12, 10, 'did c'),
      logged('d', 11, 8, 'did d'),
      logged('e', 10, 10, 'did e'),
      logged('before', 9, 10, 'too old'),
      logged('hid', 13, 13, 'hidden', { hidden: true })
    ])
    const lines = digest(b, OPENED)
    expect(lines.map((l) => l.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(lines.map((l) => l.id)).not.toContain(pickOrder(b)[0]!.id)
    expect(lines[0]).toMatchObject({ name: 'b', text: 'did b', day: 'today' })
    expect(lines[1]).toMatchObject({ day: 'Mon' })
  })

  it('the line is the newest entry\'s first bullet, whatever the file order', () => {
    const r = rec({ id: 'x', days: 1, log: [entry('2026-10-11', '10:00', 'older'), entry('2026-10-12', '10:00', 'newer')], lastLogAt: at(12, 10) })
    const b = board([rec({ id: 'first', days: 0 }), r])
    expect(digest(b, OPENED)).toMatchObject([{ id: 'x', text: 'newer', day: 'Mon' }])
  })
})

describe('activityReadAt', () => {
  it('is the newest computedAt among visible records, null without any', () => {
    const later = new Date(NOW + 60_000).toISOString()
    expect(activityReadAt(board([rec({ id: 'a' }), rec({ id: 'b', act: activity(1, { computedAt: later }) })]))).toBe(Date.parse(later))
    expect(activityReadAt(board([rec({ id: 'a', act: null })]))).toBeNull()
    expect(TODAY).toBe('2026-10-13')
  })
})

describe('lastWorkedOn', () => {
  it('is the most recently touched visible project, whatever it has queued or its status', () => {
    const a = rec({ id: 'A', days: 0.1, next: null })
    const b = rec({ id: 'B', days: 13 })
    expect(pickOrder(board([a, b]))[0]?.id).toBe('B')
    expect(lastWorkedOn(board([a, b]))?.id).toBe('A')
    expect(lastWorkedOn(board([rec({ id: 'P', days: 0.1, status: 'paused' }), b]))?.id).toBe('P')
    expect(lastWorkedOn(board([rec({ id: 'H', days: 0, hidden: true }), b]))?.id).toBe('B')
    expect(lastWorkedOn(board([rec({ id: 'y', days: 2 }), rec({ id: 'x', days: 2 })]))?.id).toBe('x')
  })

  it('is null when nothing visible was ever touched', () => {
    expect(lastWorkedOn(board([rec({ id: 'a', act: null })]))).toBeNull()
    expect(lastWorkedOn(board([]))).toBeNull()
  })
})

describe('rightStatus (section 8)', () => {
  const git = (level: 'ok' | 'warn') => [{ id: 'git', level, message: 'git' }] as NonNullable<Parameters<typeof rightStatus>[0]['setup']>
  it('is the git warning when the git check is not ok, in place of the read time', () => {
    expect(rightStatus({ ...board([rec({ id: 'a' })]), setup: git('warn') })).toBe('git was not found · recency is from file times')
  })
  it('is the read time when git is ok or not checked yet, and null without any activity', () => {
    const at = new Date(NOW)
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    expect(rightStatus({ ...board([rec({ id: 'a' })]), setup: git('ok') })).toBe(`activity read ${hhmm}`)
    expect(rightStatus({ ...board([rec({ id: 'a' })]), setup: null })).toBe(`activity read ${hhmm}`)
    expect(rightStatus({ ...board([rec({ id: 'a', act: null })]), setup: git('ok') })).toBeNull()
  })
})

describe('listOrder and commitDays (section 6.2)', () => {
  it('listOrder is every row J and K move through, in group order, archived left out', () => {
    const b = board([rec({ id: 'old', days: 60 }), rec({ id: 'gone', status: 'archived' }), rec({ id: 'park', status: 'paused' }), rec({ id: 'now', days: 1 }), rec({ id: 'mid', days: 20 })])
    expect(ids(listOrder(b))).toEqual(['now', 'mid', 'old', 'park'])
  })

  it('commitDays counts the days with a commit, 0 without git', () => {
    expect(commitDays(rec({ id: 'a', act: activity(1, { daily: [0, 2, 0, 1, 5] }) }))).toBe(3)
    expect(commitDays(rec({ id: 'b', act: null }))).toBe(0)
  })
})
