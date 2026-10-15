// The Log view's feed (renderer spec 6.7): every `doc.log` entry from every visible record, newest
// first by the entry's own date and time, under day headings; entries with no date come last
// under "Undated" with their raw heading.
import type { LogEntry, ProjectRecord } from '@shared/model'

export interface FeedEntry {
  /** `{record id}:{index in its log}`, stable across renders. */
  key: string
  r: ProjectRecord
  e: LogEntry
}

export interface FeedDay {
  /** The ISO date, or `undated`. */
  key: string
  /** `Today`, a weekday, or `Undated`. */
  head: string
  /** The rest of the date: `Tuesday 13 October` under Today, `11 October` under a weekday. */
  sub: string | null
  entries: FeedEntry[]
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Every entry of `records`, newest first; an entry with no time sorts at the start of its day, and ties keep file order. */
export function feed(records: ProjectRecord[]): FeedEntry[] {
  const all = records.flatMap((r) => (r.doc?.log ?? []).map((e, i) => ({ key: `${r.id}:${i}`, r, e })))
  const at = (x: FeedEntry): string => (x.e.date ? `${x.e.date}T${x.e.time ?? '00:00'}` : '')
  // Array.prototype.sort is stable, so equal instants keep the order they were read in
  return all.sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0))
}

/** The entries as the Log draws them: one group per day, then Undated. `today` is the local ISO date. */
export function feedDays(entries: FeedEntry[], today: string): FeedDay[] {
  const days: FeedDay[] = []
  for (const x of entries) {
    const key = x.e.date ?? 'undated'
    let day = days[days.length - 1]
    if (day?.key !== key) {
      day = { key, ...dayHeading(x.e.date, today), entries: [] }
      days.push(day)
    }
    day.entries.push(x)
  }
  return days
}

function dayHeading(date: string | null, today: string): { head: string; sub: string | null } {
  if (!date) return { head: 'Undated', sub: null }
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()] as string
  const dm = `${d} ${MONTHS[m - 1]}${String(y) === today.slice(0, 4) ? '' : ` ${y}`}`
  return date === today ? { head: 'Today', sub: `${weekday} ${dm}` } : { head: weekday, sub: dm }
}

/** Whether an entry matches the log's filter: its project's name, a bullet, or its raw heading. */
export function feedMatches(x: FeedEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [x.r.doc?.name ?? '', x.e.heading, ...x.e.bullets].some((s) => s.toLowerCase().includes(q))
}
