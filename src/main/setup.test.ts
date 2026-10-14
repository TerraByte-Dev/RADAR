import { beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { ensure, type Targets } from 'radar-blip'
import { findNode, shimTarget } from './shim'
import { prependEntry } from './user-path'
import { SKILLS, harness, isolate, pathRecorder, project, tmp, v3 } from './testkit'

let data: string
beforeEach(() => {
  data = isolate()
})

/** Targets under a folder with a space in its name, with a Claude config folder present. */
function targets(): Targets {
  const root = join(tmp('radar-app-setup-'), 'a home')
  const t = { claudeDir: join(root, '.claude'), codexDir: join(root, '.codex'), dataDir: data, skillsDir: SKILLS }
  mkdirSync(t.claudeDir, { recursive: true })
  return t
}

/** A stand-in for the bundled CLI that reports what it was given, in a folder cmd.exe and sh would misread unquoted. */
function fakeCli(): string {
  const dir = join(tmp(), process.platform === 'win32' ? 'with space %PATH% & more' : "with space 'quote' $HOME")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'radar-blip.mjs')
  writeFileSync(file, 'console.log(JSON.stringify({ args: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null }))\n')
  return file
}

const shimFile = (): string => join(data, 'bin', process.platform === 'win32' ? 'radar-blip.cmd' : 'radar-blip')

