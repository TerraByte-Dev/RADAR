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
  next_action?: string;
  created?: string;
  last_session?: string;
  tags?: string[];
  links?: unknown[];
}

/** Keys the engine manages; everything else in frontmatter is "unknown" and preserved. */
export const KNOWN_KEYS: readonly string[] = [
  'name', 'horizon', 'priority', 'category', 'status',
  'next_action', 'created', 'last_session', 'tags', 'links',
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
