// The board store (renderer spec 2): the projects as main reports them, read once with
// `projects.list` and kept current by the three events, plus the owner and the clock the
// selectors in lib/derive.ts read. Nothing here is persisted.
import { create } from 'zustand'
import type { ApiError, Bridge } from '@shared/ipc'
import type { Check, ProjectRecord } from '@shared/model'

type Activity = Pick<ProjectRecord, 'activity' | 'agent'>

export interface Board {
  projects: Record<string, ProjectRecord>
  status: 'loading' | 'ready' | 'error'
  /** Why `projects.list` failed, while `status === 'error'`. */
  error: ApiError | null
  /** `setup.status`, read at start. */
  setup: Check[] | null
  /** `app.info.owner`; null hides every start-cost signal. */
  owner: string | null
  /** The rest of `app.info`, for Settings' About row. */
  info: { version: string; engineVersion: string; platform: string } | null
  /** Date.now(), refreshed each minute and on window focus. */
  now: number
}

export interface BoardActions {
  /** Reads the list, the doctor report and the owner, and follows the events. Returns the unsubscribe. */
  start(api: Bridge): () => void
  /** `Try again` after a failed list. */
  reload(api: Bridge): Promise<void>
  tick(now?: number): void
  /** A record an edit route answered with: shown at once, as main's event for it may come later. */
  put(record: ProjectRecord): void
  /** A project no longer tracked (`project.untrack` answers without an event). */
  drop(id: string): void
  /** `setup.status` again, after setup has run (section 2). */
  refreshSetup(api: Bridge): Promise<void>
}

export const createBoard = () =>
  create<Board & BoardActions>()((set, get) => {
    // Ids an event changed or removed while the list call was in flight: the event is newer.
    let changed = new Set<string>()
    let removed = new Set<string>()
    // activity.changed for an id not on the board yet (first load): applied to the list's record.
    let pending = new Map<string, Activity>()

    const reload = async (api: Bridge): Promise<void> => {
      changed = new Set()
      removed = new Set()
      pending = new Map()
      set({ status: 'loading', error: null })
      const res = await api.invoke('projects.list')
      if (!res.ok) return set({ status: 'error', error: res.error })
      const projects: Record<string, ProjectRecord> = {}
      for (const r of res.data.projects) if (!removed.has(r.id)) projects[r.id] = r
      const current = get().projects
      for (const id of changed) if (current[id]) projects[id] = current[id]
      for (const [id, a] of pending) if (projects[id]) projects[id] = { ...projects[id], ...a }
      pending = new Map()
      set({ projects, status: 'ready', error: null })
    }

    return {
      projects: {},
      status: 'loading',
      error: null,
      setup: null,
      owner: null,
      info: null,
      now: Date.now(),

      start: (api) => {
        const offs = [
          api.on('project.changed', ({ record }) => {
            changed.add(record.id)
            removed.delete(record.id)
            pending.delete(record.id)
            set({ projects: { ...get().projects, [record.id]: record } })
          }),
          api.on('project.removed', ({ id }) => {
            removed.add(id)
            changed.delete(id)
            pending.delete(id)
            const { [id]: _gone, ...rest } = get().projects
            set({ projects: rest })
          }),
          api.on('activity.changed', ({ id, activity, agent }) => {
            const r = get().projects[id]
            if (!r) {
              if (get().status === 'loading') pending.set(id, { activity, agent })
              return
            }
            changed.add(id)
            set({ projects: { ...get().projects, [id]: { ...r, activity, agent } } })
          })
        ]
        void reload(api)
        void api.invoke('app.info').then((res) => {
          if (res.ok) set({ owner: res.data.owner, info: { version: res.data.version, engineVersion: res.data.engineVersion, platform: res.data.platform } })
        })
        void get().refreshSetup(api)
        return () => offs.forEach((off) => off())
      },
      reload,
      tick: (now = Date.now()) => set({ now }),
      put: (record) => {
        changed.add(record.id)
        set({ projects: { ...get().projects, [record.id]: record } })
      },
      drop: (id) => {
        removed.add(id)
        changed.delete(id)
        const { [id]: _gone, ...rest } = get().projects
        set({ projects: rest })
      },
      refreshSetup: async (api) => {
        const res = await api.invoke('setup.status')
        if (res.ok) set({ setup: res.data.checks })
      }
    }
  })

export const useBoard = createBoard()

/** RADAR tracks nothing at all: first run is forced (section 2, 8.1). */
export const nothingTracked = (b: Board): boolean => b.status === 'ready' && Object.keys(b.projects).length === 0