/** Run the shim the way a hook entry does: through cmd.exe on Windows, sh elsewhere. */
function runShim(args: string[]): { args: string[]; runAsNode: string | null } {
  const file = shimFile()
  const r =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${file}" ${args.map((a) => `"${a}"`).join(' ')}"`], { encoding: 'utf8', windowsVerbatimArguments: true })
      : spawnSync('/bin/sh', ['-c', '"$0" "$@"', file, ...args], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}

const settings = (t: Targets): string => readFileSync(join(t.claudeDir, 'settings.json'), 'utf8')

describe('setup.status', () => {
  it('is the doctor report, every check by id', async () => {
    const t = targets()
    const r = await harness({ deps: { setup: { targets: t, path: pathRecorder(), shim: null } } }).call('setup.status')
    expect(r.ok).toBe(true)
    expect(r.data.checks.map((c: { id: string }) => c.id)).toEqual(['cli', 'node', 'git', 'skill-claude', 'skill-codex', 'hooks', 'registry', 'projects', 'worktrees', 'storage'])
    expect(r.data.checks.find((c: { id: string }) => c.id === 'skill-claude').level).toBe('fail')
  })

  it('a corrupt registry (8.5): recovered from the previous copy with registry = warn; with both unreadable, an empty list and a warning naming the file', async () => {
    const a = await project(v3('Alpha'), 'alpha')
    await project(v3('Beta'), 'beta') // registry.json.prev now lists only Alpha
    const t = targets()
    writeFileSync(join(data, 'registry.json'), '{ this is not json')
    const h = harness({ deps: { setup: { targets: t, path: pathRecorder(), shim: null } } })
    const registry = async (): Promise<{ level: string; message: string }> =>
      (await h.call('setup.status')).data.checks.find((c: { id: string }) => c.id === 'registry')
    expect((await h.call('projects.list')).data.projects.map((p: { dir: string }) => p.dir)).toEqual([a])
    expect(await registry()).toMatchObject({ level: 'warn', message: expect.stringContaining('the previous copy was used') })

    writeFileSync(join(data, 'registry.json.prev'), 'also not json')
    const lost = await registry()
    expect(lost.level).toBe('warn')
    expect(lost.message).toMatch(/^registry\.json and its previous copy could not be read /)
    expect(lost.message).toContain(join(data, 'registry.json'))
    expect((await harness().call('projects.list')).data.projects).toEqual([])
  })
})

describe('setup.run', () => {
  it('without apply shows the diff and writes nothing', async () => {
    const t = targets()
    const h = harness({ deps: { setup: { targets: t, path: pathRecorder(), shim: shimTarget(fakeCli(), process.execPath, dirname(process.execPath)) } } })
    const r = await h.call('setup.run', { apply: false })
    expect(r).toMatchObject({ ok: true, data: { applied: false } })
    expect(r.data.diff).toContain('hook session-start')
    expect(r.data.diff).toContain(`install  ${join(t.claudeDir, 'skills', 'blip', 'SKILL.md')}`)
    expect(r.data.diff).toContain(`write    ${shimFile()}`)
    // Spec 5.4: the PATH change is in the same diff; applying it is setup.path's.
    expect(r.data.diff.split('\n').at(-1)).toBe(`path     put ${join(data, 'bin')} first on your user Path`)
    expect(existsSync(join(t.claudeDir, 'settings.json'))).toBe(false)
    expect(existsSync(shimFile())).toBe(false)
  })

  it('with apply installs the skill, the hooks on the quoted shim and the shim itself, which runs the CLI; a second run has nothing to do', async () => {
    const t = targets()
    const pathBefore = process.env.PATH
    const cli = fakeCli()
    const h = harness({ deps: { setup: { targets: t, path: pathRecorder(join(data, 'bin')), shim: shimTarget(cli, 'unused', dirname(process.execPath)) } } })
    const r = await h.call('setup.run', { apply: true })
    expect(r).toMatchObject({ ok: true, data: { applied: true } })
    expect(settings(t)).toContain(`"\\"${shimFile().replace(/\\/g, '/')}\\" hook stop"`)
    expect(r.data.report.find((c: { id: string }) => c.id === 'hooks').level).toBe('ok')
    expect(r.data.report.find((c: { id: string }) => c.id === 'skill-claude').level).toBe('ok')
    expect(runShim(['hook', 'stop', 'two words'])).toEqual({ args: ['hook', 'stop', 'two words'], runAsNode: null })

    const again = await h.call('setup.run', { apply: true })
    expect(again).toMatchObject({ ok: true, data: { applied: false, diff: '' } })
    // Setup never edits PATH; that is its own confirmation.
    expect(process.env.PATH).toBe(pathBefore)
  })

  it('a settings.json that is not JSON: E_SETTINGS_INVALID and nothing written', async () => {
    const t = targets()
    writeFileSync(join(t.claudeDir, 'settings.json'), '{ nope')
    const r = await harness({ deps: { setup: { targets: t, path: pathRecorder(), shim: null } } }).call('setup.run', { apply: true })
    expect(r).toMatchObject({ ok: false, error: { code: 'E_SETTINGS_INVALID' } })
    expect(settings(t)).toBe('{ nope')
  })
})

describe('a dev run (no shim)', () => {
  it('refuses apply in setup.run and setup.path with E_DEV unless CLAUDE_CONFIG_DIR and RADAR_BLIP_HOME are both set; the plans still show', async () => {
    const t = targets() // explicit throwaway targets: nothing real is read or written even if the guard failed
    const path = pathRecorder()
    const h = harness({ deps: { setup: { targets: t, shim: null, path } } })
    const saved = process.env.CLAUDE_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    try {
      expect(await h.call('setup.run', { apply: true })).toMatchObject({ ok: false, error: { code: 'E_DEV' } })
      expect(await h.call('setup.path', { apply: true })).toMatchObject({ ok: false, error: { code: 'E_DEV' } })
      expect(existsSync(join(t.claudeDir, 'settings.json'))).toBe(false)
      expect(path.applied).toEqual([])
      expect(await h.call('setup.run', { apply: false })).toMatchObject({ ok: true, data: { applied: false } })
      expect(await h.call('setup.path', { apply: false })).toMatchObject({ ok: true, data: { applied: false } })
    } finally {
      process.env.CLAUDE_CONFIG_DIR = saved
    }
    // Both overridden (as isolate() does): a dev run may apply to those folders.
    expect(await h.call('setup.run', { apply: true })).toMatchObject({ ok: true, data: { applied: true } })
  })
})

describe('the shim', () => {
  it('without a node on PATH runs the app itself as node', async () => {
    const t = targets()
    // process.execPath stands in for the app executable; ELECTRON_RUN_AS_NODE is inert for node.
    const target = shimTarget(fakeCli(), process.execPath, '')
    expect(target.electron).toBe(true)
    await harness({ deps: { setup: { targets: t, path: pathRecorder(), shim: target } } }).call('setup.run', { apply: true })
    expect(runShim(['status'])).toEqual({ args: ['status'], runAsNode: '1' })
  })

  it('setup.ensure() on start follows a moved CLI; the shim path and the hook entries stay as they were', async () => {
    const t = targets()
    await harness({ deps: { setup: { targets: t, path: pathRecorder(), shim: shimTarget(fakeCli(), 'unused', dirname(process.execPath)) } } }).call('setup.run', { apply: true })
    const hooks = settings(t)
    const moved = fakeCli()
    expect(await ensure(t, shimTarget(moved, 'unused', dirname(process.execPath)))).toBe(true)
    expect(readFileSync(shimFile(), 'utf8')).toContain(dirname(moved).split('%').join('%%').split("'").join("'\\''"))
    expect(settings(t)).toBe(hooks)
    expect(await ensure(t, shimTarget(moved, 'unused', dirname(process.execPath)))).toBe(false)
  })

  it('setup.ensure() with nothing installed writes nothing', async () => {
    const t = targets()
    expect(await ensure(t, shimTarget(fakeCli(), process.execPath))).toBe(false)
    expect(existsSync(shimFile())).toBe(false)
    expect(existsSync(join(t.claudeDir, 'settings.json'))).toBe(false)
  })

  it('skips a node older than the engine needs, and setup.status judges the node the shim will run', async () => {
    const exe = process.platform === 'win32' ? 'node.exe' : 'node'
    const dirs = ['old', 'unreadable', 'new'].map((n) => {
      const d = join(tmp(), n)
      mkdirSync(d)
      writeFileSync(join(d, exe), '') // never run: the version comes from the stand-in below
      return d
    })
    const versions: Record<string, string | null> = { old: 'v18.20.4', unreadable: null, new: 'v22.12.0' }
    const versionOf = (p: string): string | null => versions[basename(dirname(p))] ?? null
    const pathEnv = dirs.join(process.platform === 'win32' ? ';' : ':')
    expect(findNode(pathEnv, process.platform, versionOf)).toEqual({ path: join(dirs[2], exe), version: 'v22.12.0' })
    expect(findNode(dirs.slice(0, 2).join(process.platform === 'win32' ? ';' : ':'), process.platform, versionOf)).toBeNull()

    const target = shimTarget(fakeCli(), process.execPath, dirs[0], process.platform, versionOf)
    expect(target).toMatchObject({ runtime: process.execPath, electron: true, nodeVersion: process.versions.node })
    const node = async (shim: ReturnType<typeof shimTarget>): Promise<unknown> =>
      (await harness({ deps: { setup: { targets: targets(), path: pathRecorder(), shim } } }).call('setup.status')).data.checks.find((c: { id: string }) => c.id === 'node')
    expect(await node(shimTarget(fakeCli(), 'unused', pathEnv, process.platform, versionOf))).toEqual({ id: 'node', level: 'ok', message: 'node v22.12.0' })
    expect(await node({ ...target, nodeVersion: 'v18.20.4' })).toMatchObject({ id: 'node', level: 'fail' })
  })

  it('never takes node from a relative PATH entry', () => {
    expect(findNode('.;node_modules\\.bin;bin', 'win32')).toBeNull()
    expect(findNode('.:bin', 'linux')).toBeNull()
    expect(findNode(dirname(process.execPath), process.platform)).toEqual({ path: process.execPath, version: process.version })
  })
})

describe('setup.path: the one route that edits PATH, and only when asked', () => {
  it('without apply says what it would change and changes nothing; with apply adds <data>/bin once', async () => {
    const t = targets()
    const path = pathRecorder('%USERPROFILE%\\bin;C:\\Tools')
    const h = harness({ deps: { setup: { targets: t, shim: null, path } } })
    const bin = join(data, 'bin')
    const look = await h.call('setup.path', { apply: false })
    expect(look).toEqual({ ok: true, data: { change: `put ${bin} first on your user Path`, applied: false } })
    expect(path.applied).toEqual([])

    expect(await h.call('setup.path', { apply: true })).toMatchObject({ ok: true, data: { applied: true } })
    expect(path.value).toBe(`${bin};%USERPROFILE%\\bin;C:\\Tools`)
    expect(await h.call('setup.path', { apply: true })).toEqual({ ok: true, data: { change: null, applied: false } })
    expect(path.applied).toEqual([bin])
  })

  it('setup.run never reaches it', async () => {
    const path = pathRecorder()
    const h = harness({ deps: { setup: { targets: targets(), shim: shimTarget(fakeCli(), process.execPath), path } } })
    await h.call('setup.run', { apply: true })
    expect(path.applied).toEqual([])
  })

  it('prependEntry keeps every other byte, and finds the folder already there in any spelling', () => {
    expect(prependEntry('', 'C:\\d\\bin')).toBe('C:\\d\\bin')
    expect(prependEntry('C:\\a;;%X%\\b;', 'C:\\d\\bin')).toBe('C:\\d\\bin;C:\\a;;%X%\\b;')
    expect(prependEntry('C:\\a;"c:\\D\\Bin\\"', 'C:\\d\\bin')).toBeNull()
  })
})
