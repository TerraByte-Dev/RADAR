// The v3 route table in main (spec 8.2): one validator and one handler per route, and the
// path grants. A request that fails its validator never reaches the handler; every outcome
// is a `Result`, never a rejected promise.
import { basename, isAbsolute, join } from 'node:path'
import { existsSync } from 'node:fs'
import { BlipError, CAPS, applySetup, blipPath, buildRecord, describePlan, findProjects, planSetup, projectKey, runDoctor, type Targets } from 'radar-blip'
import enginePkg from 'radar-blip/package.json'
import { ROUTES, type ApiError, type Req, type Res, type Result, type RouteName } from '../shared/ipc'
import type { Board } from './board'
import { isExternalUrl, openInEditor, type Editor, type Shell } from './system'
import type { AppShim } from './shim'
import type { PathEditor } from './user-path'

export interface RouteDeps {
  board: Board
  shell: Shell
  pickFolder(): Promise<string | null>
  info(): Promise<Res<'app.info'>>
  updates: { check(): Promise<{ devMode: boolean }>; install(): void }
  /** Recolours the native window controls over the top bar. */
  titleBar(colors: { color: string; symbolColor: string }): void
  /** Left out, the editor found on PATH. */
  editor?: Editor | null
  /** Where setup reads and writes, and the shim to write: null in a dev run, which must never point every hook on the machine at a working tree. */
  setup: { targets: Targets; shim: AppShim | null; path: PathEditor }
}

type Handlers = { [K in RouteName]: (req: Req<K>) => Promise<Res<K>> }
type Validators = { [K in RouteName]: (req: unknown) => boolean }

// ---- validators: hand-written guards, no dependency ----

const TEXT_MAX = 4000
const LIST_MAX = 200
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
/** An object with exactly these required keys and any of these optional ones. */
const shape = (x: unknown, required: string[], optional: string[] = []): x is Record<string, unknown> =>
  obj(x) && required.every((k) => k in x) && Object.keys(x).every((k) => required.includes(k) || optional.includes(k))
const str = (x: unknown, max = TEXT_MAX): x is string => typeof x === 'string' && x.length <= max
const strs = (x: unknown): x is string[] => Array.isArray(x) && x.length <= LIST_MAX && x.every((s) => str(s))
const id = (x: unknown): boolean => typeof x === 'string' && /^[0-9a-f]{12}$/.test(x)
const dir = (x: unknown): x is string => str(x, 4096) && x.length > 0 && isAbsolute(x) && !x.includes('\0')
const none = (x: unknown): boolean => x === undefined || x === null
const ref = (x: unknown): boolean => shape(x, ['title']) && str(x.title)
const refOrNull = (x: unknown): boolean => x === null || ref(x)
const dueOrNull = (x: unknown): boolean => x === null || str(x, 40)
const color = (x: unknown): boolean => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x)

const OP_FIELDS = ['name', 'now', 'status', 'focus', 'due', 'tags', 'links']

function editOp(x: unknown): boolean {
  if (!obj(x)) return false
  switch (x.op) {
    case 'task.add':
      return shape(x, ['op', 'title'], ['detail', 'due', 'before']) && str(x.title) && (x.detail === undefined || strs(x.detail)) && (x.due === undefined || str(x.due, 40)) && (x.before === undefined || refOrNull(x.before))
    case 'task.done':
    case 'task.reopen':
    case 'task.remove':
      return shape(x, ['op', 'task']) && ref(x.task)
    case 'task.edit':
      return shape(x, ['op', 'task'], ['title', 'detail', 'due']) && ref(x.task) && (x.title === undefined || str(x.title)) && (x.detail === undefined || strs(x.detail)) && (x.due === undefined || dueOrNull(x.due))
    case 'task.move':
      return shape(x, ['op', 'task', 'before']) && ref(x.task) && refOrNull(x.before)
    case 'set':
      // Which scalar a field takes is the engine's to judge (E_VALUE); here the value must only be one of the shapes some field takes.
      return shape(x, ['op', 'field', 'value']) && OP_FIELDS.includes(x.field as string) && (x.field === 'links' ? links(x.value) : scalar(x.value) || strs(x.value))
    case 'log.add':
      return shape(x, ['op', 'bullets'], ['agent']) && strs(x.bullets) && (x.agent === undefined || str(x.agent, 64))
    default:
      return false
  }
}

