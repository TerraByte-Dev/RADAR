// Putting `<data>/bin` on the user's PATH (spec 5.4): part of setup's one explicit
// confirmation, reached only through the `setup.path` route, never at start and never in
// a test (the suites hand the route a recorder instead).
import { execFile } from 'node:child_process'
import { lstat, mkdir, readlink, rename, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export interface PathEditor {
  /** What adding `bin` would change, as one line a person reads; null when it is already there. */
  plan(bin: string): Promise<string | null>
  /** Make that change. False when it is not one the app can make (the line says what to do by hand). */
  apply(bin: string): Promise<boolean>
}

const norm = (p: string): string => resolve(p.trim().replace(/^"(.*)"$/, '$1')).replace(/[\\/]+$/, '').toLowerCase()

/** The user Path with `bin` first; null when it is already one of its entries. Every other byte stays. */
export function prependEntry(value: string, bin: string): string | null {
  if (value.split(';').some((e) => e.trim() && norm(e) === norm(bin))) return null
  return value ? `${bin};${value}` : bin
}

// The value is read and written with its own type (REG_EXPAND_SZ keeps %USERPROFILE% entries
// unexpanded); removing a variable that is not there makes .NET broadcast WM_SETTINGCHANGE, so
// shells started afterwards see the new Path without a sign-out. The value goes in through the
// environment, never through the script text, and comes out as base64 of its UTF-16 bytes:
// PowerShell's stdout is in the console codepage, which cannot carry every character a path can.
const PS_READ = `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
$v = $k.GetValue('Path', '', 'DoNotExpandEnvironmentNames')`
const PS_WRITE = `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$kind = if ($k.GetValueNames() -contains 'Path') { $k.GetValueKind('Path') } else { 'ExpandString' }
$k.SetValue('Path', $env:RADAR_PATH_VALUE, $kind)
[Environment]::SetEnvironmentVariable('RADAR_BLIP_PATH_NOTIFY', $null, 'User')`

function powershell(script: string, env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((done, fail) =>
    execFile(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, ...env }, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => (err ? fail(err) : done(stdout))
    )
  )
}

/** The string `$v` holds once `script` has run, every character intact. */
export const psString = async (script: string, env: NodeJS.ProcessEnv = {}): Promise<string> =>
  Buffer.from(await powershell(`${script}\n[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([string]$v)))`, env), 'base64').toString('utf16le')

export interface UserPathValue {
  read(): Promise<string>
  write(value: string): Promise<void>
}

const registry: UserPathValue = {
  read: () => psString(PS_READ),
  write: async (value) => void (await powershell(PS_WRITE, { RADAR_PATH_VALUE: value }))
}

/**
 * Windows: the user `Path` value under HKCU\Environment. The value it replaces is kept first in
 * `<data>/path.radar-bak` (`bin` is `<data>/bin`).
 */
export function windowsPath(value: UserPathValue = registry): PathEditor {
  return {
    async plan(bin) {
      return prependEntry(await value.read(), bin) === null ? null : `put ${bin} first on your user Path (HKCU\\Environment)`
    },
    async apply(bin) {
      const before = await value.read()
      const next = prependEntry(before, bin)
      if (next !== null) {
        await mkdir(dirname(bin), { recursive: true })
        await writeFile(join(dirname(bin), 'path.radar-bak'), before, 'utf8')
        await value.write(next)
      }
      return true
    }
  }
}

/** macOS and Linux: a link in ~/.local/bin when that folder is on PATH; otherwise the line to add by hand. */
export function posixPath(home = homedir(), pathEnv = process.env.PATH ?? ''): PathEditor {
  const local = join(home, '.local', 'bin')
  const link = join(local, 'radar-blip')
  const onPath = pathEnv.split(':').some((e) => e && norm(e) === norm(local))
  /** What is at the link now: 'ours', 'other' (a file, or a link elsewhere, such as an old global v2 install) or 'none'. */
  const current = async (bin: string): Promise<'ours' | 'other' | 'none'> =>
    lstat(link).then(
      async (s) => (s.isSymbolicLink() && norm(await readlink(link)) === norm(join(bin, 'radar-blip')) ? 'ours' : 'other'),
      () => 'none' as const
    )
  return {
    async plan(bin) {
      if (!onPath) return `add this line to your shell profile: export PATH="${bin}:$PATH"`
      const now = await current(bin)
      if (now === 'ours') return null
      return now === 'other'
        ? `replace ${link} with a link to ${join(bin, 'radar-blip')} (the old one is kept as radar-blip.bak-<time>)`
        : `link ${link} to ${join(bin, 'radar-blip')}`
    },
    async apply(bin) {
      if (!onPath) return false
      const now = await current(bin)
      if (now !== 'ours') {
        await mkdir(local, { recursive: true })
        if (now === 'other') await rename(link, `${link}.bak-${Date.now()}`)
        await symlink(join(bin, 'radar-blip'), link)
      }
      return true
    }
  }
}
