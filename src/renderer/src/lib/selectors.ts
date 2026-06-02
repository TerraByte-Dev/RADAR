import type { ActivityEntry, Task } from '@shared/types'
import { dayKey, daysFromToday, formatDayHeading, isFuture, isOverdue, isToday, sameDay } from './date'
import type { View } from '../store/useStore'

const PRIORITY_RANK: Record<Task['priority'], number> = {
  P1: 0,
  P2: 1,
  P3: 2,
  P4: 3,
  none: 4
}

/** A task is snoozed (hidden from action views) while its snooze time is in the future. */
export function isSnoozed(task: Task, ref: Date = new Date()): boolean {
  return isFuture(task.snoozedUntil, ref)
}

/** Sort active tasks: starred first, then priority, then due date, then manual order. */
function compareActive(a: Task, b: Task): number {
  if (a.starred !== b.starred) return a.starred ? -1 : 1
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  }
  const ad = a.due ? new Date(a.due.date).getTime() : Infinity
  const bd = b.due ? new Date(b.due.date).getTime() : Infinity
  if (ad !== bd) return ad - bd
  return a.order - b.order
}

/** Sort completed tasks: most-recently-finished first (stable for un-stamped ones). */
function compareCompleted(a: Task, b: Task): number {
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.order - b.order
}

/** Whether a task belongs in an action view, ignoring completion + snooze. */
function inActionView(task: Task, view: View, ref: Date): boolean {
  switch (view.kind) {
    case 'inbox':
      return task.projectId === null
    case 'today':
      // Today merges the old Today + Upcoming: every dated task. Overdue/today
      // show bright; future ones render faded (the "horizon" tail).
      return !!task.due
    case 'upcoming':
      return !!task.due
    case 'project':
      return task.projectId === view.id
    default:
      return false
  }
}

/** In the merged Today view, future-dated tasks sort below (and render faded). */
function isFutureDated(task: Task, ref: Date): boolean {
  const d = daysFromToday(task.due?.date, ref)
  return d !== null && d > 0
}

/**
 * The tasks shown for a given view, filtered and sorted.
 *
 * Completed tasks stay visible in their list — struck through and sunk to the
 * bottom, checklist-style — rather than vanishing. `showCompleted` collapses
 * them when a list gets noisy (they remain in the Completed view + Logbook).
 */
export function tasksForView(
  tasks: Task[],
  view: View,
  ref: Date = new Date(),
  showCompleted = true
): Task[] {
  switch (view.kind) {
    case 'radar':
    case 'logbook':
    case 'calendar':
      // These views own their own selectors (tasksOnRadar / buildLogbook / tasksByDayKey).
      return []
    case 'completed':
      return tasks.filter((t) => t.completed).sort(compareCompleted)
    case 'snoozed':
      return tasks
        .filter((t) => !t.completed && isSnoozed(t, ref))
        .sort((a, b) => (a.snoozedUntil ?? '').localeCompare(b.snoozedUntil ?? ''))
  }

  // Action views (inbox / today / upcoming / project).
  const members = tasks.filter((t) => inActionView(t, view, ref))
  // Snoozed-but-incomplete tasks hide from the action views (still shown in a
  // project, with an indicator). Completed tasks are never treated as snoozed.
  const keepSnoozed = view.kind === 'project'
  const active = members.filter((t) => !t.completed && (keepSnoozed || !isSnoozed(t, ref)))
  // Today keeps overdue/today bright at the top, future tasks faded below.
  if (view.kind === 'today') {
    active.sort(
      (a, b) =>
        Number(isFutureDated(a, ref)) - Number(isFutureDated(b, ref)) || compareActive(a, b)
    )
  } else {
    active.sort(compareActive)
  }
  if (!showCompleted) return active

  // Completed tasks stay struck-through in place (checklist-style). In the
  // date-bounded views (Today/Upcoming) only keep ones finished *today*, so old
  // completed tasks don't pile up forever; Inbox/Project keep the full checklist
  // until the user collapses it. (All completed tasks always remain in the
  // Completed view + Logbook regardless.)
  const dateBounded = view.kind === 'today' || view.kind === 'upcoming'
  const completed = members
    .filter(
      (t) =>
        t.completed &&
        (!dateBounded || (!!t.completedAt && sameDay(new Date(t.completedAt), ref)))
    )
    .sort(compareCompleted)
  return [...active, ...completed]
}

/** The active, non-snoozed tasks plotted on the radar (incl. undated → someday). */
export function tasksOnRadar(tasks: Task[], ref: Date = new Date()): Task[] {
  return tasks.filter((t) => !t.completed && !isSnoozed(t, ref))
}

/** Tasks due on a specific local calendar day (active first, completed last). */
export function tasksOnDay(tasks: Task[], dayISO: string): Task[] {
  const target = new Date(dayISO)
  const matching = tasks.filter((t) => t.due && sameDay(new Date(t.due.date), target))
  const active = matching.filter((t) => !t.completed).sort(compareActive)
  const completed = matching.filter((t) => t.completed).sort(compareCompleted)
  return [...active, ...completed]
}

/** Index every dated task by its day key for the calendar grid. */
export function tasksByDayKey(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const t of tasks) {
    if (!t.due) continue
    const key = dayKey(new Date(t.due.date))
    const bucket = map.get(key)
    if (bucket) bucket.push(t)
    else map.set(key, [t])
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return a.completed ? compareCompleted(a, b) : compareActive(a, b)
    })
  }
  return map
}

export function viewTitle(view: View, projectName?: string): string {
  switch (view.kind) {
    case 'radar':
      return 'Radar'
    case 'inbox':
      return 'Inbox'
    case 'today':
      return 'Today'
    case 'upcoming':
      return 'Upcoming'
    case 'snoozed':
      return 'Snoozed'
    case 'completed':
      return 'Completed'
    case 'logbook':
      return 'Logbook'
    case 'calendar':
      return 'Calendar'
    case 'project':
      return projectName ?? 'Project'
  }
}

export interface LogItem {
  taskId: string
  taskTitle: string
  entry: ActivityEntry
}

export interface LogDay {
  /** Stable per-day key (local calendar day). */
  key: string
  heading: string
  items: LogItem[]
}

/**
 * The Logbook: every meaningful activity entry across all tasks, newest first,
 * grouped by day. Skips 'created' (noise) — this is a record of what moved forward.
 */
export function buildLogbook(tasks: Task[], ref: Date = new Date()): LogDay[] {
  const items: LogItem[] = []
  for (const t of tasks) {
    for (const entry of t.activity) {
      if (entry.kind === 'created') continue
      items.push({ taskId: t.id, taskTitle: t.title, entry })
    }
  }
  items.sort((a, b) => b.entry.ts.localeCompare(a.entry.ts))

  const days: LogDay[] = []
  let current: LogDay | null = null
  for (const item of items) {
    const key = new Date(item.entry.ts).toDateString()
    if (!current || current.key !== key) {
      current = { key, heading: formatDayHeading(item.entry.ts, ref), items: [] }
      days.push(current)
    }
    current.items.push(item)
  }
  return days
}
