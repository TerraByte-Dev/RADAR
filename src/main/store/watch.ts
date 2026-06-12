import chokidar, { type FSWatcher } from 'chokidar'
import { isAbsolute, join, relative } from 'node:path'
import { SKIP_DIRS } from './projects'
import { isSelfWriteEcho } from './selfwrite'

/**
 * Watch every workspace root for BLIP.md changes and fire a debounced callback —
 * skipping echoes of the app's own writes (content-hash self-write suppression).
 * Used by the main process to push `radar:projects-changed` when files change
 * underneath us (e.g. an agent runs `/blip handoff` in a tracked repo while RADAR
 * is open).
 */

let watcher: FSWatcher | null = null
let debounce: NodeJS.Timeout | null = null

/**
 * Mirror the scanner's skip rules (`SKIP_DIRS` + dot-dirs), judged on the path *below*
 * each root — so a root that itself lives inside a dotted/skipped folder still works,
 * and a nested root can rescue a path its outer root would skip (exactly like the
 * scanner, which judges children per root). Exported for tests.
 */
export function makeIgnored(roots: string[]): (path: string) => boolean {
  return (path) => {
    let underSomeRoot = false
    for (const root of roots) {
      const rel = relative(root, path)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue // not under this root
      underSomeRoot = true
      const skipped = rel.split(/[\\/]/).some((part) => SKIP_DIRS.has(part) || part.startsWith('.'))
      if (!skipped) return false // some root accepts it → watch it
    }
    return underSomeRoot
  }
}

export function startWatch(roots: string[], maxDepth: number, onChange: () => void): void {
  void stopWatch()
  if (!roots.length) return
  watcher = chokidar.watch(
    // NOTE: glob watch targets are a chokidar@3 feature — chokidar 4 removed glob
    // support, so an upgrade must switch to watching the roots and filtering paths.
    roots.map((r) => join(r, '**/BLIP.md')),
    {
      ignored: makeIgnored(roots),
      ignoreInitial: true,
      // The scanner descends `maxDepth` directory levels; +1 covers the BLIP.md file itself.
      depth: maxDepth + 1,
      // The scanner never follows symlinks — keep parity (and avoid symlink-cycle loops).
      followSymlinks: false
    }
  )
  const fire = (path: string): void => {
    void isSelfWriteEcho(path).then((echo) => {
      if (echo) return // the app just wrote these exact bytes — don't echo it back
      if (!watcher) return // stopped (or restarted) while we were hashing — don't re-arm
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(onChange, 200)
    })
  }
  watcher.on('add', fire).on('change', fire).on('unlink', fire)
}

export async function stopWatch(): Promise<void> {
  if (debounce) {
    clearTimeout(debounce)
    debounce = null
  }
  const w = watcher
  watcher = null
  await w?.close()
}
