import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type {
  AppData,
  NewProjectInput,
  NewTaskInput,
  Project,
  Task,
  TodoApi
} from '../shared/types'

const api: TodoApi = {
  load: (): Promise<AppData> => ipcRenderer.invoke(IPC.load),
  createTask: (input: NewTaskInput): Promise<Task> => ipcRenderer.invoke(IPC.createTask, input),
  updateTask: (id: string, patch: Partial<Task>): Promise<Task> =>
    ipcRenderer.invoke(IPC.updateTask, id, patch),
  deleteTask: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteTask, id),
  addActivityNote: (id: string, text: string): Promise<Task> =>
    ipcRenderer.invoke(IPC.addActivityNote, id, text),
  createProject: (input: NewProjectInput): Promise<Project> =>
    ipcRenderer.invoke(IPC.createProject, input),
  updateProject: (id: string, patch: Partial<Project>): Promise<Project> =>
    ipcRenderer.invoke(IPC.updateProject, id, patch),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteProject, id),
  onOpenQuickAdd: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.openQuickAdd, listener)
    return () => ipcRenderer.removeListener(IPC.openQuickAdd, listener)
  },
  platform: process.platform,
  minimizeWindow: (): void => ipcRenderer.send(IPC.minimizeWindow),
  maximizeWindow: (): void => ipcRenderer.send(IPC.maximizeWindow),
  closeWindow: (): void => ipcRenderer.send(IPC.closeWindow)
}

contextBridge.exposeInMainWorld('api', api)
