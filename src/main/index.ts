import { app, BrowserWindow, dialog, ipcMain, screen, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { userInfo } from 'node:os'
import { defaultTargets, ensure, ownerName, type Targets } from 'radar-blip'
import type { EventName, Events } from '../shared/ipc'
import { Board } from './board'
import { appInfo, createRoutes, registerRoutes } from './ipc'
import { registerUpdates } from './updater'
import { shimTarget, type AppShim } from './shim'
import { posixPath, windowsPath, type PathEditor } from './user-path'
import { readWindowState, settle, writeWindowState, type Rect } from './window-state'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let board: Board | null = null

/** The v3 poll runs only while the window can be seen (spec 8.4). */
function trackVisibility(win: BrowserWindow): void {
  const update = (): void => board?.setVisible(!win.isDestroyed() && win.isVisible() && !win.isMinimized())
  for (const e of ['show', 'hide', 'minimize', 'restore', 'closed'] as const) win.on(e as 'show', update)
  win.on('focus', () => board?.focused())
  update()
}

function emit<E extends EventName>(event: E, payload: Events[E]): void {
  const w = mainWindow
  if (w && !w.isDestroyed()) w.webContents.send(event, payload)
}

/** The backend: the board, its poll, and the route table. */
function startV3(): void {
  const owner = ownerName().catch(() => null)
  const author = owner.then((o) => o ?? (userInfo().username || 'RADAR')).catch(() => 'RADAR')
  board = new Board({ emit, author })
  const routes = createRoutes({
    board,
    shell,
    pickFolder: async () => {
      const opts = { properties: ['openDirectory' as const] }
      const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
    },
    info: () => appInfo(app.getVersion(), owner),
    updates,
    titleBar: (colors) => {
      if (mainWindow && !mainWindow.isDestroyed() && process.platform !== 'darwin') mainWindow.setTitleBarOverlay(colors)
    },
    setup: setupTargets()
  })
  registerRoutes(ipcMain, routes)
  void board.ready()
  if (mainWindow) trackVisibility(mainWindow)
}

let updates: ReturnType<typeof registerUpdates>

/**
 * Where setup works (spec 5.4): the engine's own targets, with the skill files this app ships.
 * The shim runs the bundled CLI, in packaged builds only: a dev run must never point the shim
 * every hook on the machine runs at a working tree.
 */
function setupTargets(): { targets: Targets; shim: AppShim | null; path: PathEditor } {
  const skillsDir = isDev ? join(app.getAppPath(), 'packages', 'blip-core', 'skills') : join(process.resourcesPath, 'skills')
  const cli = join(process.resourcesPath, 'cli', 'radar-blip.mjs')
  return {
    targets: { ...defaultTargets(), skillsDir },
    shim: !isDev && existsSync(cli) ? shimTarget(cli, process.execPath) : null,
    path: process.platform === 'win32' ? windowsPath() : posixPath()
  }
}

/**
 * `setup.ensure()` on every start: the shim follows this build, and RADAR's own hooks and skill,
 * when they are installed, follow this engine. Nothing is installed for the first time here.
 */
function ensureSetup(): void {
  const { targets, shim } = setupTargets()
  if (!shim) return
  ensure(targets, shim).catch((e) => console.error('setup.ensure failed', e))
}

function createWindow(): void {
  const stateFile = join(app.getPath('userData'), 'window.json')
  const saved = readWindowState(stateFile, screen.getAllDisplays().map((d) => d.workArea))
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    minWidth: 820,
    minHeight: 560,
    show: false,
    // The renderer draws the top bar; the native window controls sit over its right end
    // (138px reserved there), recoloured by the renderer's theme through window.titleBar.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: '#050706', symbolColor: '#A6B3AB', height: 43 } }),
    backgroundColor: '#050706',
    // A packaged resource: `build/` is not inside the asar.
    icon: isDev ? join(app.getAppPath(), 'build/icon.png') : join(process.resourcesPath, 'icon.png'),
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

  const w = mainWindow
  // Saved and restored as content bounds. The outer bounds of a frameless window on a scaled
  // display do not round-trip: restored from them the window grew several pixels a launch.
  let normal: Rect
  if (saved.x !== undefined && saved.y !== undefined) {
    normal = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    w.setContentBounds(normal)
  } else {
    w.setContentSize(saved.width, saved.height)
    normal = w.getContentBounds()
  }
  const remember = (): void => {
    if (!w.isMaximized() && !w.isMinimized() && !w.isFullScreen()) normal = settle(normal, w.getContentBounds())
  }
  w.on('resize', remember)
  w.on('move', remember)
  w.on('ready-to-show', () => {
    if (saved.maximized) w.maximize()
    w.show()
  })
  w.on('close', () => {
    try {
      writeWindowState(stateFile, normal, w.isMaximized())
    } catch {
      /* losing the window position is not worth failing a close over */
    }
  })

  // The app never navigates — block renderer-initiated navigation outright. Dev exception:
  // Vite's full-reload is a same-URL location.reload(), which does emit will-navigate.
  mainWindow.webContents.on('will-navigate', (e) => {
    if (isDev && e.url === mainWindow?.webContents.getURL()) return
    e.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Web URLs only — never hand any other scheme to the OS.
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
// (two instances would race the poll and the registry).
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
    applyProdCsp()
    createWindow()

    // Auto-update — packaged builds only; a silent no-op until a release is published
    // (see electron-builder.yml `publish` + docs/RELEASING.md).
    updates = registerUpdates(() => mainWindow)

    // The backend (spec section 8).
    startV3()
    ensureSetup()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
        if (mainWindow) trackVisibility(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    board?.stop()
  })
}
