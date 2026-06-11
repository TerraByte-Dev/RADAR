import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Self-write suppression for the BLIP.md file watcher — **content-hash based**.
 *
 * When the app writes a BLIP.md (a field edit, task toggle, handoff…), chokidar fires
 * a `change` for that same file. Without suppression that echo triggers a redundant
 * full rescan + `projects:changed` push right after the IPC handler already returned
 * the fresh record. A naive path+time window would also swallow an *agent's* write
 * landing inside the window — breaking the live agent→radar loop the app exists for —
 * so instead we record the sha256 of the exact bytes the app wrote: a watcher event
 * whose on-disk bytes match a recent recorded write is our echo (consumed, suppressed
 * once); anything else rescans. An agent write with byte-identical content is also
 * suppressed, which is fine — it changes nothing visible.
 */

const WINDOW_MS = 5000

/** Recent self-writes per resolved path; `hash: null` records a self-delete (unlink echo). */
const recent = new Map<string, { hash: string | null; at: number }[]>()

const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex')

/** Record that the app is writing `content` to `path` — or unlinking it (`content: null`). */
export function noteSelfWrite(path: string, content: string | null): void {
  const key = resolve(path)
  const entry = { hash: content === null ? null : sha256(content), at: Date.now() }
  recent.set(key, [...(recent.get(key) ?? []), entry])
}

/** Find + consume one live record matching `hash`, pruning expired entries as it goes. */
function takeMatch(key: string, hash: string | null): boolean {
  const cutoff = Date.now() - WINDOW_MS
  const live = (recent.get(key) ?? []).filter((r) => r.at >= cutoff)
  const i = live.findIndex((r) => r.hash === hash)
  if (i !== -1) live.splice(i, 1)
  if (live.length) recent.set(key, live)
  else recent.delete(key)
  return i !== -1
}

/**
 * True if the watcher event for `path` is the echo of the app's own write: the file's
 * current bytes hash-match a recent (≤5 s) recorded self-write — an unreadable/gone file
 * matches a recorded self-delete. Each record suppresses at most one event, so duplicate
 * watcher events for one write may cost a redundant (harmless, debounced) rescan.
 */
export async function isSelfWriteEcho(path: string): Promise<boolean> {
  const key = resolve(path)
  if (!recent.has(key)) return false // fast path: not a path we recently wrote
  let hash: string | null
  try {
    hash = sha256(await readFile(key, 'utf8'))
  } catch {
    hash = null // file gone — only an echo if we recorded a self-delete
  }
  return takeMatch(key, hash)
}
