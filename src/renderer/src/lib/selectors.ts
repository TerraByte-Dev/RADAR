import type { ProjectRecord } from '@shared/radar'
import { dayKey, daysFromToday, formatDayHeading, parseDateLocal } from './date'
import type { View } from '../store/useStore'

const DAY_MS = 86_400_000

/** Parse a `YYYY-MM-DD` deadline as a *local* calendar day (avoids UTC off-by-one). */
export const deadlineDate = parseDateLocal

/** Active contacts on the radar — everything except archived projects. */
export function projectsOnRadar(projects: ProjectRecord[]): ProjectRecord[] {
  return projects.filter((p) => p.status !== 'archived')
}

/** A project is "neglected" when untouched longer than `days` (shipped/archived opt out). */
export function isNeglected(p: ProjectRecord, ref: Date = new Date(), days = 30): boolean {
  if (p.status === 'archived' || p.status === 'shipped' || p.ghost) return false
  const last = p.last_session ?? p.created
  if (!last) return false
  return (ref.getTime() - new Date(last).getTime()) / DAY_MS > days
}

/** Days until a project's deadline (real deadlines only; null when none). */
function deadlineDays(p: ProjectRecord, ref: Date): number | null {
  return p.deadline ? daysFromToday(p.deadline, ref) : null
}

/** Sort: real deadlines first (soonest), then horizon, then name. */
function compareUrgency(a: ProjectRecord, b: ProjectRecord, ref: Date): number {
  const ad = deadlineDays(a, ref)
  const bd = deadlineDays(b, ref)
  if (ad !== bd) {
    if (ad === null) return 1
    if (bd === null) return -1
    return ad - bd
  }
  if (a.priority !== b.priority) return a.priority - b.priority
  return (a.name ?? '').localeCompare(b.name ?? '')
}

/** The projects shown for a list view, filtered + sorted. */
export function projectsForView(
  projects: ProjectRecord[],
  view: View,
  ref: Date = new Date()
): ProjectRecord[] {
  const live = projects.filter((p) => p.status !== 'archived' && !p.ghost)
  switch (view.kind) {
    case 'today': {
      // "Due soon": a real deadline within a week (incl. overdue) or a today/week horizon.
      const soon = live.filter((p) => {
        const d = deadlineDays(p, ref)
        if (d !== null) return d <= 7
        return p.horizon === 'today' || p.horizon === 'week'
      })
      return soon.sort((a, b) => compareUrgency(a, b, ref))
    }
    case 'neglected':
      return live.filter((p) => isNeglected(p, ref)).sort((a, b) => compareUrgency(a, b, ref))
    case 'inbox':
      return live.filter((p) => p.name === 'Inbox')
    case 'all':
      return [...live].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    default:
      return []
  }
}

/** Index every deadlined project by its local day key (for the calendar grid). */
export function projectsByDeadlineKey(projects: ProjectRecord[]): Map<string, ProjectRecord[]> {
  const map = new Map<string, ProjectRecord[]>()
  for (const p of projects) {
    if (!p.deadline || p.status === 'archived') continue
    const key = dayKey(deadlineDate(p.deadline))
    const bucket = map.get(key)
    if (bucket) bucket.push(p)
    else map.set(key, [p])
  }
  for (const bucket of map.values()) bucket.sort((a, b) => a.priority - b.priority)
  return map
}

/** Projects whose deadline falls on a specific calendar day. */
export function projectsOnDeadlineDay(projects: ProjectRecord[], dayISO: string): ProjectRecord[] {
  return projectsByDeadlineKey(projects).get(dayISO) ?? []
}

export function viewTitle(view: View): string {
  switch (view.kind) {
    case 'radar':
      return 'Radar'
    case 'today':
      return 'Due Soon'
    case 'calendar':
      return 'Calendar'
    case 'logbook':
      return 'Logbook'
    case 'neglected':
      return 'Neglected'
    case 'inbox':
      return 'Inbox'
    case 'all':
      return 'All Projects'
  }
}

/* ── Cross-project session-log feed (the activity timeline, elevated) ── */

export interface SessionEntry {
  date: string
  author: string
  lines: string[]
}

/** Parse a `# Session log` body into dated entries (newest preserved order). */
export function parseSessionLog(text: string | undefined): SessionEntry[] {
  if (!text) return []
  const heads = [...text.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})\s+[—-]\s+(.+?)\s*$/gm)]
  const out: SessionEntry[] = []
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]!
    const start = h.index! + h[0].length
    const end = i + 1 < heads.length ? heads[i + 1]!.index! : text.length
    const lines = text
      .slice(start, end)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim())
    out.push({ date: h[1]!, author: h[2]!, lines })
  }
  return out
}

export interface LogItem {
  projectName: string
  blipPath: string
  entry: SessionEntry
}

export interface LogDay {
  key: string
  heading: string
  items: LogItem[]
}

/** Count session-log entries per local day across all projects — feeds the activity heatmap. */
export function activityCounts(projects: ProjectRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const p of projects) {
    for (const e of parseSessionLog(p.sessionLog)) {
      counts.set(e.date, (counts.get(e.date) ?? 0) + 1)
    }
  }
  return counts
}

/** Every project's session-log entries, newest first, grouped by day. The portfolio timeline. */
export function buildLogbook(projects: ProjectRecord[], ref: Date = new Date()): LogDay[] {
  const items: LogItem[] = []
  for (const p of projects) {
    for (const entry of parseSessionLog(p.sessionLog)) {
      items.push({ projectName: p.name ?? 'Project', blipPath: p.blipPath, entry })
    }
  }
  items.sort((a, b) => b.entry.date.localeCompare(a.entry.date))

  const days: LogDay[] = []
  let current: LogDay | null = null
  for (const item of items) {
    const key = item.entry.date
    if (!current || current.key !== key) {
      current = {
        key,
        heading: formatDayHeading(deadlineDate(item.entry.date).toISOString(), ref),
        items: []
      }
      days.push(current)
    }
    current.items.push(item)
  }
  return days
}
