import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppUpdater } from 'electron-updater'

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
