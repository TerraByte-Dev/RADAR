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

/**
 * The task text with a trailing `(due …)` marker stripped, for clean display.
 * Only a tail chrono actually accepts as a date counts as a marker — a parenthetical
 * like "(due diligence review)" is part of the task text and is left alone.
 */
export function taskText(text: string, ref: Date = new Date()): string {
  return taskDueDate(text, ref) ? text.replace(DUE_RE, '').trim() : text.trim()
}

const pad = (n: number): string => String(n).padStart(2, '0')
const dayOf = (ref: Date): string =>
  `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}-${pad(ref.getDate())}`

/**
 * Parsed `(due …)` phrases. A chrono parse costs ~28 µs and the same immutable task lines get
 * re-parsed constantly — the urgency sort comparator, `taskText`, the detail panel and the radar's
 * per-blip radius all ask the same question of the same string.
 *
 * Keyed by phrase **and reference hour**, not just the day: most phrases ("friday", "2026-07-01")
 * resolve identically all day, but a duration ("in 3 hours") crosses midnight from a late-enough
 * reference, so a day-only key would freeze the wrong answer until tomorrow. The hour is fine
 * enough to keep those honest and still coarse enough to collapse the repeat traffic, which
 * arrives many times per second.
 */
const dueCache = new Map<string, string | null>()
let dueCacheKey = ''

/** Parse a task's `(due …)` marker → local ISO `YYYY-MM-DD`, or null when absent/unparseable. */
export function taskDueDate(text: string, ref: Date = new Date()): string | null {
  const m = DUE_RE.exec(text)
  if (!m) return null
  const key = `${dayOf(ref)}T${ref.getHours()}`
  if (key !== dueCacheKey) {
    dueCache.clear() // the reference moved — what "friday" or "in 3 hours" means moved with it
    dueCacheKey = key
  }
  const phrase = m[1]!.trim()
  const hit = dueCache.get(phrase)
  if (hit !== undefined) return hit
  const d = chrono.parseDate(phrase, ref, { forwardDate: true })
  const iso =
    !d || Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  dueCache.set(phrase, iso)
  return iso
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

/**
 * Rewrite a task line's trailing `(due …)` marker — set a new ISO date, or clear it with null.
 * An unparseable tail is task text, not a marker (see `taskText`), so it survives the rewrite.
 */
export function setTaskDue(text: string, iso: string | null): string {
  const base = taskText(text)
  return iso ? `${base} (due ${iso})` : base
}
