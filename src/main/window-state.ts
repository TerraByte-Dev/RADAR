// Window bounds and maximised state, kept in `<userData>/window.json` (spec 8.7). Written with
// temp + rename; a missing, corrupt or nonsensical file means the defaults.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface WindowState {
  /** Absent when the saved position is on no display any more. */
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export const DEFAULT_WINDOW: WindowState = { width: 1180, height: 800, maximized: false }

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** The saved state, sized no smaller than the window's minimum and placed only where a display (`workAreas`) can show it. */
export function readWindowState(file: string, workAreas: Rect[], min = { width: 820, height: 560 }): WindowState {
  let saved: Record<string, unknown>
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { ...DEFAULT_WINDOW }
  }
  if (!saved || typeof saved !== 'object' || !int(saved.width) || !int(saved.height)) return { ...DEFAULT_WINDOW }
  const state: WindowState = { width: Math.max(saved.width, min.width), height: Math.max(saved.height, min.height), maximized: saved.maximized === true }
  if (int(saved.x) && int(saved.y) && workAreas.some((a) => intersects({ x: saved.x as number, y: saved.y as number, width: state.width, height: state.height }, a))) {
    state.x = saved.x
    state.y = saved.y
  }
  return state
}

/**
 * `next`, unless it differs from `prev` by at most a pixel on every side: on a scaled display
 * the platform rounds a restored window by a pixel, and taking that grew the window a pixel
 * every launch.
 */
export function settle(prev: Rect, next: Rect): Rect {
  const same = (['x', 'y', 'width', 'height'] as const).every((k) => Math.abs(next[k] - prev[k]) <= 1)
  return same ? prev : next
}

export function writeWindowState(file: string, bounds: Rect, maximized: boolean): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ ...bounds, maximized })}\n`)
  renameSync(tmp, file)
}
