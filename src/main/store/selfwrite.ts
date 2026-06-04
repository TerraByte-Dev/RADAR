import { resolve } from 'node:path'

/**
 * Self-write suppression for the BLIP.md file watcher.
 *
 * When the app writes a BLIP.md (a field edit, task toggle, handoff…), chokidar
 * fires a `change` for that same file. Without suppression that echo triggers a
 * redundant full rescan + `projects:changed` push right after the IPC handler
 * already returned the fresh record. We note each self-written path for a short
 * window; the watcher skips events for paths still inside it.
 */
const recent = new Map<string, number>()
const WINDOW_MS = 1500

/** Record that the app just wrote `path`, so the next watcher event for it is ignored. */
export function noteSelfWrite(path: string): void {
  recent.set(resolve(path), Date.now() + WINDOW_MS)
}

/** True if `path` was written by the app within the suppression window (expired entries are pruned). */
export function isSelfWrite(path: string): boolean {
  const key = resolve(path)
  const until = recent.get(key)
  if (until === undefined) return false
  if (Date.now() > until) {
    recent.delete(key)
    return false
  }
  return true
}
