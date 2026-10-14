// What first run (renderer spec 8.1) and Settings (6.8) say about setup: the checklist and the
// Setup rows read from `setup.status`, and the diff `setup.run { apply: false }` answers, cut
// into one block per file. Pure: no route is called here.
import type { Check } from '@shared/model'

export interface SetupLine {
  title: string
  text: string
  /** The mono state word. */
  state: string
  /** Ticked: there is nothing left to do for it. */
  done: boolean
  /** The text is a path, set in mono. */
  path?: boolean
}

const find = (checks: Check[] | null, id: string): Check | undefined => checks?.find((c) => c.id === id)
const ok = (c: Check | undefined): boolean => c?.level === 'ok'

/** Whether Claude Code is on this machine: the skill check says so when it is not. */
export const claudeInstalled = (checks: Check[] | null): boolean => !/not installed here/.test(find(checks, 'skill-claude')?.message ?? '')

/** The skill's file, from the skill check (its message is the path when it is installed). */
const skillFile = (checks: Check[] | null): string | null => {
  const c = find(checks, 'skill-claude')
  return ok(c) && c && /SKILL\.md$/i.test(c.message) ? c.message : null
}
const parent = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')

/** First run's five lines (8.1, step 1). */
export function firstRunChecklist(checks: Check[] | null): SetupLine[] {
  const claude = claudeInstalled(checks)
  const skipped = 'Claude Code was not found; skipped.'
  const cli = find(checks, 'cli')
  const git = find(checks, 'git')
  const skill = find(checks, 'skill-claude')
  const hooks = find(checks, 'hooks')
  return [
    ok(cli)
      ? { title: 'RADAR command line', text: 'Bundled with the app. Nothing to install.', state: 'ready', done: true }
      : { title: 'RADAR command line', text: 'Bundled with the app. Setup links it.', state: 'will add', done: false },
    ok(git) || !git
      ? { title: 'git', text: 'Found. Recency is read from your commits.', state: 'found', done: true }
      : { title: 'git', text: 'Not found. Recency is read from file times instead.', state: 'not found', done: false },
    !claude
      ? { title: 'The /blip skill for Claude Code', text: skipped, state: 'skipped', done: false }
      : ok(skill)
        ? { title: 'The /blip skill for Claude Code', text: 'Installed under your Claude config.', state: 'ready', done: true }
        : { title: 'The /blip skill for Claude Code', text: 'Adds one file under your Claude config.', state: 'will add', done: false },
    !claude
      ? { title: 'Three session hooks', text: skipped, state: 'skipped', done: false }
      : ok(hooks)
        ? { title: 'Three session hooks', text: 'Installed in your Claude Code settings.', state: 'ready', done: true }
        : {
            title: 'Three session hooks',
            text: 'Edits settings.json. You see the exact diff and confirm before anything is written.',
            state: 'will add',
            done: false
          },
    { title: 'Find my projects', text: 'You pick one folder. RADAR lists every BLIP.md under it and you choose which to keep.', state: 'next', done: false }
  ]
}

/** Settings' Setup rows (6.8): what the agent loop needs, each with its state word. */
export function setupRows(checks: Check[] | null): SetupLine[] {
  const claude = claudeInstalled(checks)
  const cli = find(checks, 'cli')
  const git = find(checks, 'git')
  const skill = find(checks, 'skill-claude')
  const hooks = find(checks, 'hooks')
  const file = skillFile(checks)
  const settings = file ? `${parent(parent(parent(file)))}${file.includes('\\') ? '\\' : '/'}settings.json` : null
  return [
    // a warning is the command not linked yet; a failure (an old v2 command first on PATH) says what to remove
    ok(cli) || !cli
      ? { title: 'RADAR command line', text: 'Bundled with the app.', state: 'ready', done: true }
      : {
          title: 'RADAR command line',
          text: cli.level === 'fail' ? cli.message : 'Bundled with the app. Run setup again to link it.',
          state: 'not installed',
          done: false
        },
    ok(git) || !git
      ? { title: 'git', text: 'Recency is read from your commits.', state: 'found', done: true }
      : { title: 'git', text: 'Recency is read from file times.', state: 'not found', done: false },
    !claude
      ? { title: 'The /blip skill', text: 'Claude Code was not found.', state: 'not installed', done: false }
      : file
        ? { title: 'The /blip skill', text: parent(file), state: 'installed', done: true, path: true }
        : { title: 'The /blip skill', text: skill?.message ?? 'Not installed.', state: 'not installed', done: false },
    !claude
      ? { title: 'Three session hooks', text: 'Claude Code was not found.', state: 'not installed', done: false }
      : ok(hooks)
        ? settings
          ? { title: 'Three session hooks', text: settings, state: 'installed', done: true, path: true }
          : { title: 'Three session hooks', text: 'Session start, stop and end.', state: 'installed', done: true }
        : { title: 'Three session hooks', text: hooks?.message ?? 'Not installed.', state: 'not installed', done: false }
  ]
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
}

export interface DiffFile {
  /** The file's full path, or for the PATH change the sentence that says what changes. */
  path: string
  /** `adds 12 lines, removes none`, `new file`, … */
  summary: string
  /** The unified diff; empty for a file shown by its header alone. */
  lines: DiffLine[]
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * The diff `setup.run` answers (describePlan in the engine): settings.json as a unified diff, then
 * one line per skill file (`install`, `replace`, `remove`), the shim (`write`) and the PATH change
 * (`path`). One block per file, in that order.
 */
export function parseSetupDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let cur: DiffFile | null = null
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('--- ')) {
      cur = { path: line.slice(4), summary: '', lines: [] }
      files.push(cur)
      continue
    }
    if (line.startsWith('+++ ')) continue
    const m = /^(install|replace|remove|write|path)\s+(.*)$/.exec(line)
    if (m) {
      cur = null
      const [, verb, rest] = m as unknown as [string, string, string]
      if (verb === 'replace') {
        const kept = /^(.*) \(the old file is kept as (.*)\)$/.exec(rest)
        files.push({ path: kept?.[1] ?? rest, summary: 'replaces the old file, kept beside it', lines: [] })
      } else if (verb === 'remove') files.push({ path: rest, summary: 'removed', lines: [] })
      else if (verb === 'path') files.push({ path: rest, summary: 'PATH', lines: [] })
      else files.push({ path: rest, summary: 'new file', lines: [] })
      continue
    }
    if (!cur) continue
    if (line.startsWith('@@')) cur.lines.push({ kind: 'hunk', text: line })
    else if (line.startsWith('+')) cur.lines.push({ kind: 'add', text: line })
    else if (line.startsWith('-')) cur.lines.push({ kind: 'del', text: line })
    else if (line.startsWith(' ')) cur.lines.push({ kind: 'ctx', text: line })
  }
  for (const f of files) {
    if (f.summary) continue
    const adds = f.lines.filter((l) => l.kind === 'add').length
    const dels = f.lines.filter((l) => l.kind === 'del').length
    f.summary = `adds ${plural(adds, 'line')}, removes ${dels ? plural(dels, 'line') : 'none'}`
  }
  return files
}
