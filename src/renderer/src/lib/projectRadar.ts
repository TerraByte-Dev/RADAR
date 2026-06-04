import type { Horizon, ProjectRecord } from '@shared/radar'
import { daysFromToday } from './date'
import { radiusFracForDays, daysFromFrac, hash01 } from './radar'
import { PROJECT_COLORS } from './palette'

/**
 * Project → radar mapping. Reuses the continuous, log-compressed time scale from
 * `lib/radar.ts` (shared with the original task radar, still unit-tested there) and
 * adds the project-grain rules: a hard `deadline` drives exact distance, falling back
 * to the fuzzy `horizon` band; `priority` (1–5) → size; `category` → color.
 */

const DAY_MS = 86_400_000

/** Day-distance a fuzzy horizon maps to when a project has no hard deadline. */
export const HORIZON_DAYS: Record<Horizon, number | null> = { today: 0, week: 7, someday: null }

/** Blip diameter (px) by priority 1..5 — P1 biggest. */
const PRIO_SIZE: Record<number, number> = { 1: 7.6, 2: 6.4, 3: 5.4, 4: 4.6, 5: 4.0 }
export function prioSize(priority: number): number {
  return PRIO_SIZE[Math.min(5, Math.max(1, Math.round(priority)))] ?? 5.4
}

/** Continuous time-to-deadline in days; falls back to the horizon band. null = someday. */
export function daysUntilDeadline(p: ProjectRecord, ref: Date = new Date()): number | null {
  if (p.deadline) {
    if (p.deadline.includes('T')) return (new Date(p.deadline).getTime() - ref.getTime()) / DAY_MS
    return daysFromToday(p.deadline, ref)
  }
  return HORIZON_DAYS[p.horizon]
}

/** Whole-day bucket — feeds the angular layout so the fan doesn't twitch between frames. */
export function deadlineWholeDays(p: ProjectRecord, ref: Date = new Date()): number | null {
  if (p.deadline) return daysFromToday(p.deadline, ref)
  return HORIZON_DAYS[p.horizon]
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

/** True only for a real, past deadline (a fuzzy horizon never goes "overdue"). */
export function isOverdueProject(p: ProjectRecord, ref: Date = new Date()): boolean {
  if (!p.deadline) return false
  const d = daysFromToday(p.deadline, ref)
  return d !== null && d < 0
}

/** Task done-ratio (0..1) → the progress arc around the blip. */
export function taskRatio(p: ProjectRecord): number {
  if (!p.tasks.length) return 0
  return p.tasks.filter((t) => t.done).length / p.tasks.length
}

/** Short relative-deadline label for the HUD / detail panel. */
export function projectRelativeDeadline(p: ProjectRecord, ref: Date = new Date()): string {
  if (!p.deadline) {
    return p.horizon === 'today' ? 'today' : p.horizon === 'week' ? 'this week' : 'someday'
  }
  const days = daysFromToday(p.deadline, ref)
  if (days === null) return 'someday'
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
