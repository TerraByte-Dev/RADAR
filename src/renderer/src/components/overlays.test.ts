// R7 (renderer spec 9.2): the keys sheet draws every keymap row, and the palette with an empty
// query draws two groups: the first five of pickOrder, and the highlighted project's six actions.
// Typing, Tab and the keys are covered end to end in e2e/palette.spec.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BlipDoc, ProjectRecord, Task } from '@shared/model'
import { KEYMAP } from '../lib/keymap'
import { pickOrder, visible } from '../lib/derive'
import { KeysSheet } from './KeysSheet'
import { PaletteBox } from './Palette'

const NOW = new Date(2026, 9, 13, 14, 0).getTime()
const DAY = 86_400_000
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
const task = (title: string): Task => ({ key: title, title, detail: [], due: null, done: false, doneOn: null, n: 1 })

function rec(id: string, daysAgo: number, over: Partial<BlipDoc> = {}, live = false): ProjectRecord {
  const open = [task(`First step for ${id}`), task(`Second step for ${id}`)]
  const at = new Date(NOW - daysAgo * DAY).toISOString()
  return {
    id,
    dir: `C:\\Work\\${id}`,
    state: 'ok',
    doc: { schema: 3, name: id, nameSource: 'file', now: null, status: 'active', focus: false, due: null, tags: [], links: [], tasks: { open, done: [] }, next: open[0] ?? null, log: [], lastLogAt: null, problems: [], writable: true, ...over },
    activity: { source: 'git', lastWorkAt: at, lastLogAt: null, lastSyncAt: null, lastTouchedAt: at, unlogged: false, drift: { since: null, commits: 0, files: null }, git: null, daily: null, computedAt: at, error: null },
    agent: { live, sessions: live ? 1 : 0, lastSeenAt: null },
    hidden: false,
    rev: 'r'
  }
}

beforeAll(() => {
  const error = console.error.bind(console)
  vi.spyOn(console, 'error').mockImplementation((msg: unknown, ...rest: unknown[]) => {
    if (!String(msg).includes('useLayoutEffect')) error(msg, ...rest)
  })
})
afterAll(() => vi.restoreAllMocks())

describe('KeysSheet', () => {
  it('has as many rows as the keymap, grouped by scope', () => {
    const html = renderToStaticMarkup(createElement(KeysSheet))
    expect(html.match(/<dt>/g)).toHaveLength(KEYMAP.length)
    expect([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1])).toEqual(['Anywhere', 'A project', 'Project page', 'Scope'])
    expect(text(html)).toContain('Every key on this sheet comes from one table. A binding that is not here does not exist.')
  })
})

const RECS = [rec('Tidewatch', 0, {}, true), rec('Homelab board', 2, { focus: true }), rec('Harbor Lantern', 2), rec('Sketchpad', 2), rec('Cloud Glide', 3), rec('Inkwell', 5), rec('Marble Racer', 9)]

describe('Palette', () => {
  const html = (recs = RECS): string => {
    const b = { projects: Object.fromEntries(recs.map((r) => [r.id, r])), owner: 'Robin', now: NOW }
    const order = pickOrder(b)
    return renderToStaticMarkup(createElement(PaletteBox, { order, all: visible(b), opener: order[0] ?? null, now: NOW }))
  }
  const groups = (h: string): string[] => [...h.matchAll(/<div[^>]*class="gl[^"]*"[^>]*>(.*?)<\/div>/g)].map((m) => m[1] as string)
  const items = (h: string): string[] => [...h.matchAll(/role="option"[^>]*>(.*?)<\/li>/g)].map((m) => text(m[1] as string))

  it('with an empty query renders two groups: five projects in pick order, then the first one\'s six actions', () => {
    const h = html()
    expect(groups(h)).toEqual(['Jump to a project', 'Tidewatch'])
    expect(items(h)).toEqual([
      'Tidewatch live',
      'Homelab board 2d',
      'Harbor Lantern 2d',
      'Sketchpad 2d',
      'Cloud Glide 3d',
      'Open ↵',
      'Resume R',
      'Copy a re-entry prompt C',
      'Mark next step done X',
      'Not now: next step down one N',
      'Pin or unpin as focus F'
    ])
  })

  it('draws no action that cannot act: a read-only project offers no edits', () => {
    const r = RECS[0] as ProjectRecord
    const ro = { ...r, doc: { ...(r.doc as BlipDoc), writable: false } }
    expect(items(html([ro, ...RECS.slice(1)])).slice(5)).toEqual(['Open ↵', 'Resume R', 'Copy a re-entry prompt C', 'Open in editor E', 'Hide from the board H'])
  })

  it('shows no count of undone work', () => {
    expect(text(html())).not.toMatch(/\d+ (open|more|tasks|unlogged|left)|\+\d+|overdue/i)
  })
})
