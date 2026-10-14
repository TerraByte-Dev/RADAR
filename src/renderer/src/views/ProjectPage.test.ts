// R5 (renderer spec 6.5, 6.6, 13): the project page rendered to markup, on a 95-task fixture and a
// 1,200-character title. Five queue rows, then the expander; no position numbers; the queue size
// only in the File fact; a long title clamped with Show all and still whole in the page; the
// write controls absent from a read-only file. Keys, editors and the toasts run end to end in
// e2e/project.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BlipDoc, LogEntry, ProjectRecord, Task } from '@shared/model'
import { useBoard } from '../store/board'
import { useShell } from '../store/shell'
import { dropBefore, doneLabel, QUEUE_WINDOW } from '../components/Queue'
import { ProjectPage } from './ProjectPage'

const NOW = new Date(2026, 9, 13, 14, 0).getTime()
const DAY = 86_400_000
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
const task = (title: string, i: number, detail: string[] = []): Task => ({ key: `k${i}`, title, detail, due: null, done: false, doneOn: null, n: i + 1 })
const entry = (date: string, time: string | null, author: string, bullets: string[]): LogEntry => ({
  heading: `${date}${time ? ` ${time}` : ''} — ${author}`,
  date,
  time,
  author,
  lines: bullets.map((b) => `- ${b}`),
  bullets
})

/** A git project whose log is behind, with `n` open tasks, as Cloud Glide. */
function glide(n: number, over: Partial<BlipDoc> = {}, state: ProjectRecord['state'] = 'ok'): ProjectRecord {
  const open = Array.from({ length: n }, (_, i) =>
    task(i === 0 ? 'Stall and spin: lose lift, drop a wing, recover' : `Queue task number ${i + 1} of the test grid`, i, i === 1 ? ['Clamp climb rate in `flight/tuning.json`.'] : [])
  )
  const log = [
    entry('2026-10-10', '21:40', 'Robin + Claude', ['Committed the glider.', 'Split wind.']),
    entry('2026-10-04', '15:02', 'Robin + Claude', ['Rewrote lift.']),
    entry('2026-09-27', null, 'Robin + Codex', ['Added the parts list.']),
    entry('2026-09-21', null, 'Robin', ['Drew the valleys.']),
    entry('2026-05-02', null, 'Robin', ['Started.'])
  ]
  const doc: BlipDoc = {
    schema: 3,
    name: 'Cloud Glide',
    nameSource: 'file',
    now: 'The glider and the thermal model are committed and fly well at both frame rates.',
    status: 'active',
    focus: false,
    due: null,
    tags: ['games', 'flight'],
    links: [],
    tasks: { open, done: [{ ...task('Done one', 900), done: true, doneOn: '2026-10-01', n: null }] },
    next: open[0] ?? null,
    log,
    lastLogAt: new Date(2026, 9, 10, 21, 40).toISOString(),
    problems: [],
    writable: state === 'ok',
    ...over
  }
  const at = new Date(NOW - 3 * DAY).toISOString()
  return {
    id: 'glide',
    dir: 'C:\\Work\\games\\cloud-glide',
    state,
    doc,
    activity: {
      source: 'git',
      lastWorkAt: at,
      lastLogAt: doc.lastLogAt,
      lastSyncAt: null,
      lastTouchedAt: at,
      unlogged: true,
      drift: { since: doc.lastLogAt, commits: 3, files: null },
      git: { repoRoot: 'C:\\Work\\games\\cloud-glide', subpath: '', branch: 'main', head: '4f2a91c0ffee', dirty: false, dirtyCount: 0, lastCommit: null },
      daily: null,
      computedAt: at,
      error: null
    },
    agent: { live: false, sessions: 0, lastSeenAt: at },
    hidden: false,
    rev: 'r'
  }
}

