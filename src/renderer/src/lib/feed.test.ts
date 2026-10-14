// Renderer spec 6.7: the Log's feed.
import { describe, expect, it } from 'vitest'
import type { LogEntry, ProjectRecord } from '@shared/model'
import { feed, feedDays, feedMatches } from './feed'

const entry = (date: string | null, time: string | null, author: string, ...bullets: string[]): LogEntry => ({
  heading: date ? `${date}${time ? ` ${time}` : ''} — ${author}` : 'Before the format',
  date,
  time,
  author,
  lines: bullets.map((b) => `- ${b}`),
  bullets
})
const rec = (id: string, log: LogEntry[]): ProjectRecord => ({ id, dir: `/p/${id}`, doc: { name: id, log } }) as unknown as ProjectRecord
const keys = (xs: { key: string }[]): string[] => xs.map((x) => x.key)

describe('feed', () => {
  const a = rec('a', [entry('2026-10-13', '14:20', 'Sam + Claude', 'one'), entry('2026-10-13', '09:12', 'Sam + Claude', 'two'), entry(null, null, '', 'old')])
  const b = rec('b', [entry('2026-10-13', '10:00', 'Sam', 'three'), entry('2026-10-11', null, 'Sam', 'four'), entry('2026-10-11', '16:48', 'Sam', 'five')])

  it('is every entry of every record, newest first, the undated last', () => {
    expect(keys(feed([a, b]))).toEqual(['a:0', 'b:0', 'a:1', 'b:2', 'b:1', 'a:2'])
  })

  it('groups by day: Today with the full date, then a weekday with the day and month, then Undated', () => {
    const days = feedDays(feed([a, b]), '2026-10-13')
    expect(days.map((d) => [d.head, d.sub, d.entries.length])).toEqual([
      ['Today', 'Tuesday 13 October', 3],
      ['Sunday', '11 October', 2],
      ['Undated', null, 1]
    ])
  })

  it('adds the year to a day in another year', () => {
    const days = feedDays(feed([rec('c', [entry('2025-12-31', null, 'Sam', 'x')])]), '2026-10-13')
    expect([days[0]?.head, days[0]?.sub]).toEqual(['Wednesday', '31 December 2025'])
  })

  it('filters by project name, bullet text or raw heading, ignoring case', () => {
    const all = feed([a, b])
    expect(keys(all.filter((x) => feedMatches(x, 'THREE')))).toEqual(['b:0'])
    expect(keys(all.filter((x) => feedMatches(x, 'b')))).toEqual(['b:0', 'b:2', 'b:1', 'a:2'])
    expect(all.filter((x) => feedMatches(x, '  '))).toHaveLength(6)
  })
})
