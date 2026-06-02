import { create } from 'zustand'
import type { DueDate, Priority, Project, Subtask, Task } from '@shared/types'
import type { ParsedQuickAdd } from '../lib/nlp'
import { addMonths, currentMonth, dayKey, type YearMonth } from '../lib/date'
import { randomProjectColor } from '../lib/palette'

export type View =
  | { kind: 'radar' }
  | { kind: 'inbox' }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'snoozed' }
  | { kind: 'completed' }
  | { kind: 'logbook' }
  | { kind: 'calendar' }
  | { kind: 'project'; id: string }

/* ── Renderer-local UI preferences (persisted to localStorage) ── */
const SETTINGS_KEY = 'todoplus.settings'

interface PersistedSettings {
  /** CRT scanlines / vignette / flicker overlay. */
  crtEffects: boolean
  /** Keep completed tasks struck-through in their list (vs. hiding them). */
  showCompleted: boolean
}

function loadSettings(): PersistedSettings {
  const fallback: PersistedSettings = { crtEffects: true, showCompleted: true }
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<PersistedSettings>) } : fallback
  } catch {
    return fallback
  }
}

function saveSettings(s: PersistedSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* persistence is best-effort */
  }
}

/** Boot splash plays once per real app launch (survives HMR, resets on relaunch). */
function bootAlreadySeen(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem('todoplus.boot') === '1'
  } catch {
    return false
  }
}

interface StoreState {
  tasks: Task[]
  projects: Project[]
  loaded: boolean

  // UI state
  view: View
  selectedTaskId: string | null
  expandedTaskId: string | null
  quickAddOpen: boolean
  paletteOpen: boolean

  // Radar UI state
  radarSelectedId: string | null

  // Calendar UI state
  calendarMonth: YearMonth
  calendarSelectedDay: string | null

  // Preferences
  crtEffects: boolean
  showCompleted: boolean
  bootDone: boolean

  init(): Promise<void>
  setView(view: View): void
  setSelectedTask(id: string | null): void
  toggleExpanded(id: string): void
  setQuickAddOpen(open: boolean): void
  setPaletteOpen(open: boolean): void

  // Radar
  setRadarSelected(id: string | null): void
  /** Pin (or clear, with undefined) a blip's manual radar angle — visual only. */
  setRadarAngle(id: string, angle: number | undefined): Promise<void>
  /** Clear every manual radar angle so all blips re-join the auto layout. */
  resetRadarLayout(): Promise<void>

  // Calendar navigation
  calendarPrevMonth(): void
  calendarNextMonth(): void
  calendarGoToday(): void
  setCalendarSelectedDay(iso: string | null): void

  // Preferences
  toggleCrt(): void
  toggleShowCompleted(): void
  finishBoot(): void

  addTaskFromParsed(parsed: ParsedQuickAdd): Promise<Task>
  toggleComplete(id: string): Promise<void>
  patchTask(id: string, patch: Partial<Task>): Promise<void>
  setPriority(id: string, priority: Priority): Promise<void>
  setProject(id: string, projectId: string | null): Promise<void>
  setDue(id: string, due: DueDate | undefined): Promise<void>
  deleteTask(id: string): Promise<void>

  // Follow-up
  toggleStar(id: string): Promise<void>
  setNotes(id: string, notes: string): Promise<void>
  addSubtask(id: string, title: string): Promise<void>
  toggleSubtask(id: string, subId: string): Promise<void>
  deleteSubtask(id: string, subId: string): Promise<void>
  snooze(id: string, untilISO: string): Promise<void>
  unsnooze(id: string): Promise<void>
  addActivityNote(id: string, text: string): Promise<void>

  addProject(name: string, color?: string): Promise<Project>
  renameProject(id: string, name: string): Promise<void>
  recolorProject(id: string, color: string): Promise<void>
  deleteProject(id: string): Promise<void>
}