const scalar = (x: unknown): boolean => x === null || typeof x === 'boolean' || str(x)
/** `set links`: a short list of URLs or the read model's `{ label, url }` (the engine checks the URLs). */
const links = (x: unknown): boolean =>
  Array.isArray(x) &&
  x.length <= CAPS.LINKS_MAX &&
  x.every((l) => str(l, CAPS.LINK_URL_MAX) || (shape(l, ['label', 'url']) && (l.label === null || str(l.label)) && str(l.url, CAPS.LINK_URL_MAX)))

export const validators: Validators = {
  'projects.list': none,
  'project.edit': (x) => shape(x, ['id', 'ops']) && id(x.id) && Array.isArray(x.ops) && x.ops.length >= 1 && x.ops.length <= LIST_MAX && x.ops.every(editOp),
  'project.undo': (x) => shape(x, ['id', 'undoToken']) && id(x.id) && str(x.undoToken, 100),
  'project.setHidden': (x) => shape(x, ['id', 'hidden']) && id(x.id) && typeof x.hidden === 'boolean',
  'project.untrack': (x) => shape(x, ['id']) && id(x.id),
  'project.create': (x) => shape(x, ['dir'], ['name']) && dir(x.dir) && (x.name === undefined || str(x.name, 200)),
  'discover.find': (x) => shape(x, ['dir']) && dir(x.dir),
  'discover.track': (x) => shape(x, ['dirs']) && Array.isArray(x.dirs) && x.dirs.length >= 1 && x.dirs.length <= 1000 && x.dirs.every(dir),
  'activity.refresh': (x) => none(x) || (shape(x, [], ['ids']) && (x.ids === undefined || (Array.isArray(x.ids) && x.ids.length <= 1000 && x.ids.every(id)))),
  'system.pickFolder': none,
  'system.openExternal': (x) => shape(x, ['url']) && str(x.url, 4096) && isExternalUrl(x.url),
  'system.reveal': (x) => shape(x, ['id']) && id(x.id),
  'system.openInEditor': (x) => shape(x, ['id']) && id(x.id),
  'setup.status': none,
  'setup.run': (x) => shape(x, ['apply']) && typeof x.apply === 'boolean',
  'setup.path': (x) => shape(x, ['apply']) && typeof x.apply === 'boolean',
  'app.info': none,
  'window.titleBar': (x) => shape(x, ['color', 'symbolColor']) && color(x.color) && color(x.symbolColor),
  'update.check': none,
  'update.install': none
}

function toApiError(err: unknown): ApiError {
  if (err instanceof BlipError || (obj(err) && typeof err.code === 'string' && /^E_[A-Z_]+$/.test(err.code) && typeof err.message === 'string')) {
    const e = err as BlipError
    return { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}), ...(e.violations ? { violations: e.violations } : {}) }
  }
  return { code: 'E_INTERNAL', message: err instanceof Error ? err.message : String(err) }
}

/** `app.info`: `owner` is the value `brief.owner` uses (8.1), read once at start and passed in. */
export async function appInfo(version: string, owner: Promise<string | null>): Promise<Res<'app.info'>> {
  return { version, engineVersion: enginePkg.version, platform: process.platform, owner: await owner }
}

export interface Routes {
  dispatch(name: string, req: unknown): Promise<Result<unknown>>
  /** Directories the renderer may name in this run (8.2). */
  grant(dir: string): void
}

