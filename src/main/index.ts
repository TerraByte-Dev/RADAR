import { app, BrowserWindow, globalShortcut, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { IPC, type UpdateEvent } from '../shared/types'
import { registerRadarHandlers } from './ipc/radar'

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
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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

  const updater = import('electron-updater').then(({ autoUpdater }) => {
    const send = (event: UpdateEvent): void => getWindow()?.webContents.send(IPC.updateEvent, event)
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

  ipcMain.handle(IPC.updateCheck, async () => {
    const autoUpdater = await updater
    await autoUpdater.checkForUpdates()
    return { devMode: false }
  })
  ipcMain.handle(IPC.updateDownload, async () => {
    const autoUpdater = await updater
    await autoUpdater.downloadUpdate()
  })
  ipcMain.on(IPC.updateInstall, () => {
    updater.then((autoUpdater) => autoUpdater.quitAndInstall()).catch(() => {})
  })

  // Initial silent check on launch (replaces the old checkForUpdatesAndNotify()).
  updater.then((autoUpdater) => autoUpdater.checkForUpdates()).catch(() => {})
}

/** Strict CSP for the packaged app. Skipped in dev so Vite HMR works. */
function applyProdCsp(): void {
  if (isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;"
        ]
      }
    })
  })
}

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