export const useStore = create<StoreState>((set, get) => ({
  tasks: [],
  projects: [],
  loaded: false,

  view: { kind: 'radar' },
  selectedTaskId: null,
  expandedTaskId: null,
  quickAddOpen: false,
  paletteOpen: false,

  radarSelectedId: null,

  calendarMonth: currentMonth(),
  calendarSelectedDay: null,

  crtEffects: loadSettings().crtEffects,
  showCompleted: loadSettings().showCompleted,
  bootDone: bootAlreadySeen(),

  async init() {
    const data = await window.api.load()
    set({ tasks: data.tasks, projects: data.projects, loaded: true })
  },

  setView: (view) => set({ view, selectedTaskId: null }),
  setSelectedTask: (selectedTaskId) => set({ selectedTaskId }),
  toggleExpanded: (id) =>
    set((s) => ({
      expandedTaskId: s.expandedTaskId === id ? null : id,
      selectedTaskId: id
    })),
  setQuickAddOpen: (quickAddOpen) => set({ quickAddOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  setRadarSelected: (radarSelectedId) => set({ radarSelectedId }),

  setRadarAngle: (id, angle) => get().patchTask(id, { radarAngle: angle }),
  async resetRadarLayout() {
    const pinned = get().tasks.filter((t) => t.radarAngle != null)
    await Promise.all(pinned.map((t) => get().patchTask(t.id, { radarAngle: undefined })))
  },

  calendarPrevMonth: () => set((s) => ({ calendarMonth: addMonths(s.calendarMonth, -1) })),
  calendarNextMonth: () => set((s) => ({ calendarMonth: addMonths(s.calendarMonth, 1) })),
  calendarGoToday: () =>
    set({ calendarMonth: currentMonth(), calendarSelectedDay: dayKey(new Date()) }),
  setCalendarSelectedDay: (calendarSelectedDay) => set({ calendarSelectedDay }),

  toggleCrt: () =>
    set((s) => {
      const crtEffects = !s.crtEffects
      saveSettings({ crtEffects, showCompleted: s.showCompleted })
      return { crtEffects }
    }),
  toggleShowCompleted: () =>
    set((s) => {
      const showCompleted = !s.showCompleted
      saveSettings({ crtEffects: s.crtEffects, showCompleted })
      return { showCompleted }
    }),
  finishBoot: () => {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('todoplus.boot', '1')
    } catch {
      /* ignore */
    }
    set({ bootDone: true })
  },

  async addTaskFromParsed(parsed) {
    // Resolve the project name to an existing project (case-insensitive) or create one.
    let projectId: string | null = null
    if (parsed.projectName) {
      const existing = get().projects.find(
        (p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase()
      )
      projectId = existing ? existing.id : (await get().addProject(parsed.projectName)).id
    } else if (get().view.kind === 'project') {
      // Adding from within a project view defaults the task to that project.
      projectId = (get().view as { kind: 'project'; id: string }).id
    }

    const task = await window.api.createTask({
      title: parsed.title || 'Untitled',
      priority: parsed.priority,
      projectId,
      tags: parsed.tags,
      due: parsed.due
    })
    set((s) => ({ tasks: [...s.tasks, task] }))
    return task
  },

  async toggleComplete(id) {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return
    await get().patchTask(id, { completed: !task.completed })
  },

  async patchTask(id, patch) {
    const updated = await window.api.updateTask(id, patch)
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? updated : t)) }))
  },

  setPriority: (id, priority) => get().patchTask(id, { priority }),
  setProject: (id, projectId) => get().patchTask(id, { projectId }),
  setDue: (id, due) => get().patchTask(id, { due }),

  async deleteTask(id) {
    await window.api.deleteTask(id)
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
      expandedTaskId: s.expandedTaskId === id ? null : s.expandedTaskId
    }))
  },

  toggleStar(id) {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return Promise.resolve()
    return get().patchTask(id, { starred: !task.starred })
  },

  setNotes: (id, notes) => get().patchTask(id, { notes }),

  addSubtask(id, title) {
    const task = get().tasks.find((t) => t.id === id)
    if (!task || !title.trim()) return Promise.resolve()
    const next: Subtask[] = [
      ...task.subtasks,
      { id: crypto.randomUUID(), title: title.trim(), completed: false }
    ]
    return get().patchTask(id, { subtasks: next })
  },

  toggleSubtask(id, subId) {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return Promise.resolve()
    const next = task.subtasks.map((s) =>
      s.id === subId ? { ...s, completed: !s.completed } : s
    )
    return get().patchTask(id, { subtasks: next })
  },

  deleteSubtask(id, subId) {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return Promise.resolve()
    return get().patchTask(id, { subtasks: task.subtasks.filter((s) => s.id !== subId) })
  },

  snooze: (id, untilISO) => get().patchTask(id, { snoozedUntil: untilISO }),
  unsnooze: (id) => get().patchTask(id, { snoozedUntil: undefined }),

  async addActivityNote(id, text) {
    if (!text.trim()) return
    const updated = await window.api.addActivityNote(id, text.trim())
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? updated : t)) }))
  },

  async addProject(name, color) {
    const project = await window.api.createProject({ name, color: color ?? randomProjectColor() })
    set((s) => ({ projects: [...s.projects, project] }))
    return project
  },

  async renameProject(id, name) {
    const updated = await window.api.updateProject(id, { name })
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? updated : p)) }))
  },

  async recolorProject(id, color) {
    const updated = await window.api.updateProject(id, { color })
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? updated : p)) }))
  },

  async deleteProject(id) {
    await window.api.deleteProject(id)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      // Tasks were re-homed to the Inbox in the main process.
      tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)),
      view: s.view.kind === 'project' && s.view.id === id ? { kind: 'today' } : s.view
    }))
  }
}))
