// The e2e harness every renderer stage reuses: the built app (`npm run build` first) launched
// through Playwright's Electron driver against a throwaway world — its own Electron profile, its
// own engine data folder and HOME, the placeholder data set from scripts/demo-data.mjs, and a
// PATH without the machine's global npm folder, so nothing reaches a real registry, a real
// BLIP.md, real Claude settings or an installed radar-blip.
//
// Everything lands under $RADAR_E2E_DIR (default: <os tmp>/radar-e2e), one folder per launch.
// The demo projects are git repositories, and git on Windows cannot write under a path much past
// 200 characters, nor read its config from a HOME past 260: $RADAR_E2E_PROJECTS moves the projects
// and HOME to a short folder, one `w-…` and one `w-…-home` subfolder per launch. It must be outside
// every git checkout (a folder inside this one would read as part of it).
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { assignSlots } from '../src/renderer/src/lib/scope'

export const ROOT = resolve(__dirname, '..')

export interface World {
  dir: string
  data: string
  projects: string
  profile: string
  home: string
}

/** A new, empty world folder. `demo` fills it with the placeholder data set (`extra`: the 40-project one). */
export function makeWorld(opts: { demo?: boolean; extra?: boolean } = {}): World {
  const base = process.env.RADAR_E2E_DIR ?? join(tmpdir(), 'radar-e2e')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'w-'))
  const short = process.env.RADAR_E2E_PROJECTS
  const projects = short ? join(short, basename(dir)) : join(dir, 'projects')
  const home = short ? join(short, `${basename(dir)}-home`) : join(dir, 'data', 'demo-home')
  const w: World = { dir, data: join(dir, 'data'), projects, profile: join(dir, 'profile'), home }
  if (opts.demo) {
    const args = [join(ROOT, 'scripts', 'demo-data.mjs'), '--projects', w.projects, '--data', w.data, '--home', w.home, ...(opts.extra ? ['--extra'] : [])]
    try {
      execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'pipe', env: { ...process.env, RADAR_BLIP_HOME: w.data } })
    } catch (e) {
      throw new Error(`demo-data failed: ${String((e as { stderr?: Buffer }).stderr ?? e)}`)
    }
  } else {
    mkdirSync(w.home, { recursive: true })
  }
  mkdirSync(w.profile, { recursive: true })
  return w
}

/** The environment the app runs in: every folder it could write outside the world points into it. */
export function worldEnv(w: World): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_RENDERER_URL') env[k] = v
  const path = (process.env.PATH ?? process.env.Path ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .filter((d) => !/[\\/]npm[\\/]?$/i.test(d))
    .join(process.platform === 'win32' ? ';' : ':')
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k]
  return {
    ...env,
    PATH: path,
    RADAR_BLIP_HOME: w.data,
    HOME: w.home,
    USERPROFILE: w.home,
    CLAUDE_CONFIG_DIR: join(w.home, '.claude'),
    CODEX_HOME: join(w.home, '.codex')
  }
}

/** The arguments that start the built app in `w`'s profile. */
export const appArgs = (w: World): string[] => [ROOT, `--user-data-dir=${w.profile}`]

export interface App {
  app: ElectronApplication
  page: Page
  world: World
  /** Sets the window's content size, as the spec's screenshot sizes are content sizes. */
  size(width: number, height: number): Promise<void>
  close(): Promise<void>
}

export async function launch(opts: { world?: World; demo?: boolean; size?: [number, number]; env?: Record<string, string> } = {}): Promise<App> {
  const world = opts.world ?? makeWorld({ demo: opts.demo ?? true })
  // One CSS pixel to one screen pixel, so a screenshot at 1280x800 is 1280x800 like the mockup's.
  const app = await _electron.launch({ args: [...appArgs(world), '--force-device-scale-factor=1'], env: { ...worldEnv(world), ...opts.env }, cwd: ROOT })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => document.fonts.ready)
  // The hidden title bar makes the content size and the page's size differ by a pixel or two,
  // so the page is measured and the window corrected until they agree.
  const size = async (width: number, height: number): Promise<void> => {
    let [w, h] = [width, height]
    for (let i = 0; i < 4; i++) {
      await app.evaluate(({ BrowserWindow }, [w, h]) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.unmaximize()
        win.setContentSize(w, h)
      }, [w, h] as const)
      await page.waitForTimeout(150)
      const [iw, ih] = await page.evaluate(() => [window.innerWidth, window.innerHeight])
      if (iw === width && ih === height) return
      ;[w, h] = [w + width - iw, h + height - ih]
    }
    throw new Error(`the window would not take ${width}x${height}`)
  }
  if (opts.size) await size(...opts.size)
  return { app, page, world, size, close: () => app.close() }
}

/**
 * Stores the mockup's bearings for the demo's projects, so the scope's blips sit where they do in
 * radar-design/final/shots. The mockup gives slots to its own ids (the first 24 of
 * scripts/demo-data.mjs); the app's ids are hashes of the demo's paths, so they are matched by
 * name. Projects the mockup does not draw are given slots by the app as it loads. Reloads the page.
 */
export async function mockupBearings(page: Page): Promise<void> {
  const src = readFileSync(join(ROOT, 'scripts', 'demo-data.mjs'), 'utf8')
  const mock = [...src.matchAll(/\{ id: '([\w-]+)', name: '([^']+)'/g)].slice(0, 24)
  const slots = assignSlots(mock.map((m) => m[1]))
  const byName = new Map(mock.map((m) => [m[2], slots[m[1]]]))
  const list = await page.evaluate(() => window.radar.invoke('projects.list'))
  if (!list.ok) throw new Error('projects.list failed')
  const bearings: Record<string, number> = {}
  for (const r of list.data.projects) {
    const s = r.doc ? byName.get(r.doc.name) : undefined
    if (s !== undefined) bearings[r.id] = s
  }
  await page.evaluate((b) => localStorage.setItem('radar.v3', JSON.stringify({ ...JSON.parse(localStorage.getItem('radar.v3') ?? '{}'), bearings: b })), bearings)
  await page.reload()
}
