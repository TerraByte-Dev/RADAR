import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { AppApi, UpdateEvent } from '../shared/types'
import type {
  BlipFieldPatch,
  BlipTaskOp,
  InitProjectOptions,
  ProjectRecord,
  RadarApi,
  RadarConfig
} from '../shared/radar'

const api: AppApi = {
  onOpenQuickAdd: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.openQuickAdd, listener)
    return () => ipcRenderer.removeListener(IPC.openQuickAdd, listener)
  },
  minimizeWindow: (): void => ipcRenderer.send(IPC.minimizeWindow),
  maximizeWindow: (): void => ipcRenderer.send(IPC.maximizeWindow),
  closeWindow: (): void => ipcRenderer.send(IPC.closeWindow),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appGetVersion),
  checkForUpdates: (): Promise<{ devMode: boolean }> => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: (): void => ipcRenderer.send(IPC.updateInstall),
  onUpdateEvent: (cb: (event: UpdateEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: UpdateEvent): void => cb(event)
    ipcRenderer.on(IPC.updateEvent, listener)
    return () => ipcRenderer.removeListener(IPC.updateEvent, listener)
  }
}

const radar: RadarApi = {
  scan: (): Promise<ProjectRecord[]> => ipcRenderer.invoke(IPC.radarScan),
  readProject: (blipPath: string): Promise<ProjectRecord> =>
    ipcRenderer.invoke(IPC.radarRead, blipPath),
  setFields: (blipPath: string, patch: BlipFieldPatch): Promise<ProjectRecord> =>
    ipcRenderer.invoke(IPC.radarSetFields, blipPath, patch),
  task: (blipPath: string, op: BlipTaskOp): Promise<ProjectRecord> =>
    ipcRenderer.invoke(IPC.radarTask, blipPath, op),
  handoff: (blipPath: string, lines: string[], next?: string, author?: string): Promise<ProjectRecord> =>
    ipcRenderer.invoke(IPC.radarHandoff, blipPath, lines, next, author),
  initProject: (dir: string, opts: InitProjectOptions): Promise<ProjectRecord> =>
    ipcRenderer.invoke(IPC.radarInit, dir, opts),
  inboxAddTask: (text: string): Promise<ProjectRecord> =>
    ipcRenderer.invoke(IPC.radarInboxAdd, text),
  deleteProject: (blipPath: string): Promise<void> => ipcRenderer.invoke(IPC.radarDelete, blipPath),
  getConfig: (): Promise<RadarConfig> => ipcRenderer.invoke(IPC.radarConfigGet),
  addRoot: (root: string): Promise<RadarConfig> => ipcRenderer.invoke(IPC.radarAddRoot, root),
  removeRoot: (root: string): Promise<RadarConfig> => ipcRenderer.invoke(IPC.radarRemoveRoot, root),
  ignore: (path: string): Promise<RadarConfig> => ipcRenderer.invoke(IPC.radarIgnore, path),
  unignore: (path: string): Promise<RadarConfig> => ipcRenderer.invoke(IPC.radarUnignore, path),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.radarPickFolder),
  openExternal: (url: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC.radarOpenExternal, url),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke(IPC.radarReveal, path),
  openInEditor: (path: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC.radarOpenInEditor, path),
  onProjectsChanged: (cb: (projects: ProjectRecord[]) => void): (() => void) => {
    const listener = (_e: unknown, projects: ProjectRecord[]): void => cb(projects)
    ipcRenderer.on(IPC.radarProjectsChanged, listener)
    return () => ipcRenderer.removeListener(IPC.radarProjectsChanged, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('radar', radar)
