// The v3 board in main (spec 8.3, 8.4, 8.5, 7.5): the registry's projects as records, the
// visible-only stat poll, activity scheduling and the per-project undo slot. No Electron
// import, so every part runs in a plain test.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BlipError,
  blipPath,
  buildRecord,
  dataDir,
  initProject,
  listProjects,
  presenceOf,
  projectId,
  readLiveMarkers,
  registerProject,
  replaceIfRev,
  setHidden,
  systemGit,
  unregisterProject,
  updateProject,
  type Activity,
  type EditOp,
  type Git,
  type LiveMarker,
  type ProjectRecord,
  type ReportLine
} from 'radar-blip'
import type { EventName, Events } from '../shared/ipc'

export const POLL_MS = 1500
/** Activity older than this is refreshed when the window is shown or focused. */
export const STALE_MS = 60_000
export const UNDO_MS = 5 * 60_000
const CONCURRENCY = 4

export interface BoardOptions {
  emit: <E extends EventName>(event: E, payload: Events[E]) => void
  /** Who the app writes as (the owner's name is read once, at start). */
  author: string | Promise<string>
  /** The git runner for activity; left out, the engine's own. */
  git?: Git | null
}

interface UndoSlot {
  token: string
  preBytes: Buffer
  postRev: string
  at: number
}

const revOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex').slice(0, 16)

/** `mtimeMs:size`, or '-' when the file is not there: what the poll compares. */
async function sig(path: string): Promise<string> {
  try {
    const s = await stat(path)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return '-'
  }
}

const registryPath = (): string => join(dataDir(), 'registry.json')
const statePath = (id: string): string => join(dataDir(), 'state', `${id}.json`)
const cachePath = (): string => join(dataDir(), 'activity-cache.json')

const sameAgent = (a: ProjectRecord['agent'], b: ProjectRecord['agent']): boolean =>
  a.live === b.live && a.sessions === b.sessions && a.lastSeenAt === b.lastSeenAt

/** Thrown inside the lock when the file is not the one whose bytes the undo slot would keep. */
const MOVED = Symbol('moved')

export class Board {
  private readonly opts: BoardOptions
  /** By registry id, in registry order. */
  private readonly records = new Map<string, ProjectRecord>()
  private readonly sigs = new Map<string, { blip: string; state: string }>()
  private readonly undo = new Map<string, UndoSlot>()
  /** The newest computed activity per project; written to `activity-cache.json`. */
  private readonly cache = new Map<string, Activity>()
  private markers: LiveMarker[] = []
  private registrySig = ''
  private loaded: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private visible = false
  private ticking: Promise<void> | null = null
  private readonly pending = new Set<string>()
  private readonly inflight = new Set<string>()
  private cacheDirty = false
  /** Bumped each time the window is hidden: an activity pass started before that spawns nothing more. */
  private hides = 0

  constructor(opts: BoardOptions) {
    this.opts = opts
  }

  private gitOpt(): { git?: Git | null } {
    return this.opts.git === undefined ? {} : { git: this.opts.git }
  }

  /** The runner for one activity pass: once the window has been hidden, it starts no process. */
  private gitFor(hides: number): { git: Git | null } {
    const base = this.opts.git === undefined ? systemGit() : this.opts.git
    if (!base) return { git: null }
    return { git: { run: (dir, args, ms) => (this.hides === hides ? base.run(dir, args, ms) : Promise.reject(new Error('the window was hidden'))) } }
  }

  /** Registry + file reads only, no git: the startup list of 8.5. */
  ready(): Promise<void> {
    return (this.loaded ??= this.load())
  }

  private async load(): Promise<void> {
    try {
      const json = JSON.parse(await readFile(cachePath(), 'utf8')) as { projects?: Record<string, Activity> }
      for (const [id, a] of Object.entries(json.projects ?? {})) if (a && typeof a.computedAt === 'string') this.cache.set(id, a)
    } catch {
      // no cache yet
    }
    this.registrySig = await sig(registryPath())
    this.markers = await readLiveMarkers()
    const { projects } = await listProjects()
    for (const p of projects) await this.adopt(p.dir, p.hidden, p.id)
  }

  list(): ProjectRecord[] {
    return [...this.records.values()]
  }

  /** The record for `id`, or `E_NO_PROJECT`. */
  get(id: string): ProjectRecord {
    const r = this.records.get(id)
    if (!r) throw new BlipError('E_NO_PROJECT', 'no tracked project has this id', { hint: 'the list is out of date; it refreshes on its own' })
    return r
  }

  /** Build a record from the file and the cached activity, and remember the file's signature. Starts no process. */
  private async build(dir: string, hidden: boolean, id: string): Promise<ProjectRecord> {
    const s = { blip: await sig(blipPath(dir)), state: await sig(statePath(id)) }
    const cached = this.records.get(id)?.activity ?? this.cache.get(id)
    const record = await buildRecord(dir, { hidden, markers: this.markers, cachedOnly: true, ...(cached ? { activity: cached } : {}), ...this.gitOpt() })
    this.sigs.set(id, s)
    return { ...record, id }
  }

