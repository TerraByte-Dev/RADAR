// Shared domain types — used by both the main (store/IPC) and renderer processes.

export type Priority = 'P1' | 'P2' | 'P3' | 'P4' | 'none'

export interface DueDate {
  /** ISO date string (date or full datetime). */
  date: string
  /** Whether a specific time-of-day was set (vs. an all-day due date). */
  hasTime: boolean
}

export interface Subtask {
  id: string
  title: string
  completed: boolean
}

export type ActivityKind =
  | 'created'
  | 'rescheduled'
  | 'completed'
  | 'reopened'
  | 'snoozed'
  | 'note'

export interface ActivityEntry {
  id: string
  /** ISO timestamp. */
  ts: string
  kind: ActivityKind
  /** Free text for manual follow-up notes (kind === 'note'). */
  text?: string
}

export interface Task {
  id: string
  title: string
  notes?: string
  priority: Priority
  /** null = Inbox (no project). */
  projectId: string | null
  tags: string[]
  due?: DueDate
  completed: boolean
  completedAt?: string
  createdAt: string
  /** Manual sort order within a view. */
  order: number
  /** Checklist of steps. */
  subtasks: Subtask[]
  /** Running history: auto events + manual follow-up notes (the repo owns this). */
  activity: ActivityEntry[]
  /** Lightweight "actively working on this" flag. */
  starred: boolean
  /** ISO; while in the future, the task is hidden from the action views. */
  snoozedUntil?: string
  /**
   * Manual radar angle override in degrees [0, 360) — purely visual. When set,
   * the blip stays at this angle instead of its auto project-sector position
   * (set by dragging it around the dial; cleared to re-join the auto layout).
   * Does NOT change the task's project.
   */
  radarAngle?: number
}

export interface Project {
  id: string
  name: string
  /** Hex color from the curated palette. */
  color: string
  order: number
}

/** The full persisted document. */
export interface AppData {
  version: number
  tasks: Task[]
  projects: Project[]
}

/** Fields the renderer may send when creating a task. (Repo owns the rest.) */
export type NewTaskInput = Omit<
  Task,
  'id' | 'createdAt' | 'completed' | 'completedAt' | 'order' | 'subtasks' | 'activity' | 'starred'
> &
  Partial<Pick<Task, 'completed' | 'order'>>

/** Fields the renderer may send when creating a project. */
export type NewProjectInput = Omit<Project, 'id' | 'order'> & Partial<Pick<Project, 'order'>>

/** IPC channel names — single source of truth for main + preload. */
export const IPC = {
  load: 'data:load',
  createTask: 'task:create',
  updateTask: 'task:update',
  deleteTask: 'task:delete',
  addActivityNote: 'task:add-activity-note',
  createProject: 'project:create',
  updateProject: 'project:update',
  deleteProject: 'project:delete',
  openQuickAdd: 'ui:open-quick-add',
  // Frameless-window chrome (custom title bar controls).
  minimizeWindow: 'window:minimize',
  maximizeWindow: 'window:maximize',
  closeWindow: 'window:close'
} as const

/** The typed surface exposed on `window.api` by the preload script. */
export interface TodoApi {
  load(): Promise<AppData>
  createTask(input: NewTaskInput): Promise<Task>
  updateTask(id: string, patch: Partial<Task>): Promise<Task>
  deleteTask(id: string): Promise<void>
  addActivityNote(id: string, text: string): Promise<Task>
  createProject(input: NewProjectInput): Promise<Project>
  updateProject(id: string, patch: Partial<Project>): Promise<Project>
  deleteProject(id: string): Promise<void>
  /** Subscribe to the global quick-add hotkey; returns an unsubscribe fn. */
  onOpenQuickAdd(cb: () => void): () => void
  /** Host OS platform (e.g. 'win32', 'darwin') — drives title-bar chrome. */
  platform: string
  /** Frameless-window controls. */
  minimizeWindow(): void
  maximizeWindow(): void
  closeWindow(): void
}
