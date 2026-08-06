import { app, BrowserWindow, globalShortcut, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { IPC, type UpdateEvent } from '../shared/types'
import { registerRadarHandlers } from './ipc/radar'
import { resolveAutoUpdater, updateLog } from './updater'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let stopRadar: (() => void) | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 820,
    minHeight: 560,
    show: false,
    // Frameless: the renderer draws its own TerraByte title bar + window controls.
    frame: false,
    backgroundColor: '#000000',
    icon: join(app.getAppPath(), 'build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The preload only uses contextBridge + ipcRenderer, so it runs sandboxed fine.
      sandbox: true,
      contextIsolation: true,
      // Pin the security-relevant defaults so a future edit can't silently regress them.
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // The app never navigates — block renderer-initiated navigation outright. Dev exception:
  // Vite's full-reload is a same-URL location.reload(), which does emit will-navigate.
  mainWindow.webContents.on('will-navigate', (e) => {
    if (isDev && e.url === mainWindow?.webContents.getURL()) return
    e.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Same allowlist as radar:open-external — never hand a non-web URL to the OS.
    try {
      if (['http:', 'https:'].includes(new URL(details.url).protocol)) {
        shell.openExternal(details.url)
      }
    } catch {
      /* unparseable URL — drop it */
    }
    return { action: 'deny' }
  })

  // electron-vite injects the dev server URL in development.
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerWindowControls(): void {
  ipcMain.on(IPC.minimizeWindow, () => mainWindow?.minimize())
  ipcMain.on(IPC.maximizeWindow, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on(IPC.closeWindow, () => mainWindow?.close())
}

function registerGlobalQuickAdd(): void {
  // Global hotkey: focus the app and open quick-add from anywhere.
  const accelerator = 'CommandOrControl+Shift+Space'
  globalShortcut.register(accelerator, () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send(IPC.openQuickAdd)
  })
}

/**
 * Auto-update IPC (window.api): version readout + a manual check → download → install flow, bridged to
 * electron-updater's events. Packaged-only — in dev every check reports `devMode` and the renderer shows a
 * friendly note (the Updates pane). Handlers are registered synchronously (no invoke race); the updater is
 * loaded lazily so dev never touches it.
 */
function registerUpdates(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())

  if (!app.isPackaged) {
    ipcMain.handle(IPC.updateCheck, async () => ({ devMode: true }))
    ipcMain.handle(IPC.updateDownload, async () => {})
    ipcMain.on(IPC.updateInstall, () => {})
    return
  }

  const send = (event: UpdateEvent): void => getWindow()?.webContents.send(IPC.updateEvent, event)

  const updater = import('electron-updater').then((mod) => {
    // NOT `.then(({ autoUpdater }) => …)` — that destructure is always `undefined`. See updater.ts.
    const autoUpdater = resolveAutoUpdater(mod)

    autoUpdater.logger = updateLog
    updateLog.info(`updater ready — RADAR ${app.getVersion()}, electron ${process.versions.electron}`)
    autoUpdater.autoDownload = false
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

  ipcMain.handle(IPC.updateCheck, async () => {
    try {
      const autoUpdater = await updater
      await bounded(autoUpdater.checkForUpdates())
    } catch (e) {
      fail(e)
    }
    return { devMode: false }
  })
  ipcMain.handle(IPC.updateDownload, async () => {
    try {
      const autoUpdater = await updater
      await autoUpdater.downloadUpdate()
    } catch (e) {
      fail(e)
    }
  })
  ipcMain.on(IPC.updateInstall, () => {
    updater.then((autoUpdater) => autoUpdater.quitAndInstall()).catch(fail)
  })

  // Initial silent check on launch (replaces the old checkForUpdatesAndNotify()).
  updater.then((autoUpdater) => bounded(autoUpdater.checkForUpdates())).catch(() => {
    // Already reported: a load failure by `updater.catch(fail)` above, a check failure by
    // electron-updater's own `error` event + logger. Nothing to add, but the chain needs a sink.
  })
}

/** Strict CSP for the packaged app. Skipped in dev so Vite HMR works. */
function applyProdCsp(): void {
  if (isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; " +
            "object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none';"
        ]
      }
    })
  })
}

// Single instance: a second launch quits immediately and focuses the running window instead
// (two instances would race the watcher, the config file, and the global hotkey).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    registerWindowControls()
    applyProdCsp()
    createWindow()
    // RADAR project model (BLIP.md): scan/watch/write + live push to the renderer.
    stopRadar = registerRadarHandlers(() => mainWindow)
    registerGlobalQuickAdd()

    // Auto-update — packaged builds only; a silent no-op until a release is published
    // (see electron-builder.yml `publish` + docs/RELEASING.md). Drives the Settings → Updates pane.
    registerUpdates(() => mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopRadar?.()
  })
}
