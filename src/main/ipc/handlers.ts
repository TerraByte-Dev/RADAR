import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import type { NewProjectInput, NewTaskInput, Project, Task } from '../../shared/types'
import type { Repository } from '../store/repository'

/** Wire every data channel to the repository. Called once at startup. */
export function registerIpcHandlers(repo: Repository): void {
  ipcMain.handle(IPC.load, () => repo.load())

  ipcMain.handle(IPC.createTask, (_e, input: NewTaskInput) => repo.createTask(input))
  ipcMain.handle(IPC.updateTask, (_e, id: string, patch: Partial<Task>) =>
    repo.updateTask(id, patch)
  )
  ipcMain.handle(IPC.deleteTask, (_e, id: string) => repo.deleteTask(id))
  ipcMain.handle(IPC.addActivityNote, (_e, id: string, text: string) =>
    repo.addActivityNote(id, text)
  )

  ipcMain.handle(IPC.createProject, (_e, input: NewProjectInput) => repo.createProject(input))
  ipcMain.handle(IPC.updateProject, (_e, id: string, patch: Partial<Project>) =>
    repo.updateProject(id, patch)
  )
  ipcMain.handle(IPC.deleteProject, (_e, id: string) => repo.deleteProject(id))
}
