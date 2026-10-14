// Derived values (renderer spec 3, 5, 6.3, 6.4): pure selectors over the board. Nothing here is
// stored; every view computes what it shows from these.
import type { Check, LogEntry, ProjectRecord, Task } from '@shared/model'

/** What the selectors read from the board store. */
export interface BoardData {
  projects: Record<string, ProjectRecord>
  /** `app.info.owner`; null hides every start-cost signal. */
  owner: string | null
  now: number
}

const DAY_MS = 86_400_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_WORDS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n: number): string => String(n).padStart(2, '0')

/** The local calendar date of an instant, `YYYY-MM-DD`. */
export const localDate = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The local wall-clock time of an instant, `HH:MM`. */
export const localTime = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Every record a view shows: not hidden and not missing (Settings alone shows those). */
export const visible = (b: Pick<BoardData, 'projects'>): ProjectRecord[] =>
  Object.values(b.projects).filter((r) => !r.hidden && r.state !== 'missing')

export const touchedAt = (r: ProjectRecord): string | null => r.activity?.lastTouchedAt ?? r.doc?.lastLogAt ?? null

/** Days since the project was last touched, floored at 0; null when it never was. */
export function days(r: ProjectRecord, now: number): number | null {
  const at = touchedAt(r)
  if (at === null) return null
  return Math.max(0, (now - Date.parse(at)) / DAY_MS)
}

/** `new`, `today`, `2d`, `3w`, `4mo`. */
export function ageLabel(d: number | null): string {
  if (d === null) return 'new'
  if (d < 1) return 'today'
  if (d < 14) return `${Math.round(d)}d`
  if (d < 84) return `${Math.round(d / 7)}w`
  return `${Math.round(d / 30)}mo`
}

