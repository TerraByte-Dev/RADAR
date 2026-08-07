import chokidar, { type FSWatcher } from 'chokidar'
import { readdirSync, type Dirent } from 'node:fs'
import { basename, isAbsolute, join, relative } from 'node:path'
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
 * Is `dir` a project or ghost boundary — the same question `classify()` asks of its entries?
 * The dirent types matter and must match it exactly: `.git` counts only as a **directory** (a git
 * worktree or submodule checkout has `.git` as a *file*, and the scanner walks straight through
 * those), the three markers count only as **files**, and all four are case-sensitive. A looser
 * probe here is the dangerous direction — it would make the watcher skip a directory the scanner
 * still surfaces, so the renderer would show a project that never updates, with no error.
 */
function readBoundary(dir: string): boolean {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false // unreadable — the scanner skips it too
  }
  return entries.some((e) =>
    e.isDirectory()
      ? e.name === '.git'
      : e.isFile() && (e.name === 'BLIP.md' || e.name === 'CLAUDE.md' || e.name === 'AGENTS.md')
  )
}

/**
 * Mirror the scanner's skip rules (`SKIP_DIRS` + dot-dirs) **and its boundaries**, judged on the
 * path *below* each root — so a root that itself lives inside a dotted/skipped folder still works,
 * and a nested root can rescue a path its outer root would skip (exactly like the scanner, which
 * judges children per root). Exported for tests.
 *
 * Boundary parity is a cost rule, not only a correctness one. `classify()` stops descending at a
 * project or ghost directory, so without the same rule the watcher walks — and holds a watch handle
 * on — every subfolder of every blip it already found: 1,492 directories and 30,362 files on a real
 * 11-root workspace, against 15 and 12 with parity. Memoized per watcher; a boundary that appears
 * later (an adopt) is picked up by the next `rewatch`.
 *
 * A boundary directory still watches its **own** `BLIP.md` — that file is the whole point — so for
 * that one basename the ancestor walk stops a level short of the containing directory. The walk
 * includes the root itself, because a root is very often a single project folder rather than a
 * container of them.
 */
export function makeIgnored(roots: string[]): (path: string) => boolean {
  const boundaries = new Map<string, boolean>()
  const isBoundary = (dir: string): boolean => {
    let hit = boundaries.get(dir)
    if (hit === undefined) {
      hit = readBoundary(dir)
      boundaries.set(dir, hit)
    }
    return hit
  }
  return (path) => {
    let underSomeRoot = false
    for (const root of roots) {
      const rel = relative(root, path)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue // not under this root
      underSomeRoot = true
      const parts = rel.split(/[\\/]/)
      if (parts.some((part) => SKIP_DIRS.has(part) || part.startsWith('.'))) continue
      // Ancestor directories to judge: the root, then each segment down to the containing
      // directory — minus that last one when the path is a BLIP.md, so a blip keeps its own file.
      const upto = basename(path) === 'BLIP.md' ? parts.length - 2 : parts.length - 1
      let below = false
      if (upto >= 0) {
        let dir = root
        below = isBoundary(dir)
        for (let i = 0; i < upto && !below; i++) {
          dir = join(dir, parts[i]!)
          below = isBoundary(dir)
        }
      }
      if (!below) return false // some root accepts it → watch it
    }
    return underSomeRoot
  }
}

export function startWatch(roots: string[], maxDepth: number, onChange: () => void): void {
  void stopWatch()
  if (!roots.length) return
  // Watch the roots and filter by basename in `fire` — NOT a `**/BLIP.md` glob target.
  // chokidar@3 skips its 1 s per-directory readdir throttle whenever the target is a glob
  // (`hasGlob` in `nodefs-handler.js#_handleRead`), so every raw change notification spawned a
  // full readdirp + glob match. One atomic BLIP.md write fires ~10 of those, which cost ~120 ms
  // of CPU instead of ~8 ms and starved the threadpool the write itself was using — the app spiked
  // on every task toggle. Self-write suppression could never help: it runs *after* chokidar has
  // already paid. Watching plain roots also matches chokidar 4, which removed glob support.
  watcher = chokidar.watch(roots, {
    ignored: makeIgnored(roots),
    ignoreInitial: true,
    // The scanner descends `maxDepth` directory levels; +1 covers the BLIP.md file itself.
    depth: maxDepth + 1,
    // The scanner never follows symlinks — keep parity (and avoid symlink-cycle loops).
    followSymlinks: false
  })
  const fire = (path: string): void => {
    if (basename(path) !== 'BLIP.md') return // the glob target used to do this filtering
    void isSelfWriteEcho(path).then((echo) => {
      if (echo) return // the app just wrote these exact bytes — don't echo it back
      if (!watcher) return // stopped (or restarted) while we were hashing — don't re-arm
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(onChange, 200)
    })
  }
  // An unhandled 'error' on an EventEmitter throws in the main process; a watch on a folder that
  // vanishes mid-session must not take the app down with it.
  watcher
    .on('add', fire)
    .on('change', fire)
    .on('unlink', fire)
    .on('error', (e) => console.warn('[radar] watcher error', e))
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
