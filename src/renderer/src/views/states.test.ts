// R8 (renderer spec 8, 8.1, 6.8, 13): each loading, empty and error state rendered from a fixture
// record, the read-only modes with their write controls absent, first run's checklist and the
// setup diff it shows, and Settings. First run against a real empty registry, and Cancel leaving
// settings.json byte-identical, run end to end in e2e/states.spec.ts.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Activity, BlipDoc, Check, ProjectRecord, Task } from '@shared/model'
import App from '../App'
import { problemLine } from '../components/Banner'
import { ProjectRow } from '../components/ProjectRow'
import { StatusBar } from '../components/StatusBar'
import { GIT_WARNING, localDate } from '../lib/derive'
import { canPrompt, canResume } from '../lib/projectActions'
import { reEntryPrompt } from '../lib/prompts'
import { claudeInstalled, firstRunChecklist, parseSetupDiff, setupRows } from '../lib/setup'
import { useBoard } from '../store/board'
import { useShell } from '../store/shell'
import { DiffBlocks, FirstRun } from './FirstRun'
import { PickUp } from './PickUp'
import { ProjectPage } from './ProjectPage'
import { Settings } from './Settings'

const NOW = new Date(2026, 9, 13, 14, 0).getTime()
const DAY = 86_400_000
const TODAY = localDate(NOW)
const text = (html: string): string =>
  html
    .replace(/<title>.*?<\/title>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

const task = (title: string, i = 0): Task => ({ key: `k${i}`, title, detail: [], due: null, done: false, doneOn: null, n: i + 1 })

interface Over {
  id?: string
  name?: string
  dir?: string
  state?: ProjectRecord['state']
  doc?: Partial<BlipDoc>
  activity?: Partial<Activity> | null
  hidden?: boolean
  days?: number
}

function rec(o: Over = {}): ProjectRecord {
  const open = o.doc?.tasks?.open ?? [task('Add elevation shading from the open terrain tiles'), task('Second step', 1)]
  const state = o.state ?? 'ok'
  const at = new Date(NOW - (o.days ?? 2) * DAY).toISOString()
  const doc: BlipDoc = {
    schema: state === 'needs-migrate' ? 2 : 3,
    name: o.name ?? 'Trail maps',
    nameSource: 'file',
    now: 'Tile cache works offline. Elevation shading is next.',
    status: 'active',
    focus: false,
    due: null,
    tags: ['personal'],
    links: [],
    tasks: { open, done: [] },
    next: open[0] ?? null,
    log: [],
    lastLogAt: null,
    problems: [],
    writable: state === 'ok',
    ...o.doc
  }
  const activity: Activity | null =
    o.activity === null
      ? null
      : {
          source: 'git',
          lastWorkAt: at,
          lastLogAt: null,
          lastSyncAt: null,
          lastTouchedAt: at,
          unlogged: false,
          drift: { since: null, commits: 0, files: null },
          git: { repoRoot: '/p', subpath: '', branch: 'main', head: 'abc1234', dirty: false, dirtyCount: 0, lastCommit: null },
          daily: null,
          computedAt: new Date(NOW).toISOString(),
          error: null,
          ...o.activity
        }
  return {
    id: o.id ?? 'trail',
    dir: o.dir ?? 'C:\\Work\\personal\\trail-maps',
    state,
    doc: state === 'missing' ? null : doc,
    activity: state === 'missing' ? null : activity,
    agent: { live: false, sessions: 0, lastSeenAt: null },
    hidden: o.hidden ?? false,
    rev: 'r'
  }
}

/** A file that cannot be parsed, as the board sends it: named after its folder, read-only, its problem on line 7. */
const broken = (): ProjectRecord =>
  rec({
    id: 'print',
    name: 'print-shop-api',
    dir: 'C:\\Work\\personal\\print-shop-api',
    state: 'needs-repair',
    activity: { source: 'files', git: null },
    doc: { problems: [{ code: 'yaml-invalid', severity: 'error', message: 'a mapping value is not allowed here', line: 7 }] }
  })

const board = (rs: ProjectRecord[], setup: Check[] | null = null): void =>
  useBoard.setState({ projects: Object.fromEntries(rs.map((r) => [r.id, r])), owner: 'Robin', now: NOW, status: 'ready', error: null, setup, info: null })
const render = (el: React.ReactElement): string => renderToStaticMarkup(el)
const row = (r: ProjectRecord, variant: 'full' | 'line' = 'full'): string =>
  render(createElement(ProjectRow, { r, variant, selected: false, owner: 'Robin', now: NOW, today: TODAY, onSelect: () => {} }))

const CHECKS: Check[] = [
  { id: 'cli', level: 'ok', message: 'C:\\Users\\you\\AppData\\Roaming\\radar-blip\\bin\\radar-blip.cmd (the app\'s shim)' },
  { id: 'node', level: 'ok', message: 'node 22.12.0' },
  { id: 'git', level: 'ok', message: 'C:\\Program Files\\Git\\cmd\\git.exe' },
  { id: 'skill-claude', level: 'ok', message: 'C:\\Users\\you\\.claude\\skills\\blip\\SKILL.md' },
  { id: 'skill-codex', level: 'ok', message: 'Codex is not installed here' },
  { id: 'hooks', level: 'ok', message: 'SessionStart, Stop, SessionEnd installed' },
  { id: 'registry', level: 'ok', message: '24 tracked, 0 hidden, 0 missing' }
]
const withCheck = (c: Check): Check[] => CHECKS.map((x) => (x.id === c.id ? c : x))

// rendered on the server, a zustand store answers its initial state; here it answers the current one
vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, get) => get())
beforeAll(() => {
  const error = console.error
  vi.spyOn(console, 'error').mockImplementation((msg: unknown, ...rest: unknown[]) => {
    if (!String(msg).includes('useLayoutEffect')) error(msg, ...rest)
  })
})
beforeEach(() => useShell.setState({ route: { view: 'pickup' }, back: [], selectedId: null, overlay: null, density: 'comfortable', recoveredSeen: false }))

