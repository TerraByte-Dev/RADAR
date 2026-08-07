import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import { exec } from 'node:child_process'
import { IPC } from '../../shared/types'
import type { BlipFieldPatch, BlipTaskOp, InitProjectOptions, ProjectRecord } from '../../shared/radar'
import { getConfig, addRoot, removeRoot, addIgnore, removeIgnore } from '../store/config'
import {
  scanProjects,
  readProject,
  setFields,
  taskOp,
  handoff,
  initProject,
  deleteProject
} from '../store/projects'
import { ensureInbox, inboxAddTask } from '../store/workspace'
import { startWatch, stopWatch } from '../store/watch'
import { assertBlipPath, assertInitDir } from './guard'

/** Scan every configured root (after making sure the Inbox blip exists), minus dismissed folders. */
async function doScan(): Promise<ProjectRecord[]> {
  const cfg = getConfig()
  await ensureInbox(cfg.workspace)
  const all = await scanProjects(cfg.roots, cfg.maxDepth)
  return cfg.ignored.length ? all.filter((r) => !cfg.ignored.includes(r.path)) : all
}

/**
 * Generation counter for push-producing scans: overlapping `doScan()`s (watcher bursts,
 * handler-triggered refreshes) can resolve out of order, so only the freshest scan may
 * send `radar:projects-changed` — a stale result arriving late is dropped.
 */
let scanGen = 0
async function scanAndPush(getWindow: () => BrowserWindow | null): Promise<void> {
  const gen = ++scanGen
  const projects = await doScan()
  if (gen !== scanGen) return // superseded by a fresher scan while we were reading
  getWindow()?.webContents.send(IPC.radarProjectsChanged, projects)
}

/** Resolve + validate a renderer-supplied BLIP.md path against the configured roots. */
function guardBlip(blipPath: string): string {
  return assertBlipPath(blipPath, getConfig().roots)
}

/** (Re)start the watcher so live BLIP.md changes push a fresh scan to the renderer. */
function rewatch(getWindow: () => BrowserWindow | null): void {
  const cfg = getConfig()
  startWatch(cfg.roots, cfg.maxDepth, () => void scanAndPush(getWindow))
}

/**
 * Best-effort "open in editor" — tries VS Code (`code`), reports failure rather than throwing.
 * The command string is constant and the project path travels via `cwd` (an API argument, never
 * shell-parsed), so a hostile directory name can't inject into the shell.
 */
function openInEditor(path: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    exec('code .', { cwd: path }, (err) => {
      if (!err) resolve({ ok: true })
      else resolve({ ok: false, reason: 'VS Code (`code`) not found on PATH' })
    })
  })
}

/**
 * Open a link from a BLIP.md in the OS browser — allowlisted protocols only. `links:` entries
 * come from files that agents and cloned repos write, so they are untrusted: anything that
 * isn't http(s)/mailto (file paths, executables, custom protocol handlers) is refused.
 */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
async function openExternal(url: string): Promise<{ ok: boolean; reason?: string }> {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return { ok: false, reason: 'not a valid URL' }
  }
  if (!EXTERNAL_PROTOCOLS.has(protocol)) return { ok: false, reason: `blocked protocol: ${protocol}` }
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Wire the BLIP.md project model onto IPC and start the file watcher.
 * Returns a cleanup that stops the watcher (call on quit).
 */
export function registerRadarHandlers(getWindow: () => BrowserWindow | null): () => void {
  ipcMain.handle(IPC.radarScan, () => doScan())
  ipcMain.handle(IPC.radarRead, (_e, blipPath: string) => readProject(guardBlip(blipPath)))
  ipcMain.handle(IPC.radarSetFields, (_e, blipPath: string, patch: BlipFieldPatch) =>
    setFields(guardBlip(blipPath), patch)
  )
  ipcMain.handle(IPC.radarTask, (_e, blipPath: string, op: BlipTaskOp) =>
    taskOp(guardBlip(blipPath), op)
  )
  ipcMain.handle(IPC.radarHandoff, (_e, blipPath: string, lines: string[], author?: string) =>
    handoff(guardBlip(blipPath), lines, author)
  )
  // Adopting and deleting both change where the *scanner's* project/ghost boundaries fall, and the
  // watcher caches those for its lifetime — so it has to be rebuilt, or a folder that just stopped
  // being a boundary keeps its nested blips invisible to the live loop (silently, with no error).
  ipcMain.handle(IPC.radarInit, async (_e, dir: string, opts: InitProjectOptions) => {
    const rec = await initProject(await assertInitDir(dir), opts)
    rewatch(getWindow)
    return rec
  })
  ipcMain.handle(IPC.radarDelete, async (_e, blipPath: string) => {
    await deleteProject(guardBlip(blipPath))
    rewatch(getWindow)
    void scanAndPush(getWindow)
  })
  ipcMain.handle(IPC.radarInboxAdd, (_e, text: string) => inboxAddTask(getConfig().workspace, text))

  ipcMain.handle(IPC.radarConfigGet, () => getConfig())
  ipcMain.handle(IPC.radarAddRoot, (_e, root: string) => {
    const cfg = addRoot(root)
    rewatch(getWindow)
    void scanAndPush(getWindow)
    return cfg
  })
  ipcMain.handle(IPC.radarRemoveRoot, (_e, root: string) => {
    const cfg = removeRoot(root)
    rewatch(getWindow)
    void scanAndPush(getWindow)
    return cfg
  })
  ipcMain.handle(IPC.radarIgnore, (_e, path: string) => {
    const cfg = addIgnore(path)
    void scanAndPush(getWindow)
    return cfg
  })
  ipcMain.handle(IPC.radarUnignore, (_e, path: string) => {
    const cfg = removeIgnore(path)
    void scanAndPush(getWindow)
    return cfg
  })

  ipcMain.handle(IPC.radarPickFolder, async () => {
    const win = getWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })
  ipcMain.handle(IPC.radarOpenExternal, (_e, url: string) => openExternal(url))
  ipcMain.handle(IPC.radarReveal, (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(IPC.radarOpenInEditor, (_e, path: string) => openInEditor(path))

  rewatch(getWindow)
  return () => void stopWatch()
}
