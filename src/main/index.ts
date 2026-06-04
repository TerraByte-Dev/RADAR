import { app, BrowserWindow, globalShortcut, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/types'
import { registerIpcHandlers } from './ipc/handlers'
import { registerRadarHandlers } from './ipc/radar'
import { Repository } from './store/repository'

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

app.whenReady().then(async () => {
  const repo = await Repository.open()
  registerIpcHandlers(repo)
  registerWindowControls()
  applyProdCsp()
  createWindow()
  // RADAR project model (BLIP.md): scan/watch/write + live push to the renderer.
  stopRadar = registerRadarHandlers(() => mainWindow)
  registerGlobalQuickAdd()

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
