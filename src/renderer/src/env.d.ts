import type { Bridge } from '../../shared/ipc'

declare global {
  interface Window {
    /** The preload's two functions (spec 8.2). */
    radar: Bridge
  }
}

export {}