describe('the board as a whole (section 8)', () => {
  it('starting: the top bar and the status bar only, no skeleton list', () => {
    useBoard.setState({ projects: {}, status: 'loading', error: null, setup: null })
    const html = render(createElement(App))
    expect(html).toMatch(/<main><\/main>/)
    expect(html).toContain('class="top"')
    expect(html).toContain('class="foot"')
  })

  it('projects.list failed: a centred panel with the reason and one ghost Try again', () => {
    useBoard.setState({ projects: {}, status: 'error', error: { code: 'E_IO', message: 'registry.json is locked.' }, setup: null })
    const html = render(createElement(App))
    expect(text(html)).toContain('RADAR could not read its project list. registry.json is locked. Try again')
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('btn pri')
  })

  it('no projects at all: first run, forced, without the status bar', () => {
    board([], CHECKS)
    useShell.setState({ route: { view: 'scope' } })
    const html = render(createElement(App))
    expect(text(html)).toContain('Nothing on the scope yet.')
    expect(html).not.toContain('class="foot"')
  })

  it('every project hidden or archived: Pick up with no strip, and the line that says where they are', () => {
    board([rec({ hidden: true }), rec({ id: 'old', name: 'Old site', doc: { status: 'archived' } })])
    const html = render(createElement(PickUp))
    // Settings lists hidden and missing projects, not archived ones: those are listed below (a spec deviation)
    expect(text(html)).toContain('Nothing on the board. Hidden projects are in Settings . Archived ones are listed below.')
    expect(html).not.toContain('class="cont')
    expect(text(html)).toContain('Archived: Old site')
  })

  it('a board of only missing projects says they are in Settings, and nothing about archived ones', () => {
    board([rec({ state: 'missing' })])
    const t = text(render(createElement(PickUp)))
    expect(t).toContain('Nothing on the board. Missing projects are in Settings .')
    expect(t).not.toMatch(/rchived/)
  })

  it('first run, forced: the top bar marks Pick up whatever route a key left behind', () => {
    board([], CHECKS)
    useShell.setState({ route: { view: 'log' } })
    const html = render(createElement(App))
    expect(html).toMatch(/aria-current="page"[^>]*>Pick up</)
    expect(html).not.toMatch(/aria-current="page"[^>]*>Log</)
  })

  it('the registry restored from its last good copy: one dismissible banner on Pick up', () => {
    board([rec()], withCheck({ id: 'registry', level: 'warn', message: 'registry.json could not be read; the previous copy was used; 1 tracked, 0 hidden, 0 missing' }))
    expect(text(render(createElement(PickUp)))).toContain('Your project list was restored from its last good copy. Dismiss')
    useShell.setState({ recoveredSeen: true })
    expect(text(render(createElement(PickUp)))).not.toContain('restored')
  })

  it('git not installed: said once, in the status bar, with a way to the details', () => {
    const html = render(createElement(StatusBar, { view: 'pickup', target: null, status: GIT_WARNING }))
    expect(text(html)).toBe('git was not found · recency is from file times · details')
  })
})

