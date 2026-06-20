import * as chrono from 'chrono-node'
import type { DueDate, Priority } from '@shared/types'

export interface ParsedQuickAdd {
  /** The cleaned task title (tokens and date phrase removed). */
  title: string
  priority: Priority
  /** Project name from a `#project` token, if present. */
  projectName?: string
  tags: string[]
  due?: DueDate
}

const PRIORITY_RE = /(?:^|\s)(p[1-4]|![1-3])(?=\s|$)/i
const PROJECT_RE = /(?:^|\s)#([\p{L}\p{N}_-]+)/u
const TAG_RE = /(?:^|\s)@([\p{L}\p{N}_-]+)/gu

/** `!1`/`!2`/`!3` shorthand maps onto P1/P2/P3. */
function normalizePriority(token: string): Priority {
  const t = token.toLowerCase()
  if (t.startsWith('!')) return `P${t[1]}` as Priority
  return t.toUpperCase() as Priority
}

/**
 * Parse a single quick-add line into structured task fields.
 *
 * Example: `Pay rent tomorrow 5pm p1 #finance @home`
 *   → title "Pay rent", priority P1, projectName "finance",
 *     tags ["home"], due { tomorrow 5pm, hasTime: true }
 *
 * Pure and deterministic given `ref` (the "now" reference), so it is unit-tested.
 */
export function parseQuickAdd(input: string, ref: Date = new Date()): ParsedQuickAdd {
  let text = input

  // 1. Priority token.
  let priority: Priority = 'none'
  const pMatch = text.match(PRIORITY_RE)
  if (pMatch) {
    priority = normalizePriority(pMatch[1])
    text = text.replace(pMatch[0], ' ')
  }

  // 2. Project token (first one wins).
  let projectName: string | undefined
  const projMatch = text.match(PROJECT_RE)
  if (projMatch) {
    projectName = projMatch[1]
    text = text.replace(projMatch[0], ' ')
  }

  // 3. Tag tokens (all of them).
  const tags: string[] = []
  for (const m of text.matchAll(TAG_RE)) tags.push(m[1])
  if (tags.length) text = text.replace(TAG_RE, ' ')

  // 4. Date phrase via chrono — strip the matched span from the title.
  let due: DueDate | undefined
  const results = chrono.parse(text, ref, { forwardDate: true })
  if (results.length) {
    const r = results[0]
    const hasTime = r.start.isCertain('hour')
    due = { date: r.start.date().toISOString(), hasTime }
    text = (text.slice(0, r.index) + ' ' + text.slice(r.index + r.text.length)).trim()
  }

  const title = text.replace(/\s+/g, ' ').trim()
  return { title, priority, projectName, tags, due }
}
