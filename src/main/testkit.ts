// Test helpers for the v3 backend suites: throwaway data folders and synthetic projects
// built from the engine's own invented fixtures. Never the real data folder.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultTargets, migrateFile, parseBlip, registerProject, type Git } from 'radar-blip'
import { Board } from './board'
import { createRoutes, type RouteDeps } from './ipc'
import { prependEntry, type PathEditor } from './user-path'
import type { EventName, Events } from '../shared/ipc'

const FIXTURES = resolve(__dirname, '../../packages/blip-core/test/fixtures')
/** The skill files `npm run build:core` copies into the engine package. */
export const SKILLS = resolve(__dirname, '../../packages/blip-core/skills')
export const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')
/** The 83 KB fixture, as a v3 file. */
export const big = (): string => migrateFile(parseBlip(fixture('v2/big-83kb.md'), { dirName: 'big' })).text

export function tmp(prefix = 'radar-app-'): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
}

/** A fresh, empty data folder, and Claude and Codex config folders that do not exist. Call in `beforeEach`. */
export function isolate(): string {
  const root = tmp('radar-app-home-')
  process.env.RADAR_BLIP_HOME = join(root, 'data')
  process.env.CLAUDE_CONFIG_DIR = join(root, 'no-claude')
  process.env.CODEX_HOME = join(root, 'no-codex')
  return process.env.RADAR_BLIP_HOME
}

/** A project folder holding `text` as its BLIP.md, registered unless `track` is false. */
export async function project(text: string, name = 'sample', track = true): Promise<string> {
  const dir = join(tmp(), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'BLIP.md'), text)
  if (track) await registerProject(dir)
  return dir
}

export const v3 = (name: string, tasks: string[] = ['First task here']): string =>
  `---\nblip: 3\nname: ${name}\nnow: Working on it.\n---\n\n# Tasks\n\n${tasks.map((t) => `- [ ] ${t}\n`).join('')}\n# Session log\n`

export const bytes = (dir: string): Buffer => readFileSync(join(dir, 'BLIP.md'))

/** A git runner that counts its calls and runs nothing. */
export function gitSpy(): Git & { calls: number } {
  const spy = {
    calls: 0,
    run: async (): Promise<string> => {
      spy.calls++
      throw new Error('no git in this test')
    }
  }
  return spy
}

/** A stand-in for the user's PATH: one string, and every folder `apply` was asked to add. */
export function pathRecorder(value = ''): PathEditor & { value: string; applied: string[] } {
  const r = {
    value,
    applied: [] as string[],
    plan: async (bin: string) => (prependEntry(r.value, bin) === null ? null : `put ${bin} first on your user Path`),
    apply: async (bin: string) => {
      r.applied.push(bin)
      r.value = prependEntry(r.value, bin) ?? r.value
      return true
    }
  }
  return r
}

export interface Harness {
  board: Board
  routes: ReturnType<typeof createRoutes>
  events: { event: EventName; payload: unknown }[]
  deps: RouteDeps
  call<T = any>(name: string, req?: unknown): Promise<T>
}

/** A board and its routes, with Electron's parts replaced by recorders. */
export function harness(opts: { git?: Git | null; pick?: string | null; deps?: Partial<RouteDeps> } = {}): Harness {
  const events: Harness['events'] = []
  const emit = <E extends EventName>(event: E, payload: Events[E]): void => void events.push({ event, payload })
  const board = new Board({ emit, author: 'Robin', git: opts.git === undefined ? null : opts.git })
  const deps: RouteDeps = {
    board,
    shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
    pickFolder: async () => opts.pick ?? null,
    info: async () => ({ version: '0.0.0', engineVersion: '0.0.0', platform: 'test', owner: null }),
    updates: { check: async () => ({ devMode: true }), install: () => {} },
    titleBar: () => {},
    editor: null,
    // The folders isolate() set, never the real Claude or Codex config; and PATH is never edited.
    setup: { targets: { ...defaultTargets(), skillsDir: SKILLS }, shim: null, path: pathRecorder() },
    ...opts.deps
  }
  const routes = createRoutes(deps)
  return {
    board,
    routes,
    events,
    deps,
    call: (name, req) => routes.dispatch(name, req) as Promise<any>
  }
}
