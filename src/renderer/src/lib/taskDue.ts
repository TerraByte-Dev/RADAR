import * as chrono from 'chrono-node'
import { daysFromToday } from './date'

/**
 * Optional per-task due dates — the "free-form" layer. A task line may carry a
 * trailing `(due …)` marker whose phrase is parsed by chrono ("(due friday)",
 * "(due 2026-07-01)", "(due next tue)"). This is the same marker the Inbox
 * capture flow emits, so it round-trips through the engine untouched.
 *
 * A project keeps ringing the radar by *its own* deadline; per-task dues just
 * tint the fleet's ship-markers by urgency and surface overdue tasks in the
 * NOW expansion. So "due someday AND tomorrow" resolves naturally: the project
 * sits at its horizon, with a bright/red ship for the urgent task inside it.
 */

const DUE_RE = /\(due\s+([^)]+)\)\s*$/i

/** The task text with any trailing `(due …)` marker stripped, for clean display. */
export function taskText(text: string): string {
  return text.replace(DUE_RE, '').trim()
}

/** Parse a task's `(due …)` marker → local ISO `YYYY-MM-DD`, or null when absent/unparseable. */
export function taskDueDate(text: string, ref: Date = new Date()): string | null {
  const m = DUE_RE.exec(text)
  if (!m) return null
  const d = chrono.parseDate(m[1]!.trim(), ref, { forwardDate: true })
  if (!d || Number.isNaN(d.getTime())) return null
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export type Urgency = 'overdue' | 'soon' | 'later'

/** Bucket a due date relative to today: overdue · soon (≤2d) · later. */
export function urgencyForDue(iso: string | null, ref: Date = new Date()): Urgency {
  const d = daysFromToday(iso ?? undefined, ref)
  if (d === null) return 'later'
  if (d < 0) return 'overdue'
  if (d <= 2) return 'soon'
  return 'later'
}

/** Convenience: a task line's urgency straight from its text (null when it has no due). */
export function taskUrgency(text: string, ref: Date = new Date()): Urgency | null {
  const due = taskDueDate(text, ref)
  return due ? urgencyForDue(due, ref) : null
}
