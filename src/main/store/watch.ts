import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'node:path'
import { isSelfWrite } from './selfwrite'

/**
 * Watch every workspace root for BLIP.md changes and fire a debounced callback —
 * skipping echoes of the app's own writes (self-write suppression). Used by the
 * main process to push `radar:projects-changed` when files change underneath us
 * (e.g. an agent runs `/blip handoff` in a tracked repo while RADAR is open).
 */

let watcher: FSWatcher | null = null

export function startWatch(roots: string[], onChange: () => void): void {
  stopWatch()
  if (!roots.length) return
  watcher = chokidar.watch(
    roots.map((r) => join(r, '**/BLIP.md')),
    {
      ignored: /(^|[\\/])(node_modules|\.git|dist|out|build|\.cache)([\\/]|$)/,
      ignoreInitial: true,
      depth: 6
    }
  )
  let timer: NodeJS.Timeout | null = null
  const fire = (path: string): void => {
    if (isSelfWrite(path)) return // the app just wrote this — don't echo it back
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 200)
  }
  watcher.on('add', fire).on('change', fire).on('unlink', fire)
}

export function stopWatch(): void {
  void watcher?.close()
  watcher = null
}