  /** Put a project on the board without an event (the caller answers with the record). */
  private async adopt(dir: string, hidden = false, id = projectId(dir)): Promise<ProjectRecord> {
    const known = this.records.get(id)
    if (known) return known
    const record = await this.build(dir, hidden, id)
    this.records.set(id, record)
    this.queue([id])
    return record
  }

  /** Rebuild after one of the app's own writes: no event; a fresh activity is queued if the cached one no longer holds. */
  private async rebuild(id: string): Promise<ProjectRecord> {
    const cur = this.get(id)
    const record = await this.build(cur.dir, cur.hidden, id)
    this.records.set(id, record)
    if (record.activity === null) this.queue([id])
    return record
  }

  // ---- writes (8.3) ----

  async edit(id: string, ops: EditOp[]): Promise<{ record: ProjectRecord; report: ReportLine[]; undoToken: string | null }> {
    const { dir } = this.get(id)
    const author = await this.opts.author
    for (let attempt = 0; attempt < 3; attempt++) {
      let pre: Buffer
      try {
        pre = await readFile(blipPath(dir))
      } catch {
        throw new BlipError('E_NO_PROJECT', `there is no BLIP.md in ${dir}`)
      }
      const preRev = revOf(pre)
      let res
      try {
        res = await updateProject(
          dir,
          (_doc, rev) => {
            if (rev !== preRev) throw MOVED
            return ops
          },
          { actor: 'human', now: new Date(), author }
        )
      } catch (err) {
        if (err === MOVED) continue
        throw err
      }
      // Only a write replaces the slot: a refused or no-op edit leaves the last one undoable.
      const undoToken = res.changed ? randomUUID() : null
      if (undoToken) this.undo.set(id, { token: undoToken, preBytes: pre, postRev: res.rev, at: Date.now() })
      return { record: await this.rebuild(id), report: res.report, undoToken }
    }
    throw new BlipError('E_BUSY', 'BLIP.md kept changing while it was being written', { hint: 'try again in a moment' })
  }

  async undoEdit(id: string, token: string): Promise<{ record: ProjectRecord }> {
    const { dir } = this.get(id)
    const slot = this.undo.get(id)
    const stale = new BlipError('E_UNDO_STALE', 'too late to undo: the file has changed since, so it was left as it is')
    if (!slot || slot.token !== token || Date.now() - slot.at > UNDO_MS) throw stale
    this.undo.delete(id)
    try {
      await replaceIfRev(dir, slot.postRev, slot.preBytes)
    } catch (err) {
      if (err instanceof BlipError && err.code === 'E_STALE_REV') throw stale
      throw err
    }
    return { record: await this.rebuild(id) }
  }

  async setHidden(id: string, hidden: boolean): Promise<ProjectRecord> {
    const cur = this.get(id)
    await setHidden(cur.dir, hidden)
    const record = { ...cur, hidden }
    this.records.set(id, record)
    return record
  }

  async untrack(id: string): Promise<void> {
    const cur = this.get(id)
    if (cur.state !== 'missing') throw new BlipError('E_BAD_REQUEST', 'only a project whose BLIP.md is missing can stop being tracked; hide it instead')
    await unregisterProject(cur.dir)
    this.records.delete(id)
    this.sigs.delete(id)
    this.undo.delete(id)
  }

  /** Start tracking a folder: an exclusive create, or the existing file as it is (8.6). */
  async create(dir: string, name?: string): Promise<{ record: ProjectRecord; created: boolean }> {
    const res = await initProject(dir, name === undefined ? {} : { name })
    return { record: await this.adopt(res.dir), created: res.created }
  }

  async track(dirs: string[]): Promise<ProjectRecord[]> {
    const out: ProjectRecord[] = []
    for (const dir of dirs) {
      await registerProject(dir)
      out.push(await this.adopt(dir))
    }
    return out
  }

  // ---- activity (7.5) ----

  /** Queue activity refreshes. While the window is hidden nothing is queued. */
  queue(ids: Iterable<string>): void {
    if (!this.visible) return
    for (const id of ids) if (this.records.has(id)) this.pending.add(id)
    this.pump()
  }

  refresh(ids?: string[]): void {
    this.queue(ids ?? this.records.keys())
  }

  private refreshStale(): void {
    const now = Date.now()
    const stale = [...this.records.values()].filter((r) => !r.activity || now - Date.parse(r.activity.computedAt) > STALE_MS)
    this.queue(stale.map((r) => r.id))
  }