describe('rows (section 8)', () => {
  it('activity pending: two neutral bars, said in the row name, and the row still whole', () => {
    const html = row(rec({ activity: null }))
    expect(html).toMatch(/role="option"[^>]*aria-label="[^"]*Reading activity\."/)
    expect(html.match(/class="skel"/g)).toHaveLength(2)
    expect(text(html)).toContain('→ Add elevation shading from the open terrain tiles')
  })

  it('activity failed: the files glyph and the reason on line 2, the error in its title', () => {
    const html = row(rec({ activity: { source: 'files', git: null, error: 'git timed out' } }))
    expect(html).toContain('aria-label="from file times"')
    expect(html).toContain('<div class="l2" title="git timed out; using file times">git timed out</div>')
  })

  it('a file that cannot be parsed: the folder name, read-only, and the problem as its second line', () => {
    const t = text(row(broken()))
    expect(t).toContain('print-shop-api folder name read-only')
    expect(t).toContain('RADAR cannot read this BLIP.md, so it shows nothing from it and will not write to it.')
    expect(t).toContain('· Line 7: a mapping value is not allowed here')
  })

  it('a v2 file: the next step as usual and the v2 · read-only chip', () => {
    const t = text(row(rec({ state: 'needs-migrate' })))
    expect(t).toContain('Trail maps personal v2 · read-only')
    expect(t).toContain('→ Add elevation shading from the open terrain tiles')
  })

  it('a due date that passed renders nothing; one ahead renders on line 2', () => {
    expect(text(row(rec({ doc: { due: '2026-10-12' } })))).not.toMatch(/due|12 Oct/)
    expect(text(row(rec({ doc: { due: '2026-11-06' } })))).toContain('due 6 Nov')
  })
})

