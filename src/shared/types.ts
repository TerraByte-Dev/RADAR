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
  | 'id'
  | 'createdAt'
  | 'completed'
  | 'completedAt'
  | 'order'
  | 'subtasks'
  | 'activity'
  | 'starred'
  // radarAngle is a visual override set by dragging an existing blip — never at creation.
  | 'radarAngle'
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
  closeWindow: 'window:close',
  // RADAR / BLIP.md project model (window.radar).
  radarScan: 'radar:scan',
  radarRead: 'radar:read',
  radarSetFields: 'radar:set-fields',
  radarTask: 'radar:task',
  radarHandoff: 'radar:handoff',
  radarInit: 'radar:init',
  radarDelete: 'radar:delete',
  radarInboxAdd: 'radar:inbox-add',
  radarConfigGet: 'radar:config-get',
  radarAddRoot: 'radar:add-root',
  radarRemoveRoot: 'radar:remove-root',
  radarIgnore: 'radar:ignore',
  radarUnignore: 'radar:unignore',
  radarPickFolder: 'radar:pick-folder',
  radarOpenPath: 'radar:open-path',
  radarReveal: 'radar:reveal',
  radarOpenInEditor: 'radar:open-in-editor',
  /** Push channel: main → renderer when the watcher sees BLIP.md changes. */
  radarProjectsChanged: 'radar:projects-changed',
  // App + auto-update (window.api). electron-updater is packaged-only; dev reports devMode.
  appGetVersion: 'app:get-version',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  /** Push channel: main → renderer with auto-update progress. */
  updateEvent: 'update:event'
} as const

/** Auto-update lifecycle, pushed from main → renderer on the `update:event` channel. */
export type UpdateEvent =
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

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
  /** Installed app version (e.g. "0.1.0"). */
  getAppVersion(): Promise<string>
  /** Trigger an update check. `devMode: true` in unpackaged builds (auto-update is packaged-only). */
  checkForUpdates(): Promise<{ devMode: boolean }>
  /** Start downloading an available update. */
  downloadUpdate(): Promise<void>
  /** Quit and install a downloaded update. */
  installUpdate(): void
  /** Subscribe to auto-update lifecycle events; returns an unsubscribe fn. */
  onUpdateEvent(cb: (event: UpdateEvent) => void): () => void
}
