import { create } from 'zustand'
import type {
  BlipFieldPatch,
  BlipTaskOp,
  ProjectRecord,
  RadarConfig
} from '@shared/radar'
import { parseQuickAdd } from '../lib/nlp'
import { addMonths, currentMonth, dayKey, type YearMonth } from '../lib/date'

export type View =
  | { kind: 'radar' }
  | { kind: 'today' }
  | { kind: 'calendar' }
  | { kind: 'logbook' }
  | { kind: 'neglected' }
  | { kind: 'inbox' }
  | { kind: 'all' }

/* ── Renderer-local UI preferences (persisted to localStorage) ── */
const SETTINGS_KEY = 'radar.settings'

interface PersistedSettings {
  crtEffects: boolean
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
    /* best-effort */
  }
}

/** Boot splash plays once per real app launch (survives HMR, resets on relaunch). */
function bootAlreadySeen(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem('radar.boot') === '1'
  } catch {
    return false
  }
}

/** Replace (or append) a project record by its blipPath. */
function replace(list: ProjectRecord[], rec: ProjectRecord): ProjectRecord[] {
  const i = list.findIndex((p) => p.blipPath === rec.blipPath)
  if (i < 0) return [...list, rec]
  const next = list.slice()
  next[i] = rec
  return next
}

interface StoreState {
  projects: ProjectRecord[]
  config: RadarConfig | null
  loaded: boolean
  watching: boolean

  // UI state
  view: View
  selectedBlip: string | null // blipPath of the selected radar contact
  quickAddOpen: boolean
  paletteOpen: boolean

  // Calendar UI state
  calendarMonth: YearMonth
  calendarSelectedDay: string | null

  // Preferences
  crtEffects: boolean
  showCompleted: boolean
  bootDone: boolean

  init(): Promise<void>
  setView(view: View): void
  setSelectedBlip(blipPath: string | null): void
  setQuickAddOpen(open: boolean): void
  setPaletteOpen(open: boolean): void

  calendarPrevMonth(): void
  calendarNextMonth(): void
  calendarGoToday(): void
  setCalendarSelectedDay(iso: string | null): void

  toggleCrt(): void
  toggleShowCompleted(): void
  finishBoot(): void

  // Project (BLIP.md) mutations — every write goes through the engine via IPC.
  setFields(blipPath: string, patch: BlipFieldPatch): Promise<void>
  taskOp(blipPath: string, op: BlipTaskOp): Promise<void>
  handoff(blipPath: string, lines: string[], next?: string): Promise<void>
  /** Pin (number) or clear (null) a blip's manual radar angle — visual only. */
  setRadarAngle(blipPath: string, angle: number | null): Promise<void>
  resetRadarLayout(): Promise<void>

  // Capture + workspace
  capture(raw: string): Promise<void>
  addWorkspaceRoot(): Promise<void>
  removeWorkspaceRoot(root: string): Promise<void>
  adoptFolder(): Promise<void>
  /** Adopt a ghost blip in place — write its BLIP.md and turn it into a tracked project. */
  adoptGhost(project: ProjectRecord): Promise<void>
}

export const useStore = create<StoreState>((set, get) => ({
  projects: [],
  config: null,
  loaded: false,
  watching: false,

  view: { kind: 'radar' },
  selectedBlip: null,
  quickAddOpen: false,
  paletteOpen: false,

  calendarMonth: currentMonth(),
  calendarSelectedDay: null,

  crtEffects: loadSettings().crtEffects,
  showCompleted: loadSettings().showCompleted,
  bootDone: bootAlreadySeen(),

  async init() {
    const [projects, config] = await Promise.all([window.radar.scan(), window.radar.getConfig()])
    set({ projects, config, loaded: true })
    if (!get().watching) {
      window.radar.onProjectsChanged((next) => set({ projects: next }))
      set({ watching: true })
    }
  },

  setView: (view) => set({ view, selectedBlip: null }),
  setSelectedBlip: (selectedBlip) => set({ selectedBlip }),
  setQuickAddOpen: (quickAddOpen) => set({ quickAddOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

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
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('radar.boot', '1')
    } catch {
      /* ignore */
    }
    set({ bootDone: true })
  },

  async setFields(blipPath, patch) {
    const rec = await window.radar.setFields(blipPath, patch)
    set((s) => ({ projects: replace(s.projects, rec) }))
  },

  async taskOp(blipPath, op) {
    const rec = await window.radar.task(blipPath, op)
    set((s) => ({ projects: replace(s.projects, rec) }))
  },

  async handoff(blipPath, lines, next) {
    const rec = await window.radar.handoff(blipPath, lines, next)
    set((s) => ({ projects: replace(s.projects, rec) }))
  },

  async setRadarAngle(blipPath, angle) {
    // Visual-only; a failed write (file vanished, etc.) is harmless.
    try {
      await get().setFields(blipPath, { radar_angle: angle })
    } catch {
      /* best-effort */
    }
  },

  async resetRadarLayout() {
    const pinned = get().projects.filter((p) => p.radar_angle != null)
    await Promise.allSettled(pinned.map((p) => get().setFields(p.blipPath, { radar_angle: null })))
  },

  async capture(raw) {
    const parsed = parseQuickAdd(raw)
    if (!parsed.title) return
    const text = parsed.due ? `${parsed.title} (due ${parsed.due.date.slice(0, 10)})` : parsed.title
    const match = parsed.projectName
      ? get().projects.find(
          (p) => (p.name ?? '').toLowerCase() === parsed.projectName!.toLowerCase()
        )
      : undefined
    if (match) {
      await get().taskOp(match.blipPath, { action: 'add', text })
    } else {
      const rec = await window.radar.inboxAddTask(text)
      set((s) => ({ projects: replace(s.projects, rec) }))
    }
  },

  async addWorkspaceRoot() {
    const dir = await window.radar.pickFolder()
    if (!dir) return
    const config = await window.radar.addRoot(dir)
    set({ config })
    // The main process pushes a fresh scan via onProjectsChanged.
  },

  async removeWorkspaceRoot(root) {
    const config = await window.radar.removeRoot(root)
    set({ config })
  },

  async adoptFolder() {
    const dir = await window.radar.pickFolder()
    if (!dir) return
    const rec = await window.radar.initProject(dir, {})
    await window.radar.addRoot(dir)
    set((s) => ({
      projects: replace(s.projects, rec),
      view: { kind: 'radar' },
      selectedBlip: rec.blipPath
    }))
  },

  async adoptGhost(project) {
    const rec = await window.radar.initProject(project.path, { name: project.name })
    set((s) => ({ projects: replace(s.projects, rec), selectedBlip: rec.blipPath }))
  }
}))