describe('the project page of a read-only file (section 8)', () => {
  const page = (r: ProjectRecord): string => {
    board([r])
    return render(createElement(ProjectPage, { id: r.id }))
  }

  it('cannot be parsed: the banner with Open in editor and Reveal; no card, no queue, no editors', () => {
    const html = page(broken())
    expect(text(html)).toContain(
      'This BLIP.md could not be read. Line 7: a mapping value is not allowed here. Nothing has been changed, and RADAR will not write to this file until it parses. Open in editor E Reveal'
    )
    expect(html).not.toContain('class="nextcard')
    expect(html).not.toContain('aria-label="Queue"')
    expect(html).not.toContain('aria-label="Yours to set"')
    expect(html).not.toContain('btn pri')
  })

  it('cannot be parsed: the engine message reads as one line, with no stray colon, line number or repeated read-only', () => {
    const p = {
      code: 'yaml-invalid',
      severity: 'error' as const,
      message: 'the frontmatter is not valid YAML (Nested mappings are not allowed in compact mappings at line 6, column 8:); the file is read-only until it is fixed',
      line: 7
    }
    expect(problemLine(p)).toBe('Line 7: the frontmatter is not valid YAML (Nested mappings are not allowed in compact mappings)')
  })

  it('cannot be parsed: the facts hand nothing from the file to an agent: no catch-up line or button, no parsed counts', () => {
    const r = broken()
    const html = page({ ...r, activity: { ...(r.activity as Activity), unlogged: true } })
    expect(text(html)).not.toMatch(/Catch-up prompt|since then|log entries|open, /)
    expect(text(html)).toContain('BLIP.md · v3')
  })

  it('a log with no entries that is behind the work does not say "since then"', () => {
    const html = page(rec({ activity: { unlogged: true } }))
    expect(text(html)).toContain('no entries yet There is work the log does not mention yet. Catch-up prompt L')
  })

  it('the keys that hand the file to an agent: no prompt from a broken file, no Resume on a v2 or broken one', () => {
    expect([canPrompt(rec()), canPrompt(rec({ state: 'needs-migrate' })), canPrompt(broken())]).toEqual([true, true, false])
    expect([canResume(rec()), canResume(rec({ state: 'needs-migrate' })), canResume(broken())]).toEqual([true, false, false])
    // and the prompt itself reads nothing from a file that could not be parsed
    const p = reEntryPrompt(broken())
    expect(p).toContain('Pick up print-shop-api in C:\\Work\\personal\\print-shop-api.')
    expect(p).not.toMatch(/Where it stands|Next step|Tile cache/)
    expect(reEntryPrompt(rec())).toContain('Where it stands: Tile cache works offline.')
  })

  it('written by a newer RADAR: the same layout, its own sentence', () => {
    const r = broken()
    const html = page({ ...r, doc: { ...(r.doc as BlipDoc), problems: [{ code: 'schema-newer', severity: 'error', message: 'newer', line: 2 }] } })
    expect(text(html)).toContain('This file was written by a newer RADAR. Update the app to edit it.')
  })

  it('v2: Copy the command is the one filled button; the write controls are not drawn, the two that only read stay', () => {
    const html = page(rec({ state: 'needs-migrate' }))
    expect(text(html)).toContain('This project is still in the v2 format. It is shown read-only. Run radar-blip migrate in a terminal to convert it; a backup is kept.')
    expect([...html.matchAll(/class="btn pri[^"]*"[^>]*><span>([^<]*)/g)].map((m) => m[1])).toEqual(['Copy the command'])
    expect(text(html)).toContain('Copy re-entry prompt C Open in editor E Mark done and Not now come back once the file is migrated.')
    expect(text(html)).not.toMatch(/Mark done X|Not now N|Add a task|Pin as focus|click to edit|Add an entry/)
    expect(html).not.toMatch(/role="checkbox"|role="switch"|<select|<input(?![^>]*aria-label="Filter tasks")/)
  })
})

describe('first run (8.1)', () => {
  it('step 1: the heading, the one filled button and five lines read from setup.status', () => {
    board([], withCheck({ id: 'hooks', level: 'fail', message: 'SessionStart is not installed: run radar-blip setup' }))
    const html = render(createElement(FirstRun))
    const t = text(html)
    expect(t).toContain('Nothing on the scope yet.')
    expect([...html.matchAll(/class="btn pri/g)]).toHaveLength(1)
    expect(t).toContain('Connect to Claude Code and find my projects ↵')
    expect(t).toContain('RADAR command line Bundled with the app. Nothing to install. ready')
    expect(t).toContain('git Found. Recency is read from your commits. found')
    expect(t).toContain('Three session hooks Edits settings.json. You see the exact diff and confirm before anything is written. will add')
    expect(t).toContain('Find my projects You pick one folder. RADAR lists every BLIP.md under it and you choose which to keep. next')
    expect(t).toContain('No BLIP.md yet? Start tracking a folder creates one.')
    // the empty scope: rings and their labels, no blip
    expect(text(html)).toContain('1 day 1 week 6 weeks')
    expect(html).not.toContain('class="blip')
  })

  it('without Claude Code the two lines that would add say they are skipped', () => {
    const none = withCheck({ id: 'skill-claude', level: 'ok', message: 'Claude Code is not installed here' })
    expect(claudeInstalled(none)).toBe(false)
    const lines = firstRunChecklist(none)
    expect(lines.filter((l) => l.text === 'Claude Code was not found; skipped.').map((l) => l.title)).toEqual(['The /blip skill for Claude Code', 'Three session hooks'])
  })

  it('git not found reads not found', () => {
    expect(firstRunChecklist(withCheck({ id: 'git', level: 'warn', message: 'git was not found' }))[1]).toMatchObject({ state: 'not found', done: false })
  })

  it('the setup diff, one block per file: settings.json with its counts, the skill as a new file, the PATH line', () => {
    const diff = [
      '--- C:\\Users\\you\\.claude\\settings.json',
      '+++ C:\\Users\\you\\.claude\\settings.json',
      '@@ -1,3 +1,5 @@',
      ' {',
      '   "hooks": {',
      '+    "SessionStart": [],',
      '+    "Stop": []',
      '-    "Old": []',
      ' }',
      'install  C:\\Users\\you\\.claude\\skills\\blip\\SKILL.md',
      'replace  C:\\Users\\you\\.codex\\prompts\\blip.md (the old file is kept as C:\\Users\\you\\.codex\\prompts\\blip.md.bak)',
      'path     put C:\\data\\bin first on your user Path (HKCU\\Environment)'
    ].join('\n')
    const files = parseSetupDiff(diff)
    expect(files.map((f) => [f.path, f.summary])).toEqual([
      ['C:\\Users\\you\\.claude\\settings.json', 'adds 2 lines, removes 1 line'],
      ['C:\\Users\\you\\.claude\\skills\\blip\\SKILL.md', 'new file'],
      ['C:\\Users\\you\\.codex\\prompts\\blip.md', 'replaces the old file, kept beside it'],
      ['put C:\\data\\bin first on your user Path (HKCU\\Environment)', 'PATH']
    ])
    expect(files[0]?.lines.map((l) => l.kind)).toEqual(['hunk', 'ctx', 'ctx', 'add', 'add', 'del', 'ctx'])
    // a removed line has its own class, so it cannot be read as a kept one
    const html = render(createElement(DiffBlocks, { files }))
    expect(html).toContain('<span class="del">-    &quot;Old&quot;: []</span>')
    expect(html).toContain('<span class="ctx"> {</span>')
    expect(parseSetupDiff('')).toEqual([])
    expect(parseSetupDiff('--- s\n+++ s\n@@ -1 +1,2 @@\n {\n+  "a": 1')[0]?.summary).toBe('adds 1 line, removes none')
  })
})

describe('Settings (6.8)', () => {
  it('hidden and missing projects, with their controls; no button is filled', () => {
    board(
      [
        rec({ id: 'old', name: 'Old portfolio', dir: 'C:\\Work\\personal\\old-portfolio', hidden: true }),
        rec({ id: 'wed', name: 'Wedding site', dir: 'E:\\Projects\\wedding-site', state: 'missing' }),
        rec()
      ],
      CHECKS
    )
    const html = render(createElement(Settings, {}))
    const t = text(html)
    expect(t).toContain('Old portfolio C:\\Work\\personal\\old-portfolio hidden Show on the board')
    expect(t).toContain('wedding-site BLIP.md is not at E:\\Projects\\wedding-site . A drive may be unplugged. Look again Stop tracking')
    expect(t).toContain('Find more projects Start tracking a folder')
    expect(t).not.toContain('Trail maps')
    expect(html).not.toContain('btn pri')
  })

  it('with nothing hidden or missing: one sentence and the two buttons', () => {
    board([rec()], CHECKS)
    expect(text(render(createElement(Settings, {})))).toContain('Every tracked project is on the board. Find more projects Start tracking a folder')
  })

  it('setup rows read setup.status: ready, found, installed with their paths', () => {
    board([rec()], CHECKS)
    const t = text(render(createElement(Settings, {})))
    expect(t).toContain('RADAR command line Bundled with the app. ready')
    expect(t).toContain('git Recency is read from your commits. found')
    expect(t).toContain('The /blip skill C:\\Users\\you\\.claude\\skills\\blip installed')
    expect(t).toContain('Three session hooks C:\\Users\\you\\.claude\\settings.json installed')
    expect(t).toContain('Run setup again')
    expect(t).toContain('Theme Follows the system until you choose. Dark Light T')
    expect(t).toContain('Density One line fits every project on one screen. Comfortable One line D')
  })

  it('a missing skill and failing hooks read not installed', () => {
    const rows = setupRows(
      withCheck({ id: 'skill-claude', level: 'fail', message: 'the /blip skill is not installed (C:\\x\\SKILL.md): run radar-blip setup' }).map((c) =>
        c.id === 'hooks' ? { ...c, level: 'fail' as const, message: 'SessionStart is not installed' } : c
      )
    )
    expect(rows.map((r) => r.state)).toEqual(['ready', 'found', 'not installed', 'not installed'])
  })
})
