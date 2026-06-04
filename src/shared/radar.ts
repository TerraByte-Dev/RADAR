// RADAR project model — the BLIP.md-backed domain shared by main + renderer.
//
// These are plain structural types (no `radar-blip` import) so the renderer bundle
// never pulls in the node-only engine. The main process maps the engine's read model
// onto `ProjectRecord`; the renderer consumes `ProjectRecord` as a radar blip.

export type Horizon = 'today' | 'week' | 'someday'
export type BlipStatus = 'active' | 'paused' | 'blocked' | 'shipped' | 'archived'

export const HORIZONS: readonly Horizon[] = ['today', 'week', 'someday']
export const BLIP_STATUSES: readonly BlipStatus[] = [
  'active',
  'paused',
  'blocked',
  'shipped',
  'archived'
]

export interface BlipTask {
  text: string
  done: boolean
}

/** One project on the radar — the parsed state of its `BLIP.md` plus its location. */
export interface ProjectRecord {
  /** Absolute path to the project folder. */
  path: string
  /** Absolute path to the project's `BLIP.md` (the stable blip id). */
  blipPath: string
  name?: string
  horizon: Horizon
  /** Hard due date (ISO). Drives exact radar distance; falls back to `horizon` when absent. */
  deadline?: string
  priority: number
  category: string
  status: BlipStatus
  operation?: string
  next_action?: string
  /** Pinned visual bearing in degrees [0, 360); set by dragging the blip. */
  radar_angle?: number
  created?: string
  last_session?: string
  tags?: string[]
  links?: unknown[]
  tasks: BlipTask[]
  /** The `# Session log` body (read-only) — the project's activity timeline. */
  sessionLog?: string
  unknown: Record<string, unknown>
  /** Set when `BLIP.md` failed to parse — surfaced as a "signal lost" blip, never overwritten. */
  error?: string
  /** An un-adopted repo surfaced as a ghost blip (no `BLIP.md` yet). One-click adopt creates one. */
  ghost?: boolean
  /** Adoption hints for a ghost (e.g. has .git / CLAUDE.md), used by the detail panel. */
  ghostHints?: string[]
}

export interface RadarConfig {
  /** Workspace roots scanned for `BLIP.md` files. */
  roots: string[]
  /** How deep to recurse from each root. */
  maxDepth: number
  /** The app-managed RADAR workspace (home of the Inbox blip). */
  workspace: string
  /** Project folders dismissed from the radar (hidden without deleting anything). */
  ignored: string[]
}

export type BlipTaskAction = 'add' | 'done' | 'undone' | 'toggle' | 'rm' | 'edit'

export interface BlipTaskOp {
  action: BlipTaskAction
  /** 0-based index or exact task text. */
  ref?: number | string
  text?: string
}

/** A patch of managed `BLIP.md` fields. `null` clears an optional field. */
export interface BlipFieldPatch {
  name?: string
  horizon?: Horizon
  deadline?: string | null
  priority?: number
  category?: string
  status?: BlipStatus
  operation?: string | null
  next_action?: string
  radar_angle?: number | null
  tags?: string[]
}

/** Options for creating a new project `BLIP.md`. */
export interface InitProjectOptions {
  name?: string
  horizon?: Horizon
  priority?: number
  category?: string
  deadline?: string
  operation?: string
  next_action?: string
}

/** The typed surface exposed on `window.radar` by the preload script. */
export interface RadarApi {
  /** Scan all workspace roots and return every project (+ ghost blips). */
  scan(): Promise<ProjectRecord[]>
  /** Re-read a single project's `BLIP.md`. */
  readProject(blipPath: string): Promise<ProjectRecord>
  /** Patch managed frontmatter fields; returns the re-read record. */
  setFields(blipPath: string, patch: BlipFieldPatch): Promise<ProjectRecord>
  /** Mutate the project's `# Tasks` checklist. */
  task(blipPath: string, op: BlipTaskOp): Promise<ProjectRecord>
  /** Append a dated `# Session log` entry and update `next_action` + `last_session`. */
  handoff(blipPath: string, lines: string[], next?: string, author?: string): Promise<ProjectRecord>
  /** Create a `BLIP.md` in `dir` (adopts a folder / ghost). */
  initProject(dir: string, opts: InitProjectOptions): Promise<ProjectRecord>
  /** Append a task to the app-managed Inbox `BLIP.md` (universal capture). */
  inboxAddTask(text: string): Promise<ProjectRecord>
  /** Delete a project's BLIP.md from disk (used to undo an accidental adopt). */
  deleteProject(blipPath: string): Promise<void>
  getConfig(): Promise<RadarConfig>
  addRoot(root: string): Promise<RadarConfig>
  removeRoot(root: string): Promise<RadarConfig>
  /** Dismiss a project folder from the radar (hide without deleting). */
  ignore(path: string): Promise<RadarConfig>
  /** Un-dismiss a previously ignored folder. */
  unignore(path: string): Promise<RadarConfig>
  /** Native folder picker; returns the chosen absolute path or null. */
  pickFolder(): Promise<string | null>
  openPath(path: string): Promise<void>
  reveal(path: string): Promise<void>
  openInEditor(path: string): Promise<{ ok: boolean; reason?: string }>
  /** Subscribe to live `BLIP.md` changes (file watcher); returns an unsubscribe fn. */
  onProjectsChanged(cb: (projects: ProjectRecord[]) => void): () => void
}
