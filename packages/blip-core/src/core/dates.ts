/**
 * The one date validator, plus the local-clock formatting the log uses.
 * `new Date(anything)` is never used to validate a date anywhere in the engine.
 */

/** A strict `YYYY-MM-DD` that is a real calendar date, or null. `2026-02-31` is null. */
export function parseIsoDate(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/** `HH:MM` on a 24-hour clock, or null. */
export function parseClock(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? s : null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local calendar date of an instant, `YYYY-MM-DD`. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local wall-clock time of an instant, `HH:MM`. */
export function localTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The instant a log entry stands for. With a time: that local date and time. Date only:
 * the end of that local day, clamped to the file's modification time when one is known —
 * otherwise an entry dated today would sit in the future for the rest of the day.
 */
export function entryInstant(date: string, time: string | null, mtime?: Date): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (time) {
    const [hh, mm] = time.split(':').map(Number) as [number, number];
    return new Date(y, m - 1, d, hh, mm, 0);
  }
  const endOfDay = new Date(y, m - 1, d, 23, 59, 59);
  return mtime && mtime.getTime() < endOfDay.getTime() ? mtime : endOfDay;
}
