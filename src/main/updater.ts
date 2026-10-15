import { app, type BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppUpdater } from 'electron-updater'
import type { UpdateEvent } from '../shared/ipc'

/** The shape `import('electron-updater')` actually produces — see `resolveAutoUpdater`. */
type UpdaterModule = { autoUpdater?: AppUpdater; default?: { autoUpdater?: AppUpdater } }

/**
 * Pull `autoUpdater` out of a dynamically-imported electron-updater.
 *
 * electron-updater does not export `autoUpdater` statically — it installs it last, as a lazy getter:
 * `Object.defineProperty(exports, 'autoUpdater', { enumerable: true, get: () => … })`. Node's
 * CJS→ESM named-export detection (cjs-module-lexer) does not recognise that getter shape, so the
 * namespace built for `import('electron-updater')` has **no** `autoUpdater` key. Destructuring it
 * yields `undefined`, and the first property write on it throws — which is exactly how RADAR's
 * update check came to hang forever with no result and no error. `default` is `module.exports`, so
 * it reaches the getter. Verified against electron-updater 6.8.3 on Electron 33 / Node 20.18.
 */
export function resolveAutoUpdater(mod: UpdaterModule): AppUpdater {
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
  if (!autoUpdater) throw new Error('electron-updater loaded but exposed no autoUpdater')
  return autoUpdater
}

/**
 * The updater's flight recorder — `<userData>/logs/updater.log`.
 *
 * electron-updater accepts any `{ info, warn, error, debug }` object as `autoUpdater.logger`, and
 * defaults to `console`, which in a packaged app goes nowhere. That is why a first-statement
 * TypeError in `registerUpdates` was invisible for six weeks. This logger also wraps the
 * `import('electron-updater')` call itself, which the updater's own logger cannot.
 *
 * Deliberately not `electron-log`: the need is ~25 lines and zero new bytes in the asar.
 */
const MAX_BYTES = 256 * 1024

/** Resolved lazily — this module must be import-safe before `app.whenReady()`. */
const updateLogPath = (): string => join(app.getPath('logs'), 'updater.log')

function write(level: string, message: unknown): void {
  const text = message instanceof Error ? (message.stack ?? message.message) : String(message ?? '')
  try {
    const file = updateLogPath()
    mkdirSync(dirname(file), { recursive: true })
    // Cheap rotation: this is diagnostics, not an audit trail — start over when it gets big.
    try {
      if (statSync(file).size > MAX_BYTES) truncateSync(file, 0)
    } catch {
      /* first run — no file yet */
    }
    appendFileSync(file, `${new Date().toISOString()} [${level}] ${text}\n`, 'utf8')
  } catch {
    /* diagnostics must never take the app down */
  }
}

/** The shape electron-updater expects for `autoUpdater.logger`. */
export const updateLog = {
  info: (m: unknown): void => write('info', m),
  warn: (m: unknown): void => write('warn', m),
  error: (m: unknown): void => write('error', m),
  debug: (m: unknown): void => write('debug', m)
}

/** What the routes `update.check` / `update.install` call. */
export interface Updates {
  check(): Promise<{ devMode: boolean }>
  install(): void
}

/**
 * Auto-update: a check that downloads what it finds (`autoDownload`), and an install, bridged to
 * electron-updater's events on `update.event`. Packaged-only — in dev every check reports `devMode`.
 * The updater is loaded lazily so dev never touches it.
 */
export function registerUpdates(getWindow: () => BrowserWindow | null): Updates {
  if (!app.isPackaged) return { check: async () => ({ devMode: true }), install: () => {} }

  const send = (event: UpdateEvent): void => {
    const w = getWindow()
    if (!w || w.isDestroyed()) return
    w.webContents.send('update.event', event)
  }

  const updater = import('electron-updater').then((mod) => {
    // NOT `.then(({ autoUpdater }) => …)` — that destructure is always `undefined`. See resolveAutoUpdater.
    const autoUpdater = resolveAutoUpdater(mod)

    autoUpdater.logger = updateLog
    updateLog.info(`updater ready — RADAR ${app.getVersion()}, electron ${process.versions.electron}`)
    // Download as soon as an update is found; `downloaded` lets the renderer offer "restart to update" (spec 8.7).
    autoUpdater.autoDownload = true
    autoUpdater.on('update-available', (info) => send({ type: 'available', version: info.version }))
    autoUpdater.on('update-not-available', () => send({ type: 'not-available' }))
    autoUpdater.on('download-progress', (p) => send({ type: 'progress', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => send({ type: 'downloaded', version: info.version }))
    autoUpdater.on('error', (err) =>
      send({ type: 'error', message: err instanceof Error ? err.message : String(err ?? 'unknown error') })
    )
    return autoUpdater
  })

  // Failing to load the updater at all is the one error electron-updater can never report itself
  // (its `error` listeners are attached inside the callback that threw). Record it, and surface it.
  const fail = (e: unknown): void => {
    updateLog.error(e)
    send({ type: 'error', message: e instanceof Error ? e.message : String(e ?? 'unknown error') })
  }
  updater.catch(fail)

  // electron-updater has no working HTTP timeout under Electron: HttpExecutor.addTimeOutHandler
  // hooks `request.on('socket')`, and electron's net.ClientRequest never emits `socket`. Combined
  // with AppUpdater caching `checkForUpdatesPromise` until it settles, one stalled connection would
  // wedge every later check for the life of the process — the same silent-spinner signature.
  const CHECK_TIMEOUT_MS = 30_000
  const bounded = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('update check timed out')), CHECK_TIMEOUT_MS).unref?.()
      )
    ])

  const updates: Updates = {
    check: async () => {
      try {
        const autoUpdater = await updater
        await bounded(autoUpdater.checkForUpdates())
      } catch (e) {
        fail(e)
      }
      return { devMode: false }
    },
    install: () => {
      updater.then((autoUpdater) => autoUpdater.quitAndInstall()).catch(fail)
    }
  }

  // Initial silent check on launch (replaces the old checkForUpdatesAndNotify()).
  updater.then((autoUpdater) => bounded(autoUpdater.checkForUpdates())).catch(() => {
    // Already reported: a load failure by `updater.catch(fail)` above, a check failure by
    // electron-updater's own `error` event + logger. Nothing to add, but the chain needs a sink.
  })

  return updates
}
