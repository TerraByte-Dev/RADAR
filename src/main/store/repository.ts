import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  ActivityEntry,
  ActivityKind,
  AppData,
  NewProjectInput,
  NewTaskInput,
  Project,
  Task
} from '../../shared/types'

const DATA_VERSION = 2

function activity(kind: ActivityKind, text?: string, ts = new Date().toISOString()): ActivityEntry {
  return { id: randomUUID(), ts, kind, text }
}

/** Backfill fields added in later versions so older documents stay valid. */
function normalizeTask(t: Task): Task {
  const subtasks = Array.isArray(t.subtasks) ? t.subtasks : []
  const starred = t.starred ?? false
  const existing = Array.isArray(t.activity) ? t.activity : []
  const seeded = existing.length ? existing : [activity('created', undefined, t.createdAt)]
  return { ...t, subtasks, starred, activity: seeded }
}

/**
 * Local-only persistence: a single JSON document written atomically to the
 * OS userData directory. The repository is the only thing that touches disk,
 * so swapping it for a synced backend later is a contained change.
 */
export class Repository {
  private filePath: string
  private data: AppData
  private writeQueue: Promise<void> = Promise.resolve()

  private constructor(filePath: string, data: AppData) {
    this.filePath = filePath
    this.data = data
  }

  static async open(): Promise<Repository> {
    const filePath = join(app.getPath('userData'), 'todoplus-data.json')
    const data = await Repository.read(filePath)
    return new Repository(filePath, data)
  }

  private static async read(filePath: string): Promise<AppData> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as AppData
      return {
        version: DATA_VERSION,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask) : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : []
      }
    } catch {
      // Missing or corrupt file → start fresh.
      return { version: DATA_VERSION, tasks: [], projects: [] }
    }
  }

  /** Atomic write: serialize to a temp file then rename over the target. */
  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2)
    this.writeQueue = this.writeQueue.then(async () => {
      const tmp = `${this.filePath}.${randomUUID()}.tmp`
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      await fs.writeFile(tmp, snapshot, 'utf-8')
      await fs.rename(tmp, this.filePath)
    })
    return this.writeQueue
  }

  load(): AppData {
    return this.data
  }

  async createTask(input: NewTaskInput): Promise<Task> {
    const maxOrder = this.data.tasks.reduce((m, t) => Math.max(m, t.order), 0)
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      notes: input.notes,
      priority: input.priority ?? 'none',
      projectId: input.projectId ?? null,
      tags: input.tags ?? [],
      due: input.due,
      completed: input.completed ?? false,
      createdAt: new Date().toISOString(),
      order: input.order ?? maxOrder + 1,
      subtasks: [],
      activity: [],
      starred: false,
      snoozedUntil: input.snoozedUntil
    }
    task.activity.push(activity('created', undefined, task.createdAt))
    this.data.tasks.push(task)
    await this.persist()
    return task
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const task = this.data.tasks.find((t) => t.id === id)
    if (!task) throw new Error(`Task not found: ${id}`)

    // The repository owns the activity log — never let a patch overwrite it.
    const { activity: _ignored, ...safePatch } = patch
    void _ignored

    // Diff against the current task to auto-log meaningful changes.
    if ('due' in safePatch && safePatch.due?.date !== task.due?.date) {
      task.activity.push(activity('rescheduled'))
    }
    if (safePatch.completed === true && !task.completed) {
      task.activity.push(activity('completed'))
    }
    if (safePatch.completed === false && task.completed) {
      task.activity.push(activity('reopened'))
    }
    if (
      'snoozedUntil' in safePatch &&
      safePatch.snoozedUntil &&
      safePatch.snoozedUntil !== task.snoozedUntil &&
      new Date(safePatch.snoozedUntil).getTime() > Date.now()
    ) {
      task.activity.push(activity('snoozed'))
    }

    Object.assign(task, safePatch, { id: task.id })
    if (safePatch.completed === true && !task.completedAt) {
      task.completedAt = new Date().toISOString()
    }
    if (safePatch.completed === false) {
      task.completedAt = undefined
    }
    await this.persist()
    return task
  }

  async addActivityNote(id: string, text: string): Promise<Task> {
    const task = this.data.tasks.find((t) => t.id === id)
    if (!task) throw new Error(`Task not found: ${id}`)
    task.activity.push(activity('note', text))
    await this.persist()
    return task
  }

  async deleteTask(id: string): Promise<void> {
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id)
    await this.persist()
  }

  async createProject(input: NewProjectInput): Promise<Project> {
    const maxOrder = this.data.projects.reduce((m, p) => Math.max(m, p.order), 0)
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      color: input.color,
      order: input.order ?? maxOrder + 1
    }
    this.data.projects.push(project)
    await this.persist()
    return project
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const project = this.data.projects.find((p) => p.id === id)
    if (!project) throw new Error(`Project not found: ${id}`)
    Object.assign(project, patch, { id: project.id })
    await this.persist()
    return project
  }

  async deleteProject(id: string): Promise<void> {
    this.data.projects = this.data.projects.filter((p) => p.id !== id)
    // Orphaned tasks fall back to the Inbox.
    for (const task of this.data.tasks) {
      if (task.projectId === id) task.projectId = null
    }
    await this.persist()
  }
}
