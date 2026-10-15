// R6 (renderer spec 7.3, 6.7): the scope's SVG, the readout and the list, rendered to markup. The
// view and the home panel are covered end to end in e2e/scope.spec.ts.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Activity, BlipDoc, ProjectRecord, Task } from '@shared/model'
import { HOME_PANEL, layout, stageBox, type ScopeProject } from '../lib/scope'
import { ScopeList, ScopeReadout, ScopeSvg } from './Scope'

const NOW = new Date(2026, 9, 13, 14, 0).getTime()
const DAY = 86_400_000
const text = (html: string): string => html.replace(/<title>.*?<\/title>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

const p = (id: string, name: string, days: number | null, extra: Partial<ScopeProject> = {}): ScopeProject => ({
  id,
  name,
  days,
  status: 'active',
  focus: false,
  live: false,
  group: days !== null && days <= 7 ? 'week' : days !== null && days <= 42 ? 'recent' : 'earlier',
  age: days === null ? 'new' : `${days}d`,
  ...extra
})
const SET = [
  p('live', 'Tidewatch', 0, { focus: true, live: true, age: 'today' }),
  p('pin', 'Homelab board', 2, { focus: true }),
  p('plain', 'Cloud Glide', 3),
  p('old', 'Starmap', 52, { group: 'earlier' }),
  p('park', 'Dungeon Dig', 2, { status: 'paused', group: 'paused' }),
  p('arch', 'Bus Stop', 140, { status: 'archived', group: 'archived' })
]
const BOX = stageBox(948, 726, 1280)

describe('ScopeSvg (7.3)', () => {
  const html = renderToStaticMarkup(createElement(ScopeSvg, { L: layout(SET, { ...BOX, selected: 'plain' }), box: BOX, interactive: true }))

  it('a reticle for each focus project and a ring for each live session, and nothing else green', () => {
    expect(html.match(/class="reticle"/g)).toHaveLength(2)
    expect(html.match(/class="live"/g)).toHaveLength(1)
    // colour comes from classes only: no fill or stroke attribute names one
    expect(html).not.toMatch(/(fill|stroke)="(?!none|transparent)[^"]*"/)
  })

  it('selection is the label plate, never a second ring', () => {
    expect(html).toMatch(/class="blip t-hot[^"]*is-sel"/)
    expect(html.match(/<circle class="live"/g)).toHaveLength(1)
  })

  it('paused and archived blips are hollow, archived ones carry no age', () => {
    expect(html).toMatch(/class="blip t-dim[^"]*is-paused/)
    expect(html).toMatch(/class="blip t-dim[^"]*is-arch/)
    expect(text(html)).toContain('Bus Stop')
    expect(text(html)).not.toMatch(/Bus Stop \d/)
  })

  it('no text under 12px (rule 9), the SVG at its own size', () => {
    for (const m of html.matchAll(/font-size="([\d.]+)"/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12)
    expect(html).toContain('viewBox="0 0 948 726" width="948" height="726"')
  })

  it('each blip is a button named for its project; on the home panel the panel is the link and blips are not', () => {
    expect(html).toContain('role="button" aria-label="Tidewatch, agent session live, focus, last worked today"')
    const panel = renderToStaticMarkup(createElement(ScopeSvg, { L: layout(SET, { ...HOME_PANEL, keep: ['live'] }), box: HOME_PANEL }))
    expect(panel).toContain('aria-hidden="true"')
    expect(panel).not.toMatch(/tabindex|role="button"/)
  })
})

const task = (title: string): Task => ({ key: title, title, detail: [], due: null, done: false, doneOn: null, n: 1 })

function rec(over: { doc?: Partial<BlipDoc>; activity?: Partial<Activity>; live?: boolean; id?: string } = {}): ProjectRecord {
  const open = [task('Robin: Stall and spin: lose lift, drop a wing, recover'), task('Second')]
  const doc = {
    schema: 3,
    name: 'Cloud Glide',
    nameSource: 'file',
    now: 'The glider and the thermal model are committed.',
    status: 'active',
    focus: false,
    due: null,
    tags: ['games'],
    links: [],
    tasks: { open, done: [] },
    next: open[0],
    log: [],
    lastLogAt: null,
    problems: [],
    writable: true,
    ...over.doc
  } as BlipDoc
  const activity = {
    source: 'git',
    lastWorkAt: new Date(NOW - 3 * DAY).toISOString(),
    lastLogAt: null,
    lastSyncAt: null,
    lastTouchedAt: new Date(NOW - 3 * DAY).toISOString(),
    unlogged: true,
    drift: { since: null, commits: 7, files: 3 },
    git: { repoRoot: '/p', subpath: '', branch: 'main', head: 'abc', dirty: true, dirtyCount: 4, lastCommit: null },
    daily: null,
    computedAt: new Date(NOW).toISOString(),
    error: null,
    ...over.activity
  } as Activity
  return { id: over.id ?? 'glide', dir: 'C:\\Work\\glide', state: 'ok', doc, activity, agent: { live: over.live ?? false, sessions: 0, lastSeenAt: null }, hidden: false, rev: 'r' }
}

describe('ScopeReadout (6.7)', () => {
  it('name, tag, Now, the next step whole, and age, source, branch and log behind on one line; no counts', () => {
    const t = text(renderToStaticMarkup(createElement(ScopeReadout, { r: rec(), owner: 'Robin', now: NOW })))
    expect(t).toBe('Cloud Glide games The glider and the thermal model are committed. → Stall and spin: lose lift, drop a wing, recover you 3d · main · log behind')
    expect(t).not.toMatch(/\d+ (open|more|tasks|unlogged|left|commits|files)|\+\d|overdue/i)
  })

  it('live instead of the age while a session is detected', () => {
    const t = text(renderToStaticMarkup(createElement(ScopeReadout, { r: rec({ live: true }), owner: null, now: NOW })))
    expect(t).toContain('live · main')
    expect(t).not.toContain('you')
  })

  it('nothing at all with no project', () => {
    expect(renderToStaticMarkup(createElement(ScopeReadout, { r: null, owner: null, now: NOW }))).toBe('<div class="readout"></div>')
  })
})

describe('ScopeList (6.7)', () => {
  const projects = {
    glide: rec(),
    pin: rec({ id: 'pin', doc: { name: 'Homelab board', focus: true }, activity: { lastTouchedAt: new Date(NOW - 4 * DAY).toISOString() } }),
    old: rec({ id: 'old', doc: { name: 'Starmap' }, activity: { lastTouchedAt: new Date(NOW - 52 * DAY).toISOString() } }),
    arch: rec({ id: 'arch', doc: { name: 'Bus Stop', status: 'archived' } })
  }
  const html = renderToStaticMarkup(
    createElement(ScopeList, { board: { projects, owner: null, now: NOW }, selected: 'glide', hover: 'old', onHover: () => {}, onSelect: () => {}, onOpen: () => {} })
  )

  it('groups by ring with the headings of Pick up and the rim, nearest first, and no counts', () => {
    expect(text(html)).toBe('This week Cloud Glide 3d Homelab board 4d Earlier Starmap 7w Archived, on the rim Bus Stop')
  })

  it('the selected row is pressed, the hovered one marked, the far ones quiet', () => {
    expect(html).toMatch(/class="on" aria-pressed="true"[^>]*>.*?Cloud Glide/)
    expect(html).toMatch(/class="hov dim"/)
  })
})
