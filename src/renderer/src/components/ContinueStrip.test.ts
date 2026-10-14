// R4 (renderer spec 6.1, 6.3, 6.4): the Continue strip's three states and its empty line, the
// rule lines, Pick one for me's card and the digest, rendered to markup. Sizes, focus and the
// keys are covered end to end in e2e/continue.spec.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BlipDoc, ProjectRecord, Task } from '@shared/model'
import type { DigestLine } from '../lib/derive'
import { useShell } from '../store/shell'
import { ContinueStrip, RuleLine } from './ContinueStrip'
import { Digest, SinceLine } from './Digest'

const NOW = new Date(2026, 9, 13, 14, 0).getTime()
const DAY = 86_400_000
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const task = (title: string, detail: string[] = []): Task => ({ key: title, title, detail, due: null, done: false, doneOn: null, n: 1 })

function rec(id: string, over: Partial<BlipDoc> = {}, live = false, daysAgo = 0): ProjectRecord {
  const open = [task('Build the small widget on feat/widget-view', ['Start from `docs/widget-sizes.md`, smallest first.', 'Second line.'])]
  const doc: BlipDoc = {
    schema: 3,
    name: id,
    nameSource: 'file',
    now: 'The home-screen widget is the open front.',
    status: 'active',
    focus: false,
    due: null,
    tags: ['sites'],
    links: [],
    tasks: { open, done: [] },
    next: open[0] ?? null,
    log: [],
    lastLogAt: null,
    problems: [],
    writable: true,
    ...over
  }
  const at = new Date(NOW - daysAgo * DAY).toISOString()
  return {
    id,
    dir: `C:\\Work\\${id}`,
    state: 'ok',
    doc,
    activity: {
      source: 'git',
      lastWorkAt: at,
      lastLogAt: null,
      lastSyncAt: null,
      lastTouchedAt: at,
      unlogged: false,
      drift: { since: null, commits: 0, files: null },
      git: null,
      daily: null,
      computedAt: at,
      error: null
    },
    agent: { live, sessions: live ? 1 : 0, lastSeenAt: null },
    hidden: false,
    rev: 'r'
  }
}

const strip = (order: ProjectRecord[], muted = false, owner: string | null = 'Robin'): string =>
  renderToStaticMarkup(createElement(ContinueStrip, { order, owner, now: NOW, muted }))
/** The buttons in order, each as `label[caps]`, with `*` on the filled one. */
const buttons = (html: string): string[] =>
  [...html.matchAll(/<button type="button" class="([^"]*)"[^>]*>(.*?)<\/button>/g)]
    .filter((m) => m[1]!.includes('btn'))
    .map((m) => `${m[1]!.split(' ').includes('pri') ? '*' : ''}${text(m[2]!.replace(/<kbd>(.*?)<\/kbd>/g, '[$1]')).replace(/ \[/g, '[')}`)

// the detail fit is a layout effect, which React warns of on the server; only that warning is hidden
beforeAll(() => {
  const error = console.error.bind(console)
  vi.spyOn(console, 'error').mockImplementation((msg: unknown, ...rest: unknown[]) => {
    if (!String(msg).includes('useLayoutEffect')) error(msg, ...rest)
  })
})
afterAll(() => vi.restoreAllMocks())

