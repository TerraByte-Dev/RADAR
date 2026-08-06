/** The three time horizons — intentionally loose near/mid/far buckets. Drives radar distance. */
export type Horizon = 'today' | 'week' | 'someday';
export type Status = 'active' | 'paused' | 'blocked' | 'shipped' | 'archived';

export const HORIZONS: readonly Horizon[] = ['today', 'week', 'someday'];
export const STATUSES: readonly Status[] = ['active', 'paused', 'blocked', 'shipped', 'archived'];

export interface BlipTask {
  text: string;
  done: boolean;
}

/** Frontmatter keys the engine understands. Any other keys are preserved verbatim. */
export interface BlipFields {
  name?: string;
  horizon: Horizon;
  priority: number; // 1..5, 1 = top
  category: string;
  status: Status;
  /**
   * Hard due date — ISO `YYYY-MM-DD` or full datetime. When present it drives the
   * radar's continuous distance-from-center; `horizon` is the fuzzy fallback band.
   */
  deadline?: string;
  /**
   * App-owned visual pin in degrees [0, 360). Set by dragging a blip around the dial;
   * a purely cosmetic override that does NOT reassign the project/category.
   */
  radar_angle?: number;
  /** Optional cluster grouping — projects sharing an `operation` form a radar sector. */
  operation?: string;
  created?: string;
  last_session?: string;
  tags?: string[];
  links?: unknown[];
}

/**
 * Keys the engine manages; everything else in frontmatter is "unknown" and preserved.
 * `next_action` is **retired** — it stays listed here (so it is never mistaken for a
 * user key and round-tripped forever) but no longer appears on `BlipFields`; the first
 * write to a file carrying one promotes it to task #1 and drops the key
 * (`Blip#migrateNextAction`). The next action is now simply the first unchecked task.
 */
export const KNOWN_KEYS: readonly string[] = [
  'name', 'horizon', 'priority', 'category', 'status',
  'next_action', 'deadline', 'radar_angle', 'operation',
  'created', 'last_session', 'tags', 'links',
];

export const DEFAULTS = {
  horizon: 'someday' as Horizon,
  priority: 3,
  category: '',
  status: 'active' as Status,
};

export function coerceHorizon(v: unknown): Horizon {
  return HORIZONS.includes(v as Horizon) ? (v as Horizon) : DEFAULTS.horizon;
}

export function coerceStatus(v: unknown): Status {
  return STATUSES.includes(v as Status) ? (v as Status) : DEFAULTS.status;
}

export function coercePriority(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULTS.priority;
  return Math.min(5, Math.max(1, Math.round(n)));
}

/** Normalize a manual radar angle to [0, 360); `undefined` if it isn't a finite number. */
export function coerceAngle(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return ((v % 360) + 360) % 360;
}

/** Accept an ISO date/datetime as a deadline; `undefined` if it isn't a parseable date string. */
export function coerceDeadline(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return Number.isNaN(new Date(s).getTime()) ? undefined : s;
}
