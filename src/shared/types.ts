// Shared types — used by both the main (IPC) and renderer processes.
// The RADAR project model (ProjectRecord, RadarApi, …) lives in shared/radar.ts;
// this file holds the app chrome surface (window.api) + the quick-add value types.

export type Priority = 'P1' | 'P2' | 'P3' | 'P4' | 'none'

export interface DueDate {
  /** ISO date string (date or full datetime). */
  date: string
  /** Whether a specific time-of-day was set (vs. an all-day due date). */
  hasTime: boolean
}

/** IPC channel names — single source of truth for main + preload. */
export const IPC = {
  openQuickAdd: 'ui:open-quick-add',
  // Frameless-window chrome (custom title bar controls).
  minimizeWindow: 'window:minimize',
  maximizeWindow: 'window:maximize',
  closeWindow: 'window:close',
  // RADAR / BLIP.md project model (window.radar).
  radarScan: 'radar:scan',
  radarRead: 'radar:read',
  radarSetFields: 'radar:set-fields',
  radarTask: 'radar:task',
  radarHandoff: 'radar:handoff',
  radarInit: 'radar:init',
  radarDelete: 'radar:delete',
  radarInboxAdd: 'radar:inbox-add',
  radarConfigGet: 'radar:config-get',
  radarAddRoot: 'radar:add-root',
  radarRemoveRoot: 'radar:remove-root',
  radarIgnore: 'radar:ignore',
  radarUnignore: 'radar:unignore',
  radarPickFolder: 'radar:pick-folder',
  radarOpenPath: 'radar:open-path',
  radarReveal: 'radar:reveal',
  radarOpenInEditor: 'radar:open-in-editor',
  /** Push channel: main → renderer when the watcher sees BLIP.md changes. */
  radarProjectsChanged: 'radar:projects-changed',
  // App + auto-update (window.api). electron-updater is packaged-only; dev reports devMode.
  appGetVersion: 'app:get-version',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  /** Push channel: main → renderer with auto-update progress. */
  updateEvent: 'update:event'
} as const

/** Auto-update lifecycle, pushed from main → renderer on the `update:event` channel. */
export type UpdateEvent =
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

/** The typed app-chrome surface exposed on `window.api` by the preload script. */
export interface AppApi {
  /** Subscribe to the global quick-add hotkey; returns an unsubscribe fn. */
  onOpenQuickAdd(cb: () => void): () => void
  /** Frameless-window controls. */
  minimizeWindow(): void
  maximizeWindow(): void
  closeWindow(): void
  /** Installed app version (e.g. "0.1.0"). */
  getAppVersion(): Promise<string>
  /** Trigger an update check. `devMode: true` in unpackaged builds (auto-update is packaged-only). */
  checkForUpdates(): Promise<{ devMode: boolean }>
  /** Start downloading an available update. */
  downloadUpdate(): Promise<void>
  /** Quit and install a downloaded update. */
  installUpdate(): void
  /** Subscribe to auto-update lifecycle events; returns an unsubscribe fn. */
  onUpdateEvent(cb: (event: UpdateEvent) => void): () => void
}