/** ageLabel as a screen reader should say it: `2 days`, `3 weeks`, `4 months` (d of 1 or more). */
export function ageWords(d: number): string {
  const [n, unit] = d < 14 ? [Math.round(d), 'day'] : d < 84 ? [Math.round(d / 7), 'week'] : [Math.round(d / 30), 'month']
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/** dueLabel as a screen reader should say it: `Due 6 November` (and the year when it is not this one). */
export function dueWords(iso: string | null, today: string): string | null {
  if (iso === null || iso <= today) return null
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return `Due ${d} ${MONTH_WORDS[m - 1]}${iso.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`}`
}

/** `due 6 Nov` (and the year when it is not this one) for a date strictly after `today`; else null: nothing is ever overdue. */
export function dueLabel(iso: string | null, today: string): string | null {
  if (iso === null || iso <= today) return null
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return `due ${d} ${MONTHS[m - 1]}${iso.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`}`
}

const ownerPrefix = (owner: string): string => `${owner.toLowerCase()}:`

/** The step carries the owner's prefix (`Robin: …`), so only the owner can do it. */
export const ownerOnly = (task: Task, owner: string | null): boolean =>
  owner !== null && task.title.toLowerCase().startsWith(ownerPrefix(owner))

/** The title as shown: the owner's prefix is stripped, as the `you` chip says it. */
export const displayTitle = (task: Task, owner: string | null): string =>
  ownerOnly(task, owner) ? task.title.slice(ownerPrefix(owner as string).length).trimStart() : task.title

export function startCost(r: ProjectRecord, task: Task, owner: string | null): string | null {
  if (r.agent.live) return 'an agent is in here now'
  if (owner === null) return null
  return ownerOnly(task, owner) ? 'needs you' : 'an agent can start this'
}

export function sourceGlyph(r: ProjectRecord): 'branch' | 'page' | null {
  const s = r.activity?.source
  return s === 'git' ? 'branch' : s === 'files' ? 'page' : null
}

export const behind = (r: ProjectRecord): boolean => r.activity?.unlogged === true

/**
 * Why activity fell back (section 8), as facts line 2 says it, and the whole of it for the
 * tooltip; null when nothing failed. `partial` is the file walk stopping at its cap.
 */
export function activityProblem(r: ProjectRecord): { short: string; title: string } | null {
  const e = r.activity?.error
  if (!e) return null
  if (e === 'partial') return { short: 'too many files', title: 'The folder has too many files to read them all; the age is from the ones read' }
  return { short: /timed out/.test(e) ? 'git timed out' : 'git failed', title: `${e}; using file times` }
}

/** At most 20 characters; a longer name keeps its first 10 and last 9 around `…`. */
export const branchLabel = (b: string): string => (b.length <= 20 ? b : `${b.slice(0, 10)}…${b.slice(-9)}`)

// ---- grouping (section 5) ----

export type Group = 'week' | 'recent' | 'earlier' | 'paused' | 'archived'
export const WEEK_DAYS = 7
export const SIX_WEEKS_DAYS = 42
export const GROUPS: Group[] = ['week', 'recent', 'earlier', 'paused', 'archived']

/** Explicit status first; activity only places what is active or waiting. A live session is not an input. */
export function groupOf(r: ProjectRecord, now: number): Group {
  const status = r.doc?.status ?? 'active'
  if (status === 'archived') return 'archived'
  if (status === 'paused') return 'paused'
  const d = days(r, now)
  if (d !== null && d <= WEEK_DAYS) return 'week'
  if (d !== null && d <= SIX_WEEKS_DAYS) return 'recent'
  return 'earlier'
}

const nameOf = (r: ProjectRecord): string => r.doc?.name ?? r.dir

/** A project's folder, the last part of its path. */
export const folderName = (dir: string): string => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir

/** Inside a group: focus first, then most recent (never touched last), then name. */
export function groupSort(now: number): (a: ProjectRecord, b: ProjectRecord) => number {
  return (a, b) =>
    Number(b.doc?.focus ?? false) - Number(a.doc?.focus ?? false) ||
    (days(a, now) ?? Infinity) - (days(b, now) ?? Infinity) ||
    nameOf(a).localeCompare(nameOf(b))
}

/** The visible records by group, in group order, sorted; empty groups left out. */
export function groups(b: BoardData): { group: Group; rows: ProjectRecord[] }[] {
  const all = visible(b)
  return GROUPS.map((group) => ({ group, rows: all.filter((r) => groupOf(r, b.now) === group).sort(groupSort(b.now)) })).filter(
    (g) => g.rows.length > 0
  )
}

/** The rows J and K move through, top to bottom: every group but archived, which is one sentence. */
export const listOrder = (b: BoardData): ProjectRecord[] => groups(b).flatMap((g) => (g.group === 'archived' ? [] : g.rows))

/** Days in the last 30 with a commit; 0 without git. */
export const commitDays = (r: ProjectRecord): number => r.activity?.daily?.filter((n) => n > 0).length ?? 0

/** How many visible projects were worked on this week: a count of work done, so allowed (rule 1). */
export const touchedThisWeek = (b: BoardData): number => visible(b).filter((r) => groupOf(r, b.now) === 'week').length

// ---- one order (section 6.4) ----

/** Continue is `[0]`, the project last worked on; Pick one for me deals from `[1]`: focus pins, then the rest of this week. */
export function pickOrder(b: BoardData, now: number = b.now): ProjectRecord[] {
  const pool = visible(b).filter(
    (r) => r.state === 'ok' && r.doc?.next && r.doc.status !== 'paused' && r.doc.status !== 'archived'
  )
  const d = (r: ProjectRecord): number => days(r, now) ?? Infinity
  const byRecent = (x: ProjectRecord, y: ProjectRecord): number => d(x) - d(y) || nameOf(x).localeCompare(nameOf(y))
  const first = pool.slice().sort(byRecent)[0]
  if (!first) return []
  const rest = pool.filter((r) => r !== first && r.doc?.status !== 'blocked')
  const needsYou = (r: ProjectRecord): number => (b.owner && ownerOnly(r.doc?.next as Task, b.owner) ? 1 : 0)
  const deal = (x: ProjectRecord, y: ProjectRecord): number => needsYou(x) - needsYou(y) || byRecent(x, y)
  const pins = rest.filter((r) => r.doc?.focus).sort(deal)
  const week = rest.filter((r) => !r.doc?.focus && groupOf(r, now) === 'week').sort(deal)
  return [first, ...pins, ...week]
}

/**
 * Pick one for me's "Why this one." for `order[index]` (index 1 and on): its place in the order,
 * then, when the owner is known, what starting its next step costs.
 */
export function pickReason(order: ProjectRecord[], index: number, owner: string | null): string {
  const r = order[index]
  const pinned = r?.doc?.focus === true
  const place = !pinned
    ? 'No focus pins left. It is the most recent project this week'
    : index === 1
      ? `It is your most recent focus pin after ${order[0] ? nameOf(order[0]) : ''}`
      : 'It is your next focus pin'
  const next = r?.doc?.next
  if (!owner || !next) return `${place}.`
  return `${place}, ${ownerOnly(next, owner) ? 'and its next step needs you.' : 'and an agent can start its next step.'}`
}

/**
 * The header's `Last worked on: X`: the most recently touched visible project, whatever it has
 * queued. Not `pickOrder[0]`, whose pool leaves out projects with no next step, paused and the
 * like, so it can name a project that was not the last one worked on.
 */
export function lastWorkedOn(b: BoardData): ProjectRecord | null {
  const d = (r: ProjectRecord): number => days(r, b.now) ?? Infinity
  const touched = visible(b).filter((r) => touchedAt(r) !== null)
  return touched.sort((x, y) => d(x) - d(y) || nameOf(x).localeCompare(nameOf(y)))[0] ?? null
}

// ---- since you were last here (section 6.3) ----

export interface DigestLine {
  id: string
  name: string
  /** The newest entry's first bullet. */
  text: string
  /** `today`, else a three-letter weekday. */
  day: string
  at: number
}

const DIGEST_MAX = 4

/** The local instant an entry stands for, without the file's mtime: only used to find the newest entry. */
function entryMs(e: LogEntry): number {
  if (!e.date) return -Infinity
  const [y, m, d] = e.date.split('-').map(Number) as [number, number, number]
  const [hh, mm] = e.time ? (e.time.split(':').map(Number) as [number, number]) : [23, 59]
  return new Date(y, m - 1, d, hh, mm).getTime()
}

/** Projects whose newest log entry is after `lastOpenedAt`, newest first, at most four, never Continue's. Nothing before a first visit. */
export function digest(b: BoardData, lastOpenedAt: number | null | undefined): DigestLine[] {
  if (lastOpenedAt == null) return []
  const skip = pickOrder(b)[0]
  const today = localDate(b.now)
  const out: DigestLine[] = []
  for (const r of visible(b)) {
    const doc = r.doc
    if (r === skip || !doc?.lastLogAt || !doc.log.length) continue
    // lastLogAt is the engine's instant for the newest entry (its date-only entries clamped to the file's mtime).
    const at = Date.parse(doc.lastLogAt)
    if (!(at > lastOpenedAt)) continue
    const newest = doc.log.reduce((x, y) => (entryMs(y) > entryMs(x) ? y : x))
    out.push({
      id: r.id,
      name: doc.name,
      text: newest.bullets[0] ?? '',
      day: localDate(at) === today ? 'today' : (WEEKDAYS[new Date(at).getDay()] as string),
      at
    })
  }
  return out.sort((x, y) => y.at - x.at).slice(0, DIGEST_MAX)
}

/** The newest `activity.computedAt` on the board, for the status bar's `activity read HH:MM`. */
export function activityReadAt(b: Pick<BoardData, 'projects'>): number | null {
  let max: number | null = null
  for (const r of visible(b)) {
    const at = r.activity ? Date.parse(r.activity.computedAt) : NaN
    if (!Number.isNaN(at) && (max === null || at > max)) max = at
  }
  return max
}

export const GIT_WARNING = 'git was not found · recency is from file times'

/** The status bar's right side: the git warning when git is missing (section 8), else when activity was last read. */
export function rightStatus(b: Pick<BoardData, 'projects'> & { setup: Check[] | null }): string | null {
  if (b.setup?.some((c) => c.id === 'git' && c.level !== 'ok')) return GIT_WARNING
  const at = activityReadAt(b)
  return at === null ? null : `activity read ${localTime(at)}`
}
