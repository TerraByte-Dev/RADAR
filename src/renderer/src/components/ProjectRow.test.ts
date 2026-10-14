// R3 (renderer spec 6.2, 8, 13): every row variant, the facts column and the selected row's
// expansion, rendered to markup. The view itself is covered end to end in e2e/pickup.spec.ts.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Activity, BlipDoc, ProjectRecord, Task } from '@shared/model'
import { localDate } from '../lib/derive'
import { catchUpPrompt, reEntryPrompt } from '../lib/prompts'
import { ProjectRow, rowName, type RowVariant } from './ProjectRow'

const NOW = new Date(2026, 9, 13, 14, 0).getTime()
const DAY = 86_400_000
const TODAY = localDate(NOW)
// the visible text: a glyph's <title> is a tooltip
const text = (html: string): string => html.replace(/<title>.*?<\/title>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

const task = (title: string, extra: Partial<Task> = {}): Task => ({ key: title, title, detail: [], due: null, done: false, doneOn: null, n: 1, ...extra })

const LONG = 'Play two full rounds at the table with the new deck and timer, then write the notes into docs/playtest.md for an agent'

function rec(over: { doc?: Partial<BlipDoc>; activity?: Partial<Activity> | null; live?: boolean; state?: ProjectRecord['state'] } = {}): ProjectRecord {
  const open = over.doc?.tasks?.open ?? [task(`Robin: ${LONG}`, { detail: ['Notes go in docs/playtest.md.'] }), task('Fold the rulebook down'), task('Robin: Redraw the tiles'), task('Fourth')]
  const doc: BlipDoc = {
    schema: 3,
    name: 'Harbor Lantern',
    nameSource: 'file',
    now: 'The second print-and-play deck is cut.',
    status: 'active',
    focus: false,
    due: null,
    tags: ['games'],
    links: [],
    tasks: { open, done: [] },
    next: open[0] ?? null,
    log: [],
    lastLogAt: null,
    problems: [],
    writable: true,
    ...over.doc
  }
  const activity: Activity | null =
    over.activity === null
      ? null
      : {
          source: 'git',
          lastWorkAt: new Date(NOW - 2 * DAY).toISOString(),
          lastLogAt: null,
          lastSyncAt: null,
          lastTouchedAt: new Date(NOW - 2 * DAY).toISOString(),
          unlogged: false,
          drift: { since: null, commits: 4, files: null },
          git: { repoRoot: '/p', subpath: '', branch: 'feat/italic-proof-masters', head: 'abc', dirty: false, dirtyCount: 0, lastCommit: null },
          daily: null,
          computedAt: new Date(NOW).toISOString(),
          error: null,
          ...over.activity
        }
  return { id: 'hl', dir: 'C:\\Work\\harbor', state: over.state ?? 'ok', doc, activity, agent: { live: over.live ?? false, sessions: 0, lastSeenAt: null }, hidden: false, rev: 'r' }
}

const row = (r: ProjectRecord, variant: RowVariant = 'full', selected = false, owner: string | null = 'Robin'): string =>
  renderToStaticMarkup(createElement(ProjectRow, { r, variant, selected, owner, now: NOW, today: TODAY, onSelect: () => {} }))

describe('ProjectRow', () => {
  it('full and line rows carry the whole next step, the owner prefix stripped into a you chip', () => {
    for (const v of ['full', 'line'] as const) {
      const html = row(rec(), v)
      expect(text(html)).toContain(`→ ${LONG} you`)
      expect(html).not.toContain('Robin:')
    }
  })

  it('a full row has the tag line and the Now; a line row names the project without the tag line', () => {
    expect(text(row(rec()))).toMatch(/^Harbor Lantern games The second print-and-play deck is cut\. →/)
    expect(row(rec(), 'line')).toMatch(/^<div[^>]*class="row q1"/)
    expect(row(rec(), 'line')).not.toContain('class="ar"')
  })

  it('without an owner there is no you chip, and the prefix stays in the title', () => {
    const html = row(rec(), 'full', false, null)
    expect(html).not.toMatch(/>you</)
    expect(text(html)).toContain(`Robin: ${LONG}`)
  })

  it('the continued row says so and repeats nothing: no Now, no next step, no facts line 2', () => {
    const html = row(rec(), 'continued')
    expect(text(html)).toBe('Harbor Lantern Continued above 2d')
    expect(html).not.toContain('class="l2"')
  })

  it('a read-only row carries its chip after the next step too, for line rows and one-line density', () => {
    for (const v of ['full', 'line'] as const) {
      const html = row(rec({ state: 'needs-migrate', doc: { writable: false } }), v)
      expect(html).toMatch(/<div class="nx">.*<span class="ro"><span class="chip q">v2 · read-only<\/span><\/span>/)
    }
  })

  it('a needs-repair row with no doc is named by its folder, not the whole path', () => {
    const r = { ...rec({ state: 'needs-repair' }), doc: null }
    const t = text(row(r, 'line'))
    expect(t).toMatch(/^harbor /)
    expect(t).not.toContain('C:\Work')
  })

  it('facts: age, source glyph and the log-behind glyph; line 2 is the branch cut in the middle with the whole name as its title', () => {
    const html = row(rec({ activity: { unlogged: true } }))
    expect(html).toContain('>2d<')
    expect(html).toContain('<title>From git</title>')
    expect(html).toContain('<title>The log is behind the work</title>')
    expect(html).toContain('title="feat/italic-proof-masters"')
    expect(html).toContain('feat/itali…f-masters')
    // a fact, never a count or the words, on an unselected row
    expect(text(html)).not.toMatch(/behind|4/)
  })

  it('facts: waiting and paused are words; a live session replaces the age', () => {
    expect(text(row(rec({ doc: { status: 'blocked' } })))).toMatch(/waiting 2d/)
    expect(text(row(rec({ doc: { status: 'paused' } }), 'line'))).toMatch(/paused 2d/)
    const live = row(rec({ live: true }))
    expect(live).toContain('<span class="livec">live</span>')
    expect(text(live)).not.toMatch(/\b2d\b/)
  })

  it('a due date ahead is facts line 2 and the chip after the step; a passed one shows nowhere', () => {
    const ahead = row(rec({ doc: { due: '2026-11-06' } }))
    expect(ahead).toContain('<span class="du">due 6 Nov</span>')
    expect(ahead).toContain('<span class="due"><span class="chip q">due 6 Nov</span></span>')
    expect(ahead).not.toContain('feat/italic')
    const passed = row(rec({ doc: { due: '2026-10-13' } }))
    expect(passed).not.toMatch(/due|overdue/i)
  })

  it('no Now line and no tasks read as such; commits stand in for the second sentence', () => {
    const empty = rec({ doc: { now: null, tasks: { open: [], done: [] }, next: null } })
    expect(text(row(empty))).toContain('No Now line yet. An agent writes one at its next sync. · No tasks queued')
    const busy = rec({ doc: { now: null }, activity: { daily: [0, 1, 0, 3, 2] } })
    expect(text(row(busy))).toContain('No Now line yet. Commits on 3 of the last 30 days.')
  })

  it('only the selected row expands: tasks 2 and 3, the log-behind line, and five actions with Open filled', () => {
    expect(row(rec())).not.toContain('class="then"')
    const html = row(rec({ activity: { unlogged: true } }), 'full', true)
    expect(text(html)).toContain('2 Fold the rulebook down 3 Redraw the tiles you')
    expect(text(html)).not.toContain('Fourth')
    expect(text(html)).toContain('The log is behind the work. L copies a catch-up prompt for an agent.')
    const acts = text(/<div class="acts">.*<\/div>/.exec(html)?.[0] ?? '')
    expect(acts).toBe('Open ↵ Resume R Copy re-entry prompt C Mark next step done X Not now N')
    expect(html.match(/class="btn pri/g)).toHaveLength(1)
  })

  it('with no tasks, the two edits are not drawn; a read-only row does not expand', () => {
    const none = row(rec({ doc: { tasks: { open: [], done: [] }, next: null } }), 'full', true)
    expect(text(/<div class="acts">.*<\/div>/.exec(none)?.[0] ?? '')).toBe('Open ↵ Resume R Copy re-entry prompt C')
    const v2 = row(rec({ state: 'needs-migrate', doc: { writable: false } }), 'full', true)
    expect(v2).not.toContain('class="then"')
    expect(text(v2)).toContain('games v2 · read-only')
  })

  it('shows no count of undone work and no overdue in any variant', () => {
    const r = rec({ activity: { unlogged: true }, doc: { due: '2026-10-01' } })
    for (const v of ['full', 'line', 'continued'] as const)
      for (const sel of [false, true]) {
        const t = text(row(r, v, sel))
        expect(t).not.toMatch(/\d+ (open|more|tasks|unlogged|left)/)
        expect(t).not.toMatch(/\+\d+/)
        expect(t).not.toMatch(/overdue/i)
      }
  })
})

describe('prompts (9.3)', () => {
  it('the re-entry prompt names the folder, the Now and the next step with its detail verbatim', () => {
    expect(reEntryPrompt(rec())).toBe(
      [
        'Pick up Harbor Lantern in C:\\Work\\harbor.',
        'Where it stands: The second print-and-play deck is cut.',
        `Next step: Robin: ${LONG}`,
        'Notes go in docs/playtest.md.',
        'Run `radar-blip brief` first for the full queue and recent log. When you stop, run /blip.'
      ].join('\n')
    )
  })

  it('leaves out what the project does not have', () => {
    const bare = rec({ doc: { now: null, tasks: { open: [], done: [] }, next: null } })
    expect(reEntryPrompt(bare)).toBe('Pick up Harbor Lantern in C:\\Work\\harbor.\nRun `radar-blip brief` first for the full queue and recent log. When you stop, run /blip.')
  })

  it('the catch-up prompt asks for the log only', () => {
    expect(catchUpPrompt(rec())).toBe(
      'In C:\\Work\\harbor, the BLIP.md log is behind the work. Run `radar-blip brief`, read what changed since the last entry, then run /blip to log it. Do not change any code.'
    )
  })
})

describe('the row as a listbox option (section 11)', () => {
  it('is named "{name}. {Now}. Next: {title}. {start cost}. Last worked {age} ago.", the age in words', () => {
    expect(rowName(rec(), 'Robin', NOW)).toBe(`Harbor Lantern. The second print-and-play deck is cut. Next: ${LONG}. Needs you. Last worked 2 days ago.`)
    const at = (d: number): string => rowName(rec({ activity: { lastTouchedAt: new Date(NOW - d * DAY).toISOString() } }), 'Robin', NOW)
    expect(at(1)).toContain('Last worked 1 day ago.')
    expect(at(21)).toContain('Last worked 3 weeks ago.')
    expect(at(120)).toContain('Last worked 4 months ago.')
    expect(at(0.2)).toContain('Last worked today.')
  })

  it("the continued row's name ends Shown in Continue above; the selected row's says tasks 2 and 3", () => {
    expect(rowName(rec(), 'Robin', NOW, true)).toMatch(/Last worked 2 days ago\. Shown in Continue above\.$/)
    expect(rowName(rec({ activity: { unlogged: true } }), 'Robin', NOW, false, true)).toContain('Then: Fold the rulebook down; Redraw the tiles, needs you. The log is behind the work.')
  })

  it('says a due date still ahead, in words, and a passed one not at all', () => {
    expect(rowName(rec({ doc: { due: '2026-11-06' } }), 'Robin', NOW)).toContain('Needs you. Due 6 November. Last worked')
    expect(rowName(rec({ doc: { due: '2027-02-01' } }), 'Robin', NOW)).toContain('Due 1 February 2027.')
    const r = rec()
    const next = { ...(r.doc?.next as Task), due: '2026-12-24' }
    expect(rowName({ ...r, doc: { ...(r.doc as BlipDoc), next } }, 'Robin', NOW)).toContain('Due 24 December.')
    expect(rowName(rec({ doc: { due: '2026-10-13' } }), 'Robin', NOW)).not.toMatch(/due/i)
  })

  it('says why the age fell back, as the facts line does', () => {
    expect(rowName(rec({ activity: { error: 'partial' } }), 'Robin', NOW)).toContain(
      'Last worked 2 days ago. The folder has too many files to read them all; the age is from the ones read.'
    )
    expect(rowName(rec({ activity: { error: 'git timed out' } }), 'Robin', NOW)).toContain('git timed out; using file times.')
  })

  it("an owner-only step says needs you even while an agent is in here", () => {
    expect(rowName(rec({ live: true }), 'Robin', NOW)).toContain('An agent is in here now. Needs you.')
  })

  it('no owner, no start cost; a live session says so; activity not read yet says so', () => {
    expect(rowName(rec(), null, NOW)).not.toMatch(/needs you|an agent can start/i)
    expect(rowName(rec({ live: true }), 'Robin', NOW)).toContain('An agent is in here now.')
    expect(rowName(rec({ activity: null }), 'Robin', NOW)).toMatch(/Reading activity\.$/)
  })

  it('the option is the mark cell, and nothing inside it is a control', () => {
    const html = renderToStaticMarkup(createElement(ProjectRow, { r: rec(), variant: 'full', selected: true, owner: 'Robin', now: NOW, today: TODAY, onSelect: () => {} }))
    const opt = /<div id="opt-hl" role="option"[^>]*>(.*?)<\/div><\/div>/.exec(html)
    expect(opt).not.toBeNull()
    expect(opt?.[0]).toContain('aria-selected="true"')
    expect(opt?.[1]).not.toMatch(/<button|tabindex/)
    // the expansion draws the buttons for the mouse; the keys on their caps are the way in
    expect(html).toMatch(/class="then" aria-hidden="true"/)
    expect([...html.matchAll(/<button[^>]*>/g)].every((m) => m[0].includes('tabindex="-1"'))).toBe(true)
  })
})

