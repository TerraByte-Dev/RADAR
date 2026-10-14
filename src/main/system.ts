// Opening things outside the app (spec 8.6): the editor, the file manager, a browser. A
// project folder is untrusted, so the editor is an absolute executable found once on PATH,
// it runs with RADAR's data folder as its working directory, without a shell, and the
// project path is one argv element. No `.cmd` or `.bat` is ever executed, and nothing inside the
// project folder is.
import { spawn, type SpawnOptions } from 'node:child_process'
import { mkdirSync, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path'
import { dataDir } from 'radar-blip'

export type EditorKind = 'vscode' | 'cursor'
export interface Editor {
  kind: EditorKind
  exe: string
}

/** Each editor's launcher on PATH, and where its real executable sits relative to the launcher's folder on Windows. */
const EDITORS: { kind: EditorKind; launcher: string; win32Exe: string[] }[] = [
  { kind: 'vscode', launcher: 'code', win32Exe: [join('..', 'Code.exe')] },
  { kind: 'cursor', launcher: 'cursor', win32Exe: [join('..', 'Cursor.exe'), join('..', '..', '..', 'Cursor.exe')] }
]

/** Where each editor's installer puts it: absolute, fixed, checked before PATH. */
function installs(kind: EditorKind, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA
    const programs = env.ProgramFiles
    const list =
      kind === 'vscode'
        ? [local && join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'), programs && join(programs, 'Microsoft VS Code', 'Code.exe')]
        : [local && join(local, 'Programs', 'cursor', 'Cursor.exe')]
    return list.filter((p): p is string => !!p && isAbsolute(p))
  }
  if (platform === 'darwin') {
    return kind === 'vscode' ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'] : ['/Applications/Cursor.app/Contents/Resources/app/bin/cursor']
  }
  return kind === 'vscode' ? ['/usr/bin/code', '/snap/bin/code'] : ['/usr/bin/cursor']
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * True when `p` is `dir` itself or anything under it, compared as resolved on disk, so an 8.3
 * name, a `\\?\` prefix or a junction cannot spell its way out. True when either cannot be resolved.
 */
const inside = (dir: string, p: string): boolean => {
  let rel: string
  try {
    rel = relative(realpathSync.native(dir), realpathSync.native(p))
  } catch {
    return true
  }
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The first editor installed where its installer puts it, else whose launcher is in an
 * absolute PATH entry. On Windows that launcher is `code.cmd`, which is never run: the editor
 * is its installed `Code.exe` beside the `bin` folder. Relative entries (and so the current
 * directory) are never consulted.
 */
export function findEditor(
  pathEnv: string = process.env.PATH ?? process.env.Path ?? '',
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Editor | null {
  const dirs = pathEnv.split(platform === 'win32' ? ';' : delimiter).filter((d) => d && isAbsolute(d))
  for (const e of EDITORS) {
    const exe = installs(e.kind, platform, env).find(isFile)
    if (exe) return { kind: e.kind, exe }
    for (const d of dirs) {
      if (platform === 'win32') {
        if (!isFile(join(d, `${e.launcher}.cmd`))) continue
        const exe = e.win32Exe.map((rel) => resolve(d, rel)).find(isFile)
        if (exe) return { kind: e.kind, exe }
      } else if (isFile(join(d, e.launcher))) {
        return { kind: e.kind, exe: join(d, e.launcher) }
      }
    }
  }
  return null
}

let resolved: Editor | null | undefined
/** {@link findEditor}, once per process. */
export function resolveEditor(): Editor | null {
  if (resolved === undefined) resolved = findEditor()
  return resolved
}

export type Spawn = (file: string, args: readonly string[], opts: SpawnOptions) => { unref(): void; on(event: 'error', cb: () => void): unknown }

/** What Electron's `shell` does for us; passed in so this file runs in a plain test. */
export interface Shell {
  openPath(path: string): Promise<string>
  showItemInFolder(path: string): void
  openExternal(url: string): Promise<void>
}

/** Open `dir` in the editor, or in the file manager when there is none or it lives inside `dir`. */
export async function openInEditor(dir: string, shell: Shell, editor: Editor | null = resolveEditor(), run: Spawn = spawn): Promise<EditorKind | 'folder'> {
  if (!editor || inside(dir, editor.exe)) {
    await shell.openPath(dir)
    return 'folder'
  }
  const cwd = dataDir()
  mkdirSync(cwd, { recursive: true })
  const child = run(editor.exe, [dir], { cwd, shell: false, windowsHide: true, detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
  return editor.kind
}

const EXTERNAL = ['http:', 'https:', 'mailto:']
export function isExternalUrl(url: string): boolean {
  try {
    return EXTERNAL.includes(new URL(url).protocol)
  } catch {
    return false
  }
}
