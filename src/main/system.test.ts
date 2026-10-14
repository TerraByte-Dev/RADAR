import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRecord, dataDir, projectId } from 'radar-blip'
import { findEditor, openInEditor, type Shell } from './system'
import { harness, isolate, project, tmp, v3 } from './testkit'

beforeEach(() => {
  isolate()
})

const shell = (): Shell => ({ openPath: vi.fn(async () => ''), showItemInFolder: vi.fn(), openExternal: vi.fn(async () => {}) })

/** A project holding editor and git stubs that each write a marker file when run. */
async function hostile(): Promise<{ dir: string; marker: string }> {
  const dir = await project(v3('Hostile'), 'hostile')
  const marker = join(dir, 'marker.txt')
  const cmd = `@echo off\r\necho ran> "${marker}"\r\n`
  for (const name of ['code.cmd', 'code.bat', 'cursor.cmd', 'git.cmd', 'git.bat']) writeFileSync(join(dir, name), cmd)
  // Not real programs; they only have to be the names a lookup in the folder would find.
  for (const name of ['code.exe', 'Code.exe', 'git.exe']) writeFileSync(join(dir, name), cmd)
  const sh = `#!/bin/sh\necho ran > "${marker}"\n`
  for (const name of ['code', 'git']) writeFileSync(join(dir, name), sh, { mode: 0o755 })
  return { dir, marker }
}

describe('open in editor (spec 8.6)', () => {
  it('never resolves to anything in a project folder or a relative PATH entry', async () => {
    const { dir } = await hostile()
    expect(findEditor(['.', 'hostile', '.\\hostile', dir].join(';'), 'win32', {})).toBeNull()
    expect(findEditor(['.', 'hostile', dir].join(':'), 'linux', {})?.exe ?? '').not.toContain(dir)
  })

  it('on Windows, code.cmd on PATH means the installed Code.exe beside its bin folder; the .cmd never runs', () => {
    const install = join(tmp(), 'Microsoft VS Code')
    mkdirSync(join(install, 'bin'), { recursive: true })
    writeFileSync(join(install, 'bin', 'code.cmd'), '')
    writeFileSync(join(install, 'Code.exe'), '')
    expect(findEditor(`C:\\nothing-here;${join(install, 'bin')}`, 'win32', {})).toEqual({ kind: 'vscode', exe: join(install, 'Code.exe') })

    const cursor = join(tmp(), 'cursor')
    mkdirSync(join(cursor, 'resources', 'app', 'bin'), { recursive: true })
    writeFileSync(join(cursor, 'resources', 'app', 'bin', 'cursor.cmd'), '')
    writeFileSync(join(cursor, 'Cursor.exe'), '')
    expect(findEditor(join(cursor, 'resources', 'app', 'bin'), 'win32', {})).toEqual({ kind: 'cursor', exe: join(cursor, 'Cursor.exe') })
  })

  it('an editor where its installer puts it wins over PATH, and needs no PATH at all', () => {
    const local = tmp()
    mkdirSync(join(local, 'Programs', 'Microsoft VS Code'), { recursive: true })
    writeFileSync(join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'), '')
    expect(findEditor('', 'win32', { LOCALAPPDATA: local })).toEqual({ kind: 'vscode', exe: join(local, 'Programs', 'Microsoft VS Code', 'Code.exe') })
    // A relative install root is never used.
    expect(findEditor('', 'win32', { LOCALAPPDATA: 'hostile' })).toBeNull()
  })

  it('an editor that lives inside the project being opened is never launched; the folder opens instead', async () => {
    const { dir } = await hostile()
    mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'bin', 'code.cmd'), '')
    // A PATH entry inside the project resolves, but opening that project refuses to run it.
    const editor = findEditor(join(dir, 'bin'), 'win32', {})
    expect(editor).toEqual({ kind: 'vscode', exe: join(dir, 'Code.exe') })
    const run = vi.fn(() => ({ unref: () => {}, on: () => {} }))
    const sh = shell()
    expect(await openInEditor(dir, sh, editor, run)).toBe('folder')
    expect(run).not.toHaveBeenCalled()
    expect(sh.openPath).toHaveBeenCalledWith(dir)
  })

  it.runIf(process.platform === 'win32')('a project editor reached by another spelling of the folder (8.3 name, \\?\ prefix) is never launched', async () => {
    const { dir } = await hostile()
    mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'bin', 'code.cmd'), '')
    // The temp folder's own long name gives the path an 8.3 spelling, where the volume makes them.
    const short = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), ['/d', '/c', `for %I in ("${dir}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true }).stdout.trim()
    const spellings = ['\\\\?\\' + dir, ...(short.toLowerCase() !== dir.toLowerCase() ? [short] : [])]
    const run = vi.fn(() => ({ unref: () => {}, on: () => {} }))
    const opened: string[] = []
    for (const spelling of spellings) {
      const editor = findEditor(join(spelling, 'bin'), 'win32', {})
      expect(editor?.kind).toBe('vscode')
      opened.push(`${spelling} -> ${await openInEditor(dir, shell(), editor, run)}`)
    }
    expect(opened).toEqual(spellings.map((s) => `${s} -> folder`))
    expect(run).not.toHaveBeenCalled()
  })

  it('launches the absolute editor with the project as one argument, from the data folder, without a shell', async () => {
    const dir = join(tmp(), 'name with spaces & ampersand')
    mkdirSync(dir)
    const exe = join(tmp(), 'Code.exe')
    writeFileSync(exe, '')
    const run = vi.fn(() => ({ unref: () => {}, on: () => {} }))
    const opened = await openInEditor(dir, shell(), { kind: 'vscode', exe }, run)
    expect(opened).toBe('vscode')
    expect(run).toHaveBeenCalledWith(exe, [dir], expect.objectContaining({ cwd: dataDir(), shell: false, windowsHide: true }))
  })

  it('the hijack fixture: open in editor and compute activity, and the marker is never created', async () => {
    const { dir, marker } = await hostile()
    const sep = process.platform === 'win32' ? ';' : ':'
    const saved = process.env.PATH
    // Relative entries first, as a hostile cwd would be reached; the real PATH stays so git is found.
    process.env.PATH = ['.', 'hostile', saved].join(sep)
    try {
      // Only the project folder and relative entries: a real editor on this machine must not open.
      const h = harness({ deps: { editor: findEditor(['.', 'hostile', dir].join(sep), process.platform, {}) } })
      const opened = await h.call('system.openInEditor', { id: projectId(dir) })
      expect(opened.ok).toBe(true)
      expect(opened.data.opened).toBe('folder')
      const r = await buildRecord(dir)
      expect(r.activity).not.toBeNull()
    } finally {
      process.env.PATH = saved
    }
    expect(existsSync(marker)).toBe(false)
  })
})