export function createRoutes(deps: RouteDeps): Routes {
  const { board } = deps
  const grants = new Set<string>()
  const grant = (d: string): void => void grants.add(projectKey(d))
  const granted = (d: string): string => {
    if (!grants.has(projectKey(d))) {
      throw new BlipError('E_FORBIDDEN_PATH', 'this folder was not picked or found in this session', { hint: 'pick it with the folder picker first' })
    }
    return d
  }
  // A dev run has no shim, so its hooks would name a bare `radar-blip`, which may be some other install
  // (on a v2 machine, the global v2 CLI). It may only apply to config and data folders overridden for it.
  const devApply = (apply: boolean): boolean => {
    if (apply && !deps.setup.shim && !(process.env.CLAUDE_CONFIG_DIR && process.env.RADAR_BLIP_HOME)) {
      throw new BlipError('E_DEV', 'a dev run does not change the real Claude settings or PATH', {
        hint: 'set CLAUDE_CONFIG_DIR and RADAR_BLIP_HOME to throwaway folders, or use a packaged build'
      })
    }
    return apply
  }
  // The node the shim runs is the one to judge, not this process's.
  const doctorOpts = () => ({ targets: deps.setup.targets, ...(deps.setup.shim ? { nodeVersion: deps.setup.shim.nodeVersion } : {}) })
  const handlers: Handlers = {
    'projects.list': async () => {
      await board.ready()
      return { projects: board.list() }
    },
    'project.edit': async ({ id, ops }) => (await board.ready(), board.edit(id, ops)),
    'project.undo': async ({ id, undoToken }) => (await board.ready(), board.undoEdit(id, undoToken)),
    'project.setHidden': async ({ id, hidden }) => (await board.ready(), { record: await board.setHidden(id, hidden) }),
    'project.untrack': async ({ id }) => {
      await board.ready()
      await board.untrack(id)
      return {}
    },
    'project.create': async ({ dir, name }) => {
      await board.ready()
      return board.create(granted(dir), name)
    },
    'discover.find': async ({ dir }) => {
      const { dirs, capped } = await findProjects(granted(dir))
      const found: { dir: string; name: string }[] = []
      for (const d of dirs) {
        grant(d)
        // The board's own rule, so a file that cannot be read is named after its folder here too (8.1). No git, no markers.
        const name = await buildRecord(d, { cachedOnly: true, markers: [] }).then(
          (r) => r.doc?.name ?? basename(d),
          () => basename(d)
        )
        found.push({ dir: d, name })
      }
      return { found, truncated: capped }
    },
    'discover.track': async ({ dirs }) => {
      await board.ready()
      dirs.forEach(granted)
      return { projects: await board.track(dirs) }
    },
    'activity.refresh': async (req) => {
      await board.ready()
      board.refresh(req?.ids)
      return {}
    },
    'system.pickFolder': async () => {
      const d = await deps.pickFolder()
      if (d) grant(d)
      return { dir: d }
    },
    'system.openExternal': async ({ url }) => {
      await deps.shell.openExternal(url)
      return {}
    },
    'system.reveal': async ({ id }) => {
      await board.ready()
      const { dir } = board.get(id)
      if (existsSync(blipPath(dir))) deps.shell.showItemInFolder(blipPath(dir))
      else await deps.shell.openPath(dir)
      return {}
    },
    'system.openInEditor': async ({ id }) => {
      await board.ready()
      const { dir } = board.get(id)
      return { opened: await openInEditor(dir, deps.shell, deps.editor) }
    },
    'setup.status': async () => ({ checks: await runDoctor(doctorOpts()) }),
    'setup.run': async ({ apply }) => {
      const { targets, shim } = deps.setup
      const plan = await planSetup(targets, shim ? { shim } : {})
      const applied = devApply(apply) && plan.changed
      if (applied) await applySetup(plan)
      // Spec 5.4: the PATH change is shown in this diff; it is applied by setup.path (Appendix C).
      const pathChange = await deps.setup.path.plan(join(targets.dataDir, 'bin'))
      const diff = [...describePlan(plan), ...(pathChange ? [`path     ${pathChange}`] : [])]
      return { diff: diff.join('\n'), applied, report: await runDoctor(doctorOpts()) }
    },
    'setup.path': async ({ apply }) => {
      const bin = join(deps.setup.targets.dataDir, 'bin')
      const change = await deps.setup.path.plan(bin)
      return { change, applied: devApply(apply) && change !== null && (await deps.setup.path.apply(bin)) }
    },
    'app.info': () => deps.info(),
    'window.titleBar': async ({ color, symbolColor }) => {
      deps.titleBar({ color, symbolColor })
      return {}
    },
    'update.check': () => deps.updates.check(),
    'update.install': async () => {
      deps.updates.install()
      return {}
    }
  }

  async function dispatch(name: string, req: unknown): Promise<Result<unknown>> {
    const route = name as RouteName
    if (!ROUTES.includes(route) || !validators[route](req)) {
      return { ok: false, error: { code: 'E_BAD_REQUEST', message: `${name}: the request is not in the expected shape` } }
    }
    try {
      const handler = handlers[route] as (r: unknown) => Promise<unknown>
      return { ok: true, data: await handler(req) }
    } catch (err) {
      return { ok: false, error: toApiError(err) }
    }
  }

  return { dispatch, grant }
}

/** Register every route on its own channel (the route's name). */
export function registerRoutes(ipc: { handle(channel: string, fn: (event: unknown, req: unknown) => unknown): void }, routes: Routes): void {
  for (const name of ROUTES) ipc.handle(name, (_event, req) => routes.dispatch(name, req))
}