  private pump(): void {
    for (const id of this.pending) {
      if (this.inflight.size >= CONCURRENCY) return
      if (this.inflight.has(id)) continue
      this.pending.delete(id)
      this.inflight.add(id)
      void this.compute(id)
        .catch(() => {})
        .finally(() => {
          this.inflight.delete(id)
          if (this.visible) this.pump()
          if (!this.inflight.size && !this.pending.size) void this.saveCache()
        })
    }
  }

  private async compute(id: string): Promise<void> {
    const cur = this.records.get(id)
    if (!cur) return
    const hides = this.hides
    const fresh = await buildRecord(cur.dir, { hidden: cur.hidden, markers: this.markers, ...this.gitFor(hides) })
    const now = this.records.get(id)
    if (!now) return
    // Hidden while git ran: the pass was cut short, so it is not a result (it runs again when the window is shown, if visible now).
    if (this.hides !== hides) {
      this.queue([id])
      return
    }
    // An edit or the poll replaced the record while git ran: this result may describe the older file, so compute again.
    if (now.rev !== cur.rev) {
      this.queue([id])
      return
    }
    const record = { ...fresh, id, hidden: now.hidden }
    this.records.set(id, record)
    if (record.activity) {
      this.cache.set(id, record.activity)
      this.cacheDirty = true
    }
    if (record.rev !== now.rev || record.state !== now.state) this.opts.emit('project.changed', { record })
    else this.opts.emit('activity.changed', { id, activity: record.activity, agent: record.agent })
  }

  /** The app is the only writer of `activity-cache.json` (7.5). */
  private async saveCache(): Promise<void> {
    if (!this.cacheDirty) return
    this.cacheDirty = false
    const path = cachePath()
    const tmp = join(dataDir(), `.activity-cache.${randomUUID().slice(0, 8)}.tmp`)
    try {
      await mkdir(dataDir(), { recursive: true })
      await writeFile(tmp, `${JSON.stringify({ version: 1, projects: Object.fromEntries(this.cache) })}\n`, 'utf8')
      await rename(tmp, path)
    } catch {
      // a cache that cannot be written costs only the instant first paint
    }
  }

  // ---- watching (8.4) ----

  /** The window was shown (true) or hidden or minimised (false). */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    if (!visible) {
      this.hides++
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      this.pending.clear()
      return
    }
    void this.tick()
    this.timer = setInterval(() => void this.tick(), POLL_MS)
    this.refreshStale()
  }

  /** The window got focus: activity older than a minute is refreshed. */
  focused(): void {
    if (this.visible) this.refreshStale()
  }

  stop(): void {
    this.setVisible(false)
  }

  /** One poll pass. Overlapping calls share the pass in progress. */
  tick(): Promise<void> {
    return (this.ticking ??= this.poll().finally(() => (this.ticking = null)))
  }

  private async poll(): Promise<void> {
    await this.ready()
    const { emit } = this.opts
    this.markers = await readLiveMarkers()

    // 1. The registry: written only when a project is added, hidden or removed.
    const rs = await sig(registryPath())
    if (rs !== this.registrySig) {
      this.registrySig = rs
      const { projects } = await listProjects()
      const seen = new Set<string>()
      for (const p of projects) {
        seen.add(p.id)
        const cur = this.records.get(p.id)
        if (!cur) {
          emit('project.changed', { record: await this.adopt(p.dir, p.hidden, p.id) })
        } else if (cur.hidden !== p.hidden) {
          const record = { ...cur, hidden: p.hidden }
          this.records.set(p.id, record)
          emit('project.changed', { record })
        }
      }
      for (const id of [...this.records.keys()]) {
        if (seen.has(id)) continue
        this.records.delete(id)
        this.sigs.delete(id)
        this.undo.delete(id)
        emit('project.removed', { id })
      }
    }

    // 2. Each BLIP.md and its state file.
    for (const [id, cur] of [...this.records]) {
      const before = this.sigs.get(id)
      const blip = await sig(blipPath(cur.dir))
      const state = await sig(statePath(id))
      if (blip !== before?.blip) {
        const record = await this.build(cur.dir, cur.hidden, id)
        if (!this.records.has(id)) continue
        if (record.rev !== cur.rev || record.state !== cur.state) {
          this.records.set(id, record)
          emit('project.changed', { record })
          this.queue([id])
        }
      } else if (state !== before.state) {
        this.sigs.set(id, { blip, state })
        this.queue([id])
      }
    }

    // 3. Live agent sessions.
    for (const [id, cur] of [...this.records]) {
      const agent = presenceOf(cur.dir, this.markers)
      if (sameAgent(agent, cur.agent)) continue
      this.records.set(id, { ...cur, agent })
      emit('activity.changed', { id, activity: cur.activity, agent })
      // A session starting or ending is worth a git pass; a transcript that only grew is not (it moves lastSeenAt every message).
      if (agent.live !== cur.agent.live || agent.sessions !== cur.agent.sessions) this.queue([id])
    }
  }
}
