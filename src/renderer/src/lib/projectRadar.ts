import type { Horizon, ProjectRecord } from '@shared/radar'
import { daysFromToday } from './date'
import { radiusFracForDays, daysFromFrac, hash01 } from './radar'
import { nearestTaskDue } from './taskDue'
import { PROJECT_COLORS } from './palette'

/**
 * Project → radar mapping. Reuses the continuous, log-compressed time scale from
 * `lib/radar.ts` (shared with the original task radar, still unit-tested there).
 *
 * **Distance is driven by deadlines that live on tasks.** A project's effective
 * deadline is the *soonest* of (a) the nearest incomplete task's `(due …)` — its next
 * milestone — and (b) an optional explicit `deadline` (the task-less "whole thing is
 * due X" / errand case). When neither exists, the fuzzy `horizon` band picks the
 * distance. `priority` (1–5) → size; `category` → color.
 */

const DAY_MS = 86_400_000

/** Day-distance a fuzzy horizon maps to when a project has no dated driver. */
export const HORIZON_DAYS: Record<Horizon, number | null> = { today: 0, week: 7, someday: null }

/** Fractional days to the explicit hard deadline (datetime → live clock, date → whole days). null = none. */
function hardDeadlineFracDays(p: ProjectRecord, ref: Date): number | null {
  if (!p.deadline) return null
  if (p.deadline.includes('T')) return (new Date(p.deadline).getTime() - ref.getTime()) / DAY_MS
  return daysFromToday(p.deadline, ref)
}

/** Whole days to the explicit hard deadline. null = none. */
function hardDeadlineWholeDays(p: ProjectRecord, ref: Date): number | null {
  return p.deadline ? daysFromToday(p.deadline, ref) : null
}

/** Whole days to the nearest incomplete task's `(due …)`. null = no dated open task. */
function taskDeadlineWholeDays(p: ProjectRecord, ref: Date): number | null {
  const iso = nearestTaskDue(p.tasks, ref)
  return iso ? daysFromToday(iso, ref) : null
}

/** The smaller of two possibly-absent day-distances (null = absent). */
function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

/**
 * Whole days to the soonest **dated** driver — the nearest incomplete task due or the
 * explicit hard deadline, whichever is sooner. null when the project has no dated driver
 * at all (no horizon fallback — this is "does it have a real deadline?").
 */
export function datedDeadlineDays(p: ProjectRecord, ref: Date = new Date()): number | null {
  return minNullable(hardDeadlineWholeDays(p, ref), taskDeadlineWholeDays(p, ref))
}

/** Blip diameter (px) by priority 1..5 — P1 biggest. */
const PRIO_SIZE: Record<number, number> = { 1: 7.6, 2: 6.4, 3: 5.4, 4: 4.6, 5: 4.0 }
export function prioSize(priority: number): number {
  return PRIO_SIZE[Math.min(5, Math.max(1, Math.round(priority)))] ?? 5.4
}

/**
 * Continuous time-to-deadline in days for the radius — the soonest of the nearest task
 * due and the hard deadline (live clock for a timed hard deadline), falling back to the
 * horizon band. null = someday.
 */
export function daysUntilDeadline(p: ProjectRecord, ref: Date = new Date()): number | null {
  const eff = minNullable(hardDeadlineFracDays(p, ref), taskDeadlineWholeDays(p, ref))
  return eff ?? HORIZON_DAYS[p.horizon]
}

/** Whole-day bucket — feeds the angular layout so the fan doesn't twitch between frames. */
export function deadlineWholeDays(p: ProjectRecord, ref: Date = new Date()): number | null {
  return datedDeadlineDays(p, ref) ?? HORIZON_DAYS[p.horizon]
}

export function projectRadiusFrac(p: ProjectRecord, ref: Date = new Date()): number {
  return radiusFracForDays(daysUntilDeadline(p, ref))
}

export function projectLayoutFrac(p: ProjectRecord, ref: Date = new Date()): number {
  return radiusFracForDays(deadlineWholeDays(p, ref))
}

/** Drop radius → a deadline ISO date (local YYYY-MM-DD). null = clear (someday). */
export function deadlineForFrac(frac: number): string | null {
  const days = daysFromFrac(frac)
  if (days === null) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Translate a drop radius into the schedule change. A drop in the **someday band** clears the
 * deadline AND pins `horizon: someday` — so the blip actually stays at the rim instead of falling
 * back to a stale horizon band (the old bug where dropping a `today`/`week` project on the rim
 * snapped it back inward). Any nearer drop sets an exact `deadline` (which overrides the horizon).
 */
export function scheduleForDrop(frac: number): { deadline: string | null; horizon?: Horizon } {
  const days = daysFromFrac(frac)
  if (days === null) return { deadline: null, horizon: 'someday' }
  return { deadline: deadlineForFrac(frac) }
}

/** The whole-day bucket a project currently occupies on the radar (for drop change-detection). */
export function currentDayBucket(p: ProjectRecord, ref: Date = new Date()): number | null {
  return daysFromFrac(projectRadiusFrac(p, ref))
}

/**
 * True only when the project's own explicit hard `deadline` is in the past — i.e. the
 * *whole project* is overdue. Late individual tasks are surfaced separately (red ships +
 * the NOW overdue-tasks list), so this stays deadline-only to avoid double-counting.
 */
export function isOverdueProject(p: ProjectRecord, ref: Date = new Date()): boolean {
  const d = hardDeadlineWholeDays(p, ref)
  return d !== null && d < 0
}

/** Task done-ratio (0..1) → the progress arc around the blip. */
export function taskRatio(p: ProjectRecord): number {
  if (!p.tasks.length) return 0
  return p.tasks.filter((t) => t.done).length / p.tasks.length
}

/**
 * Short relative-deadline label for the HUD / list / detail panel — reflects the
 * *effective* deadline (nearest task due or hard deadline), falling back to the
 * fuzzy horizon words when the project has no dated driver.
 */
export function projectRelativeDeadline(p: ProjectRecord, ref: Date = new Date()): string {
  const days = datedDeadlineDays(p, ref)
  if (days === null) {
    return p.horizon === 'today' ? 'today' : p.horizon === 'week' ? 'this week' : 'someday'
  }
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  if (days === -1) return '1d overdue'
  return days > 0 ? `in ${days}d` : `${-days}d overdue`
}

/** Curated colors for common categories; everything else hashes to the wheel palette. */
const CATEGORY_COLORS: Record<string, string> = {
  Client: '#5b9ae0',
  Product: '#a78bfa',
  Admin: '#e0a458',
  Personal: '#5fc88a',
  'Side Hustle': '#d68bd0',
  Ops: '#5fccc4'
}

export function categoryColor(category: string): string {
  if (!category) return '#7bb0e0'
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category]!
  return PROJECT_COLORS[Math.floor(hash01(category) * PROJECT_COLORS.length)] ?? '#7bb0e0'
}
