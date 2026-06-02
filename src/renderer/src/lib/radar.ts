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

/** Organic per-blip wobble (deg) so lone auto-placed blips don't sit dead on a spoke. */
const SINGLE_JITTER_DEG = 16
/** Stable, bounded angular wobble for a blip with no manual override. */
function jitterForId(id: string): number {
  return (hash01(id) - 0.5) * SINGLE_JITTER_DEG
}

/**
 * A blip's *auto* angle: clustered around its project's sector and jittered stably
 * by id — unless the task carries a manual `radarAngle` override (set by dragging
 * it around the dial), which is honored verbatim. The crowd-aware fanning that
 * keeps same-project/same-deadline blips from stacking lives in `layoutBlipAngles`.
 */
export function blipAngle(task: Task, sectorBase: number): number {
  if (task.radarAngle != null) return mod360(task.radarAngle)
  return mod360(sectorBase + jitterForId(task.id))
}

/**
 * Inverse of the canvas `pt()` bearing: a screen-space delta from the radar center
 * (dx right, dy down) → compass bearing in degrees [0, 360), measured clockwise
 * from straight up. Used to read the angle where a dragged blip is dropped.
 */
export function angleFromPoint(dx: number, dy: number): number {
  return mod360((Math.atan2(dx, -dy) * 180) / Math.PI)
}

/* ── Crowd-aware angular layout ──────────────────────────────────────
   Same-project tasks share a wedge; at the same deadline they'd stack on
   one spoke. layoutBlipAngles fans each wedge's blips apart *only where*
   they'd actually overlap radially, widening the arc near the crowded
   center (small circumference → more degrees per pixel) and capping the
   spread so adjacent wedges never collide. Manual overrides win outright. */

/** One blip's inputs to the angular layout pass. */
export interface BlipLayoutInput {
  id: string
  /** Radial position [0..1] (from blipRadiusFrac). */
  frac: number
  /** Home wedge base angle in degrees (project sector). */
  base: number
  /** Blip draw radius in px (priority size) — drives collision spacing. */
  size: number
  /** Manual angle override in degrees, or null for auto layout. */
  override: number | null
}

export interface RadarLayoutOpts {
  /** Radar radius in px (frac × R = pixel radius). */
  R: number
  /** Angular gap between adjacent project wedges (deg) — bounds each fan. */
  wedgeSpacing: number
}

/** Fraction of a wedge a fanned cluster may span (keeps neighbors clear). */
const FAN_SPAN_FRAC = 0.72
/** Extra px before two radially-near blips count as separate clusters. */
const CLUSTER_PAD_PX = 3
/** Extra px of arc inserted between fanned blips (beyond their radii). */
const FAN_GAP_PAD_PX = 4
/** Floor on a cluster's pixel radius so dead-center fans stay finite. */
const MIN_FAN_RADIUS_PX = 14

function placeCluster(
  cluster: BlipLayoutInput[],
  base: number,
  maxSpan: number,
  R: number,
  out: Map<string, number>
): void {
  const m = cluster.length
  if (m === 1) {
    const b = cluster[0]
    out.set(b.id, mod360(base + jitterForId(b.id)))
    return
  }
  // Size the gap off the innermost (smallest-radius) blip — the tightest spot.
  const radiusPx = Math.max(cluster[0].frac * R, MIN_FAN_RADIUS_PX)
  const avgSize = cluster.reduce((s, b) => s + b.size, 0) / m
  const neededGapDeg = ((avgSize * 2 + FAN_GAP_PAD_PX) / radiusPx) * (180 / Math.PI)
  const gap = maxSpan > 0 ? Math.min(neededGapDeg, maxSpan / (m - 1)) : neededGapDeg
  const span = gap * (m - 1)
  cluster.forEach((b, k) => out.set(b.id, mod360(base - span / 2 + k * gap)))
}

/**
 * Resolve every blip's angle for one frame: overrides verbatim, the rest clustered
 * by wedge and fanned apart where they'd overlap. Pure + deterministic (stable id
 * tiebreak) so the radar can recompute it each frame without the layout twitching.
 */
export function layoutBlipAngles(
  blips: BlipLayoutInput[],
  opts: RadarLayoutOpts
): Map<string, number> {
  const { R, wedgeSpacing } = opts
  const out = new Map<string, number>()
  const maxSpan = Math.max(0, wedgeSpacing * FAN_SPAN_FRAC)

  // Park overrides immediately; group the auto blips by their home wedge.
  const wedges = new Map<number, BlipLayoutInput[]>()
  for (const b of blips) {
    if (b.override != null) {
      out.set(b.id, mod360(b.override))
      continue
    }
    const arr = wedges.get(b.base)
    if (arr) arr.push(b)
    else wedges.set(b.base, [b])
  }

  for (const [base, members] of wedges) {
    // Inward→outward; id breaks ties so the order is stable frame-to-frame.
    members.sort((a, b) => a.frac - b.frac || (a.id < b.id ? -1 : 1))
    // Walk the wedge, grouping runs that would overlap if left on one spoke.
    let i = 0
    while (i < members.length) {
      let j = i + 1
      while (
        j < members.length &&
        (members[j].frac - members[j - 1].frac) * R <
          members[j].size + members[j - 1].size + CLUSTER_PAD_PX
      ) {
        j++
      }
      placeCluster(members.slice(i, j), base, maxSpan, R, out)
      i = j
    }
  }
  return out
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
