import type { ProjectRecord } from '@shared/radar'
import { dayKey, formatDayHeading, parseDateLocal } from './date'
import { datedDeadlineDays } from './projectRadar'
import { taskDueDate, taskText } from './taskDue'

import type { View } from '../store/useStore'

const DAY_MS = 86_400_000

/** Parse a `YYYY-MM-DD` deadline as a *local* calendar day (avoids UTC off-by-one). */
export const deadlineDate = parseDateLocal

/** Active contacts on the radar — everything except archived projects. */
export function projectsOnRadar(projects: ProjectRecord[]): ProjectRecord[] {
  return projects.filter((p) => p.status !== 'archived')
}

/** Projects taken off the radar — the archive shelf (archived, plus shipped as a second group). */
export function archivedProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return projects
    .filter((p) => p.status === 'archived' && !p.ghost)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

export function shippedProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return projects
    .filter((p) => p.status === 'shipped' && !p.ghost)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

/**
 * The project's **next action** — simply the head of its task queue. There is no separate
 * "next action" field: the checklist is the plan, in order, so its first unchecked item is
 * by definition what to do next. `undefined` when nothing is queued.
 */
export function nextAction(p: ProjectRecord): string | undefined {
  const t = p.tasks.find((task) => !task.done)
  return t ? taskText(t.text) : undefined
}

/**
 * A project is "neglected" when it's drifted: untouched longer than `days` *and* nobody has
 * scheduled it.
 *
 * The scheduling clause is what makes the center ring clearable. `last_session` only moves
 * when a session is logged, so without it a cold project could never leave the ring from
 * inside the app no matter what you did to it. A dated driver — a task `(due …)` or a hard
 * `deadline`, which is exactly what dragging a blip to a new ring writes — means you *have*
 * dealt with it: it now has a plan and a place on the radar. An overdue driver counts too;
 * that project is already surfaced by the overdue list, and a blip should never be in both.
 * `paused` (like `shipped`/`archived`) is a deliberate "not now", not neglect.
 */
export function isNeglected(p: ProjectRecord, ref: Date = new Date(), days = 30): boolean {
  if (p.status === 'archived' || p.status === 'shipped' || p.status === 'paused' || p.ghost) {
    return false
  }
  if (datedDeadlineDays(p, ref) !== null) return false
  const last = p.last_session ?? p.created
  if (!last) return false
  return (ref.getTime() - new Date(last).getTime()) / DAY_MS > days
}

/** Days until a project's *effective* deadline — nearest task due or hard deadline; null when neither. */
function deadlineDays(p: ProjectRecord, ref: Date): number | null {
  return datedDeadlineDays(p, ref)
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
  ref: Date = new Date(),
  neglectedDays = 30
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
      return live
        .filter((p) => isNeglected(p, ref, neglectedDays))
        .sort((a, b) => compareUrgency(a, b, ref))
    case 'inbox':
      return live.filter((p) => p.name === 'Inbox')
    case 'all':
      return [...live].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    default:
      return []
  }
}

/**
 * A dated thing on the calendar — a **task milestone** (a `(due …)`) or a project's own
 * **hard deadline**. Deadlines live on tasks, so most calendar entries are milestones;
 * a task-less project with an explicit `deadline` contributes a `deadline` entry.
 */
export interface CalendarItem {
  blipPath: string
  projectName: string
  category: string
  priority: number
  kind: 'task' | 'deadline'
  /** The task text (milestone) or the project name (hard deadline). */
  label: string
  /** Index of the source task in `project.tasks` (only for `kind: 'task'`). */
  taskIndex?: number
}

/** Index every milestone + hard deadline by its local day key (for the calendar grid). */
export function calendarItemsByDay(projects: ProjectRecord[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>()
  const push = (key: string, item: CalendarItem): void => {
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }
  for (const p of projects) {
    if (p.status === 'archived' || p.ghost) continue
    const meta = { blipPath: p.blipPath, projectName: p.name ?? 'Project', category: p.category, priority: p.priority }
    if (p.deadline) {
      const d = deadlineDate(p.deadline)
      // A garbage deadline (Invalid Date) would make dayKey → toISOString() throw — skip it.
      if (!Number.isNaN(d.getTime())) {
        push(dayKey(d), { ...meta, kind: 'deadline', label: p.name ?? 'Project' })
      }
    }
    p.tasks.forEach((t, taskIndex) => {
      if (t.done) return
      const due = taskDueDate(t.text)
      if (due) push(dayKey(deadlineDate(due)), { ...meta, kind: 'task', label: taskText(t.text), taskIndex })
    })
  }
  for (const bucket of map.values()) bucket.sort((a, b) => a.priority - b.priority)
  return map
}

/** Milestones + hard deadlines falling on a specific calendar day. */
export function calendarItemsOnDay(projects: ProjectRecord[], dayISO: string): CalendarItem[] {
  return calendarItemsByDay(projects).get(dayISO) ?? []
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
  // Lenient on the author tail: em/en-dash or plain hyphen(s), a missing author, or an empty
  // one (`--author ""` emits "## DATE — ") all still count — entries must never silently
  // vanish from the Logbook/heatmap while `last_session` keeps updating. The tail whitespace
  // is same-line `[ \t]` only, so an author-less heading can't swallow the next `- ` bullet.
  const heads = [...text.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})(?:[ \t]+[—–-]+[ \t]*(.*?))?[ \t]*$/gm)]
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
    out.push({ date: h[1]!, author: h[2]?.trim() || 'unknown', lines })
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
