import type { DueDate } from '@shared/types'

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Whole-day difference between two dates (b - a), ignoring time. */
function dayDiff(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** Parse a bare `YYYY-MM-DD` as a *local* calendar day; full datetimes pass through. */
export function parseDateLocal(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s)
}

/** Whole-day signed distance from today to a date (negative = past). null if no/garbage date. */
export function daysFromToday(iso: string | undefined, ref: Date = new Date()): number | null {
  if (!iso) return null
  const d = parseDateLocal(iso)
  // A hand-edited/hostile non-date ("tomorrow", "asap") must not leak NaN into radar math.
  if (Number.isNaN(d.getTime())) return null
  return dayDiff(ref, d)
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/** Human-friendly due label: "Today 5:00 PM", "Tomorrow", "Mon", "May 30". */
export function formatDue(due: DueDate, ref: Date = new Date()): string {
  const date = new Date(due.date)
  const diff = dayDiff(ref, date)

  let label: string
  if (diff === 0) label = 'Today'
  else if (diff === 1) label = 'Tomorrow'
  else if (diff === -1) label = 'Yesterday'
  else if (diff > 1 && diff < 7) label = WEEKDAY_FMT.format(date)
  else label = DATE_FMT.format(date)

  return due.hasTime ? `${label} ${TIME_FMT.format(date)}` : label
}

/** Day heading for grouped feeds: "Today", "Yesterday", weekday, or short date. */
export function formatDayHeading(iso: string, ref: Date = new Date()): string {
  const date = new Date(iso)
  const diff = dayDiff(ref, date)
  if (diff === 0) return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff < 0 && diff > -7) return WEEKDAY_FMT.format(date)
  return DATE_FMT.format(date)
}

/* ============================================================
   Calendar helpers
   ============================================================ */

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

/** Identifies a calendar month (month is 0-indexed, Jan = 0). */
export interface YearMonth {
  year: number
  month: number
}

/** A single day cell in the month grid. */
export interface CalendarDay {
  /** Midnight ISO for the day — stable key + due-date target. */
  iso: string
  /** Local day-of-month number (1–31). */
  day: number
  /** Whether the day belongs to the grid's anchor month (vs. spill-over). */
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
}

/** The {year, month} for a date (defaults to now). */
export function currentMonth(ref: Date = new Date()): YearMonth {
  return { year: ref.getFullYear(), month: ref.getMonth() }
}

/** Step a month forward/backward, rolling the year as needed. */
export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const base = new Date(year, month + delta, 1)
  return { year: base.getFullYear(), month: base.getMonth() }
}

/** "May 2026" — the month-picker heading. */
export function monthLabel({ year, month }: YearMonth): string {
  return MONTH_FMT.format(new Date(year, month, 1))
}

/** Midnight ISO for a Date — the canonical all-day due value + grid key. */
export function dayKey(d: Date): string {
  return startOfDay(d).toISOString()
}

/** True when two dates fall on the same local calendar day. */
export function sameDay(a: Date, b: Date): boolean {
  return dayDiff(a, b) === 0
}

/**
 * Build the 6-row (42-cell) month grid, weeks starting on Sunday, including
 * the trailing/leading days of adjacent months so the grid is always full.
 */
export function buildMonthGrid({ year, month }: YearMonth, ref: Date = new Date()): CalendarDay[] {
  const first = new Date(year, month, 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay()) // back up to the Sunday on/of the first week
  const todayKey = dayKey(ref)

  const cells: CalendarDay[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const dow = d.getDay()
    cells.push({
      iso: dayKey(d),
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: dayKey(d) === todayKey,
      isWeekend: dow === 0 || dow === 6
    })
  }
  return cells
}

export const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
