import type { Task } from '@shared/types'
import { daysFromToday } from './date'

/**
 * Radar geometry + blip mapping — the pure math behind the RadarView canvas.
 * Adapted from the TerraByte RADAR project and reworked so a blip's distance
 * from center reflects its *actual* deadline on a continuous, log-compressed
 * time scale: dead-center = now, with readable gridline rings at week / month /
 * quarter and an outer SOMEDAY band for undated tasks. Near-term tasks (where
 * precision matters) get most of the radial space; far-future tasks compress
 * toward the rim.
 */

const DAY_MS = 86_400_000

/** Blip radius (px) by priority — P1 biggest, fades down to no-priority. */
export const PRIO_SIZE: Record<Task['priority'], number> = {
  P1: 7.6,
  P2: 6.4,
  P3: 5.4,
  P4: 4.6,
  none: 4.2
}

/* ── Radial time scale ──────────────────────────────────────────────
   r(d) = R_NOW + R_K·ln(1 + d) for d ≥ 0 days, clamped to R_MAX.
   Overdue (d < 0) eases further toward the bullseye. Undated → R_SOMEDAY. */
const R_NOW = 0.1
const R_K = 0.135
const R_MAX = 0.9
export const R_SOMEDAY = 0.97
/** Dragging a blip past this radius fraction clears its due date (→ someday). */
const SOMEDAY_DROP = 0.93

/**
 * Continuous time-to-due in (fractional) days. Timed dues use the wall clock
 * (so a task due in 2h sits just off-center and drifts in as it approaches);
 * all-day dues use whole calendar days (so "due today" is 0 regardless of the
 * current time). null = no due date.
 */
export function daysUntilDue(task: Task, ref: Date = new Date()): number | null {
  if (!task.due) return null
  if (task.due.hasTime) return (new Date(task.due.date).getTime() - ref.getTime()) / DAY_MS
  return daysFromToday(task.due.date, ref)
}

/** Map days-until-due → radius fraction [0..1]. Monotonic; overdue eases inward. */
export function radiusFracForDays(days: number | null): number {
  if (days === null) return R_SOMEDAY
  if (days <= 0) return Math.max(0.035, R_NOW + days * 0.006)
  return Math.min(R_MAX, R_NOW + R_K * Math.log(1 + days))
}

/** Inverse of radiusFracForDays — a dropped radius → whole days from now (drag-to-reschedule). null = someday. */
export function daysFromFrac(frac: number): number | null {
  if (frac >= SOMEDAY_DROP) return null
  if (frac <= R_NOW) return 0
  return Math.round(Math.expm1((frac - R_NOW) / R_K))
}

/** A task's radius fraction on the radar. */
export function blipRadiusFrac(task: Task, ref: Date = new Date()): number {
  return radiusFracForDays(daysUntilDue(task, ref))
}

/** Labeled gridline rings — the readable time axis. `days: null` is the outer SOMEDAY band. */
export interface TimeRing {
  days: number | null
  label: string
  color: string
}
export const TIME_RINGS: readonly TimeRing[] = [
  { days: 0, label: 'NOW', color: '#FF6B6B' },
  { days: 7, label: '1 WEEK', color: '#FFB000' },
  { days: 30, label: '1 MONTH', color: '#7CFF6B' },
  { days: 90, label: '1 QUARTER', color: '#00E5FF' },
  { days: null, label: 'SOMEDAY', color: '#5fd0c4' }
]

/** Short human relative-due label for the HUD / drag preview / detail panel. */
export function relativeDue(task: Task, ref: Date = new Date()): string {
  const d = daysUntilDue(task, ref)
  if (d === null) return 'someday'
  if (task.due?.hasTime && Math.abs(d) < 1) {
    const h = Math.round(d * 24)
    if (h === 0) return 'now'
    return h > 0 ? `in ${h}h` : `${-h}h overdue`
  }
  const days = Math.round(d)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days}d` : `${-days}d overdue`
}

/** Short label for the live drag preview, given a candidate radius fraction. */
export function dragPreviewLabel(frac: number): string {
  const days = daysFromFrac(frac)
  if (days === null) return 'SOMEDAY'
  if (days <= 0) return 'TODAY'
  if (days === 1) return 'TOMORROW'
  if (days < 14) return `+${days}D`
  if (days < 60) return `+${Math.round(days / 7)}W`
  return `+${Math.round(days / 30)}MO`
}

/** Stable 0..1 hash of a string (FNV-1a), for deterministic jitter/angles. */
export function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

const mod360 = (n: number): number => ((n % 360) + 360) % 360

/**
 * A blip's angle: clustered around its project's sector, jittered stably by id so
 * tasks in the same project (and at the same deadline) fan out without overlapping.
 */
export function blipAngle(task: Task, sectorBase: number): number {
  return mod360(sectorBase + (hash01(task.id) - 0.5) * 42)
}

/** Subtask completion ratio (0..1) — drives the progress arc around a blip. */
export function subtaskRatio(task: Task): number {
  if (!task.subtasks.length) return 0
  return task.subtasks.filter((s) => s.completed).length / task.subtasks.length
}

/** The base angle for the Nth sector of `count` slices. */
export function sectorBase(index: number, count: number): number {
  return (index / Math.max(count, 1)) * 360 + 18
}
