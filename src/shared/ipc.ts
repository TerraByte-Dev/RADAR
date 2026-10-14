// The one IPC route table (spec 8.2). Main registers a handler for every route here, the
// preload forwards only names listed here, and the renderer is typed by it. Each route's
// channel is its name.
import type { Activity, AgentPresence, Check, EditOp, ProjectRecord, ReportLine } from './model'

export interface ApiError {
  code: string
  message: string
  hint?: string
  violations?: { code: string; path: string; message: string }[]
}

/** Every invoke resolves to this; an expected failure never rejects. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export type UpdateEvent =
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

type Empty = Record<string, never>

export interface Routes {
  'projects.list': { req: void; res: { projects: ProjectRecord[] } }
  'project.edit': { req: { id: string; ops: EditOp[] }; res: { record: ProjectRecord; report: ReportLine[]; undoToken: string | null } }
  'project.undo': { req: { id: string; undoToken: string }; res: { record: ProjectRecord } }
  'project.setHidden': { req: { id: string; hidden: boolean }; res: { record: ProjectRecord } }
  'project.untrack': { req: { id: string }; res: Empty }
  'project.create': { req: { dir: string; name?: string }; res: { record: ProjectRecord; created: boolean } }
  'discover.find': { req: { dir: string }; res: { found: { dir: string; name: string }[]; truncated: boolean } }
  'discover.track': { req: { dirs: string[] }; res: { projects: ProjectRecord[] } }
  'activity.refresh': { req: { ids?: string[] }; res: Empty }
  'system.pickFolder': { req: void; res: { dir: string | null } }
  'system.openExternal': { req: { url: string }; res: Empty }
  'system.reveal': { req: { id: string }; res: Empty }
  'system.openInEditor': { req: { id: string }; res: { opened: 'vscode' | 'cursor' | 'folder' } }
  /** The doctor report (5.5): what the first-run screen shows as installed or not. */
  'setup.status': { req: void; res: { checks: Check[] } }
  /** The setup diff, its last line the PATH change when there is one; with `apply`, carried out except for that line, which `setup.path` applies. */
  'setup.run': { req: { apply: boolean }; res: { diff: string; applied: boolean; report: Check[] } }
  /** Putting `<data>/bin` on the user's PATH: `change` is null when it is there already; only `apply` changes anything. */
  'setup.path': { req: { apply: boolean }; res: { change: string | null; applied: boolean } }
  'app.info': { req: void; res: { version: string; engineVersion: string; platform: string; owner: string | null } }
  /** The native window controls drawn over the top bar take the theme's colours (`#rrggbb`), read from the renderer's tokens. */
  'window.titleBar': { req: { color: string; symbolColor: string }; res: Empty }
  'update.check': { req: void; res: { devMode: boolean } }
  'update.install': { req: void; res: Empty }
}

export type RouteName = keyof Routes
export type Req<K extends RouteName> = Routes[K]['req']
export type Res<K extends RouteName> = Routes[K]['res']

/** A `Record` so that a route missing here, or listed here and not in `Routes`, is a type error. */
const ROUTE_SET: Record<RouteName, true> = {
  'projects.list': true,
  'project.edit': true,
  'project.undo': true,
  'project.setHidden': true,
  'project.untrack': true,
  'project.create': true,
  'discover.find': true,
  'discover.track': true,
  'activity.refresh': true,
  'system.pickFolder': true,
  'system.openExternal': true,
  'system.reveal': true,
  'system.openInEditor': true,
  'setup.status': true,
  'setup.run': true,
  'setup.path': true,
  'app.info': true,
  'window.titleBar': true,
  'update.check': true,
  'update.install': true
}
export const ROUTES = Object.keys(ROUTE_SET) as RouteName[]

export interface Events {
  'project.changed': { record: ProjectRecord }
  'project.removed': { id: string }
  'activity.changed': { id: string; activity: Activity | null; agent: AgentPresence }
  'update.event': UpdateEvent
}

export type EventName = keyof Events

const EVENT_SET: Record<EventName, true> = {
  'project.changed': true,
  'project.removed': true,
  'activity.changed': true,
  'update.event': true
}
export const EVENTS = Object.keys(EVENT_SET) as EventName[]

/** What the preload exposes as `window.radar`. */
export interface Bridge {
  invoke<K extends RouteName>(name: K, ...req: Req<K> extends void ? [] : [Req<K>]): Promise<Result<Res<K>>>
  on<E extends EventName>(event: E, cb: (payload: Events[E]) => void): () => void
}