function page(r: ProjectRecord): string {
  useBoard.setState({ projects: { [r.id]: r }, owner: 'Robin', now: NOW, status: 'ready' })
  return renderToStaticMarkup(createElement(ProjectPage, { id: r.id }))
}
const queueRows = (html: string): string[] => [...html.matchAll(/<li id="task-[^"]*"[^>]*>(.*?)<\/li>/g)].map((m) => text(m[1]!))

// rendered on the server, a zustand store answers its initial state; here it answers the current one
vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, get) => get())
beforeEach(() => useShell.setState({ queueOpen: {}, expanded: {} }))

describe('ProjectPage on a 95-task fixture', () => {
  it('five queue rows, then Show the rest of the queue; no position numbers', () => {
    const html = page(glide(95))
    const rows = queueRows(html)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toBe('Queue task number 2 of the test grid')
    for (const row of rows) expect(row).not.toMatch(/^\d|\b\d+\.\s/)
    expect(text(html)).toContain('Show the rest of the queue')
    expect(text(html)).toContain('Add a task A')
    expect(text(html)).toContain('Show done')
  })

  it('the queue size appears in exactly one place: the File fact', () => {
    const t = text(page(glide(95)))
    expect(t).toContain('BLIP.md · v3 95 open, 1 done, 5 log entries')
    expect(t.match(/\b9[45]\b/g)).toEqual(['95'])
    expect(t).not.toMatch(/\d+ (more|tasks|left|unlogged)|\+\d+|overdue/i)
  })

  it('the rest of the queue in place, all of it under QUEUE_WINDOW, and the first QUEUE_WINDOW past it', () => {
    useShell.setState({ queueOpen: { glide: true } })
    expect(queueRows(page(glide(95)))).toHaveLength(94)
    expect(queueRows(page(glide(QUEUE_WINDOW + 250)))).toHaveLength(QUEUE_WINDOW)
  })

  it('the next step whole, Mark done the one filled button, then Not now, Resume and Copy re-entry prompt', () => {
    const html = page(glide(95))
    expect(html).toContain('<h2>Stall and spin: lose lift, drop a wing, recover</h2>')
    expect([...html.matchAll(/class="btn pri/g)]).toHaveLength(1)
    expect(text(html)).toContain('Mark done X Not now N Resume R Copy re-entry prompt C Not now moves it down one. It never turns red.')
    expect(text(html)).toContain('Next step · an agent can start this')
  })

  it('the derived facts: last work, the log behind with its prompt, git, the agent, the folder', () => {
    const t = text(page(glide(7)))
    expect(t).toContain('Last work 3d · Sat 10 Oct')
    expect(t).toContain('Newest commit on any local branch.')
    expect(t).toContain('written 10 Oct 21:40 There is work since then that the log does not mention yet. Catch-up prompt L')
    expect(t).toContain('Git main · 4f2a91c')
    expect(t).toContain('Agent session none detected Last seen 3d ago.')
    expect(t).toContain('Folder C:\\Work\\games\\cloud-glide')
  })

  it('the session log: the newest four, the author only where it changes, then the earlier ones', () => {
    const t = text(page(glide(7)))
    expect(t).toContain('Session log last entry 10 Oct')
    expect(t).toContain('10 Oct 21:40 Robin + Claude Committed the glider. Split wind. 4 Oct 15:02 Rewrote lift. 27 Sep Robin + Codex')
    expect(t).toContain('1 earlier entry, back to May · show')
  })

  it('the crumb, the pin and yours to set; a passed due date reads none', () => {
    const t = text(page(glide(7, { due: '2026-10-01' })))
    expect(t).toContain('Pick up / games / cloud-glide')
    expect(t).toContain('Cloud Glide Pin as focus F')
    expect(t).toContain('Due none · set')
    expect(t).not.toContain('1 Oct')
  })
})

describe('a 1,200-character legacy title', () => {
  const LONG = `Rewrite the changelog page ${'and check every entry links to its release '.repeat(30)}`.slice(0, 1200)

  it('as the next step: clamped at three lines with Show all, and whole in the page', () => {
    expect(LONG).toHaveLength(1200)
    const r = glide(7)
    const open = [task(LONG, 0), ...(r.doc as BlipDoc).tasks.open.slice(1)]
    const html = page({ ...r, doc: { ...(r.doc as BlipDoc), tasks: { open, done: [] }, next: open[0] ?? null } })
    expect(html).toContain(`<h2 class="clamp">${LONG.trimEnd()}`)
    expect(text(html)).toContain('Written before titles had a length limit. Show all')
  })

  it('in the queue: clamped with Show all, and shown whole once expanded', () => {
    const r = glide(7)
    const open = [...(r.doc as BlipDoc).tasks.open]
    open[2] = task(LONG, 2)
    const doc = { ...(r.doc as BlipDoc), tasks: { open, done: [] } }
    const html = page({ ...r, doc })
    expect(html).toContain(`<span class="t clamp">${LONG.trimEnd()}`)
    useShell.setState({ expanded: { 'glide:k2:title': true } })
    const whole = page({ ...r, doc })
    expect(whole).toContain(`<span class="t">${LONG.trimEnd()}`)
    expect(text(whole)).toContain('Show less')
  })
})

describe('a read-only file', () => {
  it('draws no write control: no checkbox, no Mark done, no Not now, no Add a task, no editor', () => {
    const html = page(glide(7, {}, 'needs-migrate'))
    expect(html).not.toContain('role="checkbox"')
    // the one filled button is the banner's Copy the command (section 8)
    expect([...html.matchAll(/class="btn pri/g)]).toHaveLength(1)
    expect(text(html)).not.toMatch(/Mark done X|Not now N|Add a task|Pin as focus|click to edit|Add an entry/)
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('<select')
    expect(text(html)).toContain('Copy re-entry prompt C Open in editor E')
  })
})

describe('R5 review', () => {
  it('Show done dates a done task in the page voice, 1 Oct, not the ISO date', () => {
    // Show done is local state; the list is drawn here by its markup once opened, so check the helper the row uses
    expect(doneLabel('2026-10-01')).toBe('1 Oct')
  })

  it('a project with no tasks draws one Add a task, on the card', () => {
    const html = page(glide(0))
    expect(text(html).match(/Add a task A/g)).toHaveLength(1)
    expect(html).toMatch(/class="nextcard none"[^]*Add a task/)
  })

  it('the queue is a plain list: no listbox or option holding the checkboxes and buttons', () => {
    const html = page(glide(7))
    expect(html).not.toContain('role="listbox"')
    expect(html).not.toContain('role="option"')
    expect(html).toMatch(/<ul class="q" aria-label="Queue">/)
  })

  it('a field button names its value as well as the change', () => {
    const html = page(glide(7, { due: '2026-11-02' }))
    expect(html).toContain('aria-label="Name: Cloud Glide, change"')
    expect(html).toContain('aria-label="Due: 2 Nov, change"')
    expect(html).toContain('aria-label="Tags: games flight, change"')
    expect(html).toContain('aria-label="Links: none, change"')
  })

  it('while a write to the project is in flight, its write controls say aria-busy', () => {
    useShell.setState({ writing: { glide: true } })
    const html = page(glide(7))
    useShell.setState({ writing: {} })
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*><span>Mark done/)
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*><span>Not now/)
    expect(html).toMatch(/role="checkbox"[^>]*aria-busy="true"|aria-busy="true"[^>]*role="checkbox"/)
    expect(html).toMatch(/role="switch"[^>]*aria-busy="true"|aria-busy="true"[^>]*role="switch"/)
    expect(html).toMatch(/<select[^>]*aria-busy="true"/)
    expect(html).toMatch(/class="pin"[^>]*aria-busy="true"|aria-busy="true"[^>]*class="pin"/)
  })
})

describe('dropBefore', () => {
  const open = ['One', 'Two', 'Three', 'Four'].map((t, i) => task(t, i))
  it('a row dropped on the row below it lands after it: before the one after the target', () => {
    expect(dropBefore(open, open[1]!, open[2]!)?.title).toBe('Four')
    expect(dropBefore(open, open[1]!, open[3]!)).toBeNull()
  })
  it('a row dropped on a row above it lands before the target', () => {
    expect(dropBefore(open, open[3]!, open[1]!)?.title).toBe('Two')
  })
})
