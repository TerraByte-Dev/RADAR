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

/** Scan every configured root (after making sure the Inbox blip exists), minus dismissed folders. */
async function doScan(): Promise<ProjectRecord[]> {
  const cfg = getConfig()
  await ensureInbox(cfg.workspace)
  const all = await scanProjects(cfg.roots, cfg.maxDepth)
  return cfg.ignored.length ? all.filter((r) => !cfg.ignored.includes(r.path)) : all
}

/** (Re)start the watcher so live BLIP.md changes push a fresh scan to the renderer. */
function rewatch(getWindow: () => BrowserWindow | null): void {
  const cfg = getConfig()
  startWatch(cfg.roots, async () => {
    const projects = await doScan()
    getWindow()?.webContents.send(IPC.radarProjectsChanged, projects)
  })
}

/** Best-effort "open in editor" — tries VS Code (`code`), reports failure rather than throwing. */
function openInEditor(path: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    exec(`code "${path}"`, (err) => {
      if (!err) resolve({ ok: true })
      else resolve({ ok: false, reason: 'VS Code (`code`) not found on PATH' })
    })
  })
}

/**
 * Wire the BLIP.md project model onto IPC and start the file watcher.
 * Returns a cleanup that stops the watcher (call on quit).
 */
export function registerRadarHandlers(getWindow: () => BrowserWindow | null): () => void {
  ipcMain.handle(IPC.radarScan, () => doScan())
  ipcMain.handle(IPC.radarRead, (_e, blipPath: string) => readProject(blipPath))
  ipcMain.handle(IPC.radarSetFields, (_e, blipPath: string, patch: BlipFieldPatch) =>
    setFields(blipPath, patch)
  )
  ipcMain.handle(IPC.radarTask, (_e, blipPath: string, op: BlipTaskOp) => taskOp(blipPath, op))
  ipcMain.handle(
    IPC.radarHandoff,
    (_e, blipPath: string, lines: string[], next?: string, author?: string) =>
      handoff(blipPath, lines, next, author)
  )
  ipcMain.handle(IPC.radarInit, (_e, dir: string, opts: InitProjectOptions) => initProject(dir, opts))
  ipcMain.handle(IPC.radarDelete, async (_e, blipPath: string) => {
    await deleteProject(blipPath)
    void doScan().then((p) => getWindow()?.webContents.send(IPC.radarProjectsChanged, p))
  })
  ipcMain.handle(IPC.radarInboxAdd, (_e, text: string) => inboxAddTask(getConfig().workspace, text))

  ipcMain.handle(IPC.radarConfigGet, () => getConfig())
  ipcMain.handle(IPC.radarAddRoot, (_e, root: string) => {
    const cfg = addRoot(root)
    rewatch(getWindow)
    void doScan().then((p) => getWindow()?.webContents.send(IPC.radarProjectsChanged, p))
    return cfg
  })
  ipcMain.handle(IPC.radarRemoveRoot, (_e, root: string) => {
    const cfg = removeRoot(root)
    rewatch(getWindow)
    void doScan().then((p) => getWindow()?.webContents.send(IPC.radarProjectsChanged, p))
    return cfg
  })
  ipcMain.handle(IPC.radarIgnore, (_e, path: string) => {
    const cfg = addIgnore(path)
    void doScan().then((p) => getWindow()?.webContents.send(IPC.radarProjectsChanged, p))
    return cfg
  })
  ipcMain.handle(IPC.radarUnignore, (_e, path: string) => {
    const cfg = removeIgnore(path)
    void doScan().then((p) => getWindow()?.webContents.send(IPC.radarProjectsChanged, p))
    return cfg
  })

  ipcMain.handle(IPC.radarPickFolder, async () => {
    const win = getWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })
  ipcMain.handle(IPC.radarOpenPath, (_e, path: string) => void shell.openPath(path))
  ipcMain.handle(IPC.radarReveal, (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(IPC.radarOpenInEditor, (_e, path: string) => openInEditor(path))

  rewatch(getWindow)
  return () => stopWatch()
}
