import * as chrono from 'chrono-node'
import { daysFromToday } from './date'

/**
 * Per-task due dates — where deadlines actually live. A task line may carry a
 * trailing `(due …)` marker whose phrase is parsed by chrono ("(due friday)",
 * "(due 2026-07-01)", "(due next tue)"). This is the same marker the Inbox
 * capture flow emits, so it round-trips through the engine untouched.
 *
 * **Deadlines belong to tasks (milestones), not projects.** A project's distance
 * on the radar is driven by the soonest of its incomplete tasks' `(due …)` dates
 * (see `effective/datedDeadlineDays` in `projectRadar`); an explicit project-level
 * `deadline` is just the task-less "this whole thing is due X" / errand case. The
 * per-task dues also tint the fleet's ship-markers by urgency and surface overdue
 * tasks in the NOW expansion.
 */

const DUE_RE = /\(due\s+([^)]+)\)\s*$/i

/** Minimal shape of a task line for due aggregation (matches `BlipTask`). */
type DuedTask = { text: string; done: boolean }

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

/**
 * The soonest `(due …)` among a project's **incomplete** tasks — its next milestone,
 * the date that drives the whole blip's radar distance. Returns a local ISO
 * `YYYY-MM-DD`, or null when no open task is dated. (ISO dates compare lexically.)
 */
export function nearestTaskDue(tasks: readonly DuedTask[], ref: Date = new Date()): string | null {
  let best: string | null = null
  for (const t of tasks) {
    if (t.done) continue
    const due = taskDueDate(t.text, ref)
    if (due && (best === null || due < best)) best = due
  }
  return best
}

/**
 * The **driving task** — the incomplete task whose `(due …)` is soonest (the one
 * positioning the blip). Returns its index + due, or null when no open task is dated.
 * Used so dragging a fleet reschedules the milestone that's actually placing it.
 */
export function drivingTask(
  tasks: readonly DuedTask[],
  ref: Date = new Date()
): { index: number; due: string } | null {
  let best: { index: number; due: string } | null = null
  tasks.forEach((t, index) => {
    if (t.done) return
    const due = taskDueDate(t.text, ref)
    if (due && (best === null || due < best.due)) best = { index, due }
  })
  return best
}

/** Rewrite a task line's trailing `(due …)` marker — set a new ISO date, or clear it with null. */
export function setTaskDue(text: string, iso: string | null): string {
  const base = taskText(text)
  return iso ? `${base} (due ${iso})` : base
}