describe('ContinueStrip', () => {
  it('nothing in the way: Resume is filled, and the label says the start cost', () => {
    const html = strip([rec('Homelab board', {}, false, 0.2)])
    expect(buttons(html)).toEqual(['*Resume[R]', 'Copy re-entry prompt[C]', 'Pick one for me[P]'])
    expect(text(html)).toMatch(/^Continue · last work today Homelab board The home-screen widget is the open front\. Next step · an agent can start this →/)
  })

  it('an agent is in there now: Open is filled, and the name says session live', () => {
    const html = strip([rec('Tidewatch', { focus: true }, true)])
    expect(buttons(html)).toEqual(['*Open[↵]', 'Copy re-entry prompt[C]', 'Pick one for me[P]'])
    expect(text(html)).toContain('Tidewatch session live')
    expect(text(html)).toContain('Next step · an agent is in here now')
    expect(html).toContain('class="dia"')
  })

  it('waiting: Open is a ghost and Pick one for me takes the fill; the waiting chip is quiet', () => {
    const html = strip([rec('Inkwell', { status: 'blocked' }, false, 5)])
    expect(buttons(html)).toEqual(['Open[↵]', 'Copy re-entry prompt[C]', '*Pick one for me[P]'])
    expect(html).toContain('<span class="chip q">waiting</span>')
    expect(text(html)).toContain('Continue · last work 5d ago')
  })

  it('a selected row or an open overlay takes the fill; buttons 1 and 2 lose their keys, Pick keeps P', () => {
    expect(buttons(strip([rec('a', {}, true)], true))).toEqual(['Open', 'Copy re-entry prompt', 'Pick one for me[P]'])
    expect(buttons(strip([rec('a', { status: 'blocked' })], true))).toEqual(['Open', 'Copy re-entry prompt', 'Pick one for me[P]'])
  })

  it('the title whole and the first detail line verbatim, code spans styled', () => {
    const html = strip([rec('a')])
    expect(html).toContain('<h3>Build the small widget on feat/widget-view</h3>')
    expect(html).toContain('<p class="dl">Start from <code>docs/widget-sizes.md</code>, smallest first.</p>')
    expect(html).not.toContain('Second line')
  })

  it('a legacy title past 80 characters is clamped with a visible Show all', () => {
    const long = 'x'.repeat(81)
    const html = strip([rec('a', { next: task(long), tasks: { open: [task(long)], done: [] } })])
    expect(html).toContain(`<h3 class="clamp">${long}</h3>`)
    expect(text(html)).toContain('Written before titles had a length limit. Show all')
  })

  it('without an owner the label is only "Next step", but an agent in there is still said', () => {
    expect(text(strip([rec('a')], false, null))).toContain('Next step →')
    expect(text(strip([rec('a', {}, true)], false, null))).toContain('Next step · an agent is in here now')
  })

  it('nothing queued anywhere: one line, no filled button', () => {
    const html = strip([])
    expect(text(html)).toBe('Nothing queued anywhere. Open a project and add a task, or ask an agent to.')
    expect(html).not.toContain('pri')
  })
})

describe('RuleLine', () => {
  it('prints the one order, short under the strip and long in the popover', () => {
    expect(text(renderToStaticMarkup(createElement(RuleLine)))).toBe('Order: last worked on, then your pins, then this week.')
    expect(text(renderToStaticMarkup(createElement(RuleLine, { long: true })))).toBe(
      'One order: the project last worked on, then your focus pins, then the rest of this week. Continue shows the first. Pick one for me deals the next, steps an agent can start before steps that need you.'
    )
  })
})

describe('the digest', () => {
  const SAT = new Date(2026, 9, 10, 12, 0).getTime()
  const line = (name: string): DigestLine => ({ id: name, name, text: `${name} moved.`, day: 'Sun', at: NOW - DAY })
  const since = (n: number): string => text(renderToStaticMarkup(createElement(SinceLine, { lines: ['A', 'B', 'C', 'D'].slice(0, n).map(line), since: SAT })))

  it('the rail block names the weekday last here and one line per project', () => {
    const html = renderToStaticMarkup(createElement(Digest, { lines: [line('Homelab board')], since: SAT }))
    expect(text(html)).toBe('Since you were last here Saturday Homelab board Homelab board moved. Sun')
  })

  it('the since line names up to three, then "and others"', () => {
    useShell.setState({ sinceOpen: false })
    expect(since(1)).toBe('Since Saturday: A moved. show')
    expect(since(2)).toBe('Since Saturday: A and B moved. show')
    expect(since(3)).toBe('Since Saturday: A , B and C moved. show')
    expect(since(4)).toBe('Since Saturday: A , B , C and others moved. show')
  })

  it('renders nothing with nothing to say', () => {
    expect(renderToStaticMarkup(createElement(Digest, { lines: [], since: SAT }))).toBe('')
    expect(since(0)).toBe('')
  })
})
