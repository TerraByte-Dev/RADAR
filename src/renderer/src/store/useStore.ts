import { create } from 'zustand'
import type {
  BlipFieldPatch,
  BlipTaskOp,
  ProjectRecord,
  RadarConfig
} from '@shared/radar'
import { parseQuickAdd } from '../lib/nlp'
import { addMonths, currentMonth, dayKey, type YearMonth } from '../lib/date'
import {
  CRT_CHANGE_EVENT,
  THEME_CHANGE_EVENT,
  crtVisible,
  getCrtOff,
  getThemeId,
  setCrtOff,
  themeSupportsCrt
} from '../lib/theme'

export type View =
  | { kind: 'radar' }
  | { kind: 'today' }
  | { kind: 'calendar' }
  | { kind: 'logbook' }
  | { kind: 'neglected' }
  | { kind: 'inbox' }
  | { kind: 'all' }

/* ── Renderer-local UI preferences (persisted to localStorage) ── */
// `showCompleted` lives here; CRT now lives in the theme module (`lib/theme.ts`, `radar.crt-off`) as the
// single source of truth, reconciled into `crtEffects` below via the theme-change events.
const SETTINGS_KEY = 'radar.settings'

interface PersistedSettings {
  showCompleted: boolean
  /** A project is "neglected" after this many days untouched (Radar behavior setting). */
  neglectedDays: number
}

function loadSettings(): PersistedSettings {
  const fallback: PersistedSettings = { showCompleted: true, neglectedDays: 30 }
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

/** First-run onboarding is shown once, then dismissed for good. */
function onboardedAlready(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('radar.onboarded') === '1'
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
  neglectedDays: number
  bootDone: boolean
  onboarded: boolean

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
  setNeglectedDays(days: number): void
  finishBoot(): void
  finishOnboarding(): void

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
  /** Dismiss a project/ghost from the radar (ignore-list it; nothing on disk changes). */
  dismissProject(project: ProjectRecord): Promise<void>
  /** Archive a project (status: archived → hidden from the radar; reversible). */
  archiveProject(blipPath: string): Promise<void>
  /** Permanently delete a project's BLIP.md (undo an accidental adopt). */
  deleteProject(blipPath: string): Promise<void>
  /** Restore a dismissed project folder back onto the radar. */
  restoreProject(path: string): Promise<void>
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

  // `crtEffects` === "CRT overlay currently visible" — a mirror of the theme engine's truth, kept in sync
  // by the theme-change subscription in init(). The overlay itself is gated in CSS via `html.crt-off`.
  crtEffects: crtVisible(),
  showCompleted: loadSettings().showCompleted,
  neglectedDays: loadSettings().neglectedDays,
  bootDone: bootAlreadySeen(),
  onboarded: onboardedAlready(),

  async init() {
    // Keep `crtEffects` in lockstep with the theme engine (Appearance tab / title bar / palette all route
    // through it), so CrtOverlay's render gate + the toggle's pressed-state never disagree.
    const syncCrt = (): void => set({ crtEffects: crtVisible() })
    window.addEventListener(THEME_CHANGE_EVENT, syncCrt)
    window.addEventListener(CRT_CHANGE_EVENT, syncCrt)
    syncCrt()

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

  toggleCrt: () => {
    // CRT is a per-theme-aware manual pref. Under a universal (clean) theme the overlay is forced off,
    // so toggling is a no-op. `setCrtOff` dispatches `radar-crt-change` → the init() subscription updates
    // `crtEffects`, so we don't set it here.
    if (!themeSupportsCrt(getThemeId())) return
    setCrtOff(!getCrtOff())
  },
  toggleShowCompleted: () =>
    set((s) => {
      const showCompleted = !s.showCompleted
      saveSettings({ showCompleted, neglectedDays: s.neglectedDays })
      return { showCompleted }
    }),
  setNeglectedDays: (days) =>
    set((s) => {
      const neglectedDays = Math.max(1, Math.round(days))
      saveSettings({ showCompleted: s.showCompleted, neglectedDays })
      return { neglectedDays }
    }),
  finishBoot: () => {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('radar.boot', '1')
    } catch {
      /* ignore */
    }
    set({ bootDone: true })
  },
  finishOnboarding: () => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('radar.onboarded', '1')
    } catch {
      /* ignore */
    }
    set({ onboarded: true })
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
  },

  async dismissProject(project) {
    // Await the write first, then update — so a stale IPC channel fails honestly
    // (project stays put) instead of vanishing and re-appearing on the next scan.
    try {
      const config = await window.radar.ignore(project.path)
      set((s) => ({
        projects: s.projects.filter((p) => p.blipPath !== project.blipPath),
        selectedBlip: s.selectedBlip === project.blipPath ? null : s.selectedBlip,
        config
      }))
    } catch (e) {
      console.warn('dismiss failed — restart `npm run dev` to load the radar:ignore channel', e)
    }
  },

  archiveProject: (blipPath) => get().setFields(blipPath, { status: 'archived' }),

  async deleteProject(blipPath) {
    try {
      await window.radar.deleteProject(blipPath)
      set((s) => ({
        projects: s.projects.filter((p) => p.blipPath !== blipPath),
        selectedBlip: s.selectedBlip === blipPath ? null : s.selectedBlip
      }))
    } catch (e) {
      console.warn('delete failed — restart `npm run dev` to load the radar:delete channel', e)
    }
  },

  async restoreProject(path) {
    const config = await window.radar.unignore(path)
    set({ config })
  }
}))
