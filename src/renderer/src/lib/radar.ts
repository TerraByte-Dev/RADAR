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

/** Organic per-blip wobble span (deg) so lone auto-placed blips don't sit dead on a spoke. */
const SINGLE_JITTER_DEG = 16

/** Smallest absolute angular distance (deg) between two bearings. */
function angDelta(a: number, b: number): number {
  const d = Math.abs(mod360(a) - mod360(b))
  return d > 180 ? 360 - d : d
}

/** Stable per-blip wobble (deg) for a lone auto blip, clamped so it never leaves its wedge. */
function jitterForId(id: string, maxOffset: number): number {
  const raw = (hash01(id) - 0.5) * SINGLE_JITTER_DEG
  const cap = Math.max(0, maxOffset)
  return Math.max(-cap, Math.min(cap, raw))
}

/**
 * Inverse of the canvas `pt()` bearing: a screen-space delta from the radar center
 * (dx right, dy down) → compass bearing in degrees [0, 360), measured clockwise
 * from straight up. Used to read the angle where a dragged blip is dropped.
 * A dead-center delta has no bearing, so it maps to 0 rather than the `atan2(0, -0)`
 * artifact (which would be 180°).
 */
export function angleFromPoint(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0
  return mod360((Math.atan2(dx, -dy) * 180) / Math.PI)
}

/**
 * Radial position used for the *angular* layout only — bucketed to the whole
 * calendar day, unlike `blipRadiusFrac` which tracks the live clock for timed
 * dues. So tasks due the same day in the same project cluster and fan together,
 * and the fan doesn't twitch as a timed blip's drawn radius drifts between frames.
 */
export function blipLayoutFrac(task: Task, ref: Date = new Date()): number {
  return radiusFracForDays(task.due ? daysFromToday(task.due.date, ref) : null)
}

/* ── Crowd-aware angular layout ──────────────────────────────────────
   Same-project tasks share a wedge; at the same deadline they'd stack on
   one spoke. layoutBlipAngles fans each wedge's blips apart *only where*
   they'd actually overlap radially, widening the arc near the crowded
   center (small circumference → more degrees per pixel) and capping the
   spread so adjacent wedges never collide. Manually pinned blips are fixed
   obstacles the auto blips fan *around* (never onto). */

/** One blip's inputs to the angular layout pass. */
export interface BlipLayoutInput {
  id: string
  /** Radial position [0..1] (from blipLayoutFrac). */
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

/**
 * Place one radial cluster. Pinned (override) blips are parked at their own angle
 * and act as fixed obstacles; the auto blips are fanned across evenly-spaced slots,
 * and any slot an obstacle already occupies is reserved — so an auto blip never
 * lands on a pinned same-day sibling.
 */
function placeCluster(
  members: BlipLayoutInput[],
  base: number,
  maxSpan: number,
  R: number,
  out: Map<string, number>
): void {
  const fixed = members.filter((b) => b.override != null)
  const autos = members.filter((b) => b.override == null)
  for (const b of fixed) out.set(b.id, mod360(b.override as number))
  if (autos.length === 0) return

  // A lone auto blip with no pinned neighbour: a stable, wedge-bounded wobble.
  if (autos.length === 1 && fixed.length === 0) {
    const b = autos[0]
    out.set(b.id, mod360(base + jitterForId(b.id, maxSpan / 2)))
    return
  }

  // Fan the whole cluster across evenly-spaced slots, sized off the innermost
  // (tightest) blip; obstacles claim their nearest slot so the auto blips take
  // the ones farthest from any pinned sibling.
  const m = members.length
  const innerFrac = Math.min(...members.map((b) => b.frac))
  const radiusPx = Math.max(innerFrac * R, MIN_FAN_RADIUS_PX)
  const avgSize = members.reduce((s, b) => s + b.size, 0) / m
  const neededGapDeg = ((avgSize * 2 + FAN_GAP_PAD_PX) / radiusPx) * (180 / Math.PI)
  const gap = maxSpan > 0 ? Math.min(neededGapDeg, maxSpan / Math.max(m - 1, 1)) : neededGapDeg
  const span = gap * (m - 1)
  const slots: number[] = []
  for (let k = 0; k < m; k++) slots.push(base - span / 2 + k * gap)

  const taken = new Array<boolean>(m).fill(false)
  for (const f of fixed) {
    let best = -1
    let bestD = Infinity
    for (let k = 0; k < m; k++) {
      if (taken[k]) continue
      const d = angDelta(slots[k], f.override as number)
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
    // Only reserve a slot if the obstacle actually sits within the fan zone.
    if (best >= 0 && bestD <= gap) taken[best] = true
  }
  let k = 0
  for (const b of autos) {
    while (k < m && taken[k]) k++
    out.set(b.id, mod360(slots[Math.min(k, m - 1)]))
    k++
  }
}

/**
 * Resolve every blip's angle: pinned blips at their override, the rest clustered by
 * wedge and fanned apart where they'd overlap (fanning *around* pinned siblings).
 * Pure + deterministic (stable id tiebreak). Feed it `blipLayoutFrac` (whole-day
 * buckets) so the result is stable frame-to-frame; the canvas caches it on a data
 * signature and only recomputes live while a blip is being dragged.
 */
export function layoutBlipAngles(
  blips: BlipLayoutInput[],
  opts: RadarLayoutOpts
): Map<string, number> {
  const { R, wedgeSpacing } = opts
  const out = new Map<string, number>()
  const maxSpan = Math.max(0, wedgeSpacing * FAN_SPAN_FRAC)

  // Group every blip by its home wedge — pinned ones included, so the auto blips
  // in a wedge fan around their pinned siblings instead of ignoring them.
  const wedges = new Map<number, BlipLayoutInput[]>()
  for (const b of blips) {
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
