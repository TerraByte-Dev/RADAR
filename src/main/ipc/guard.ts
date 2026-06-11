import { stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'

/**
 * Path validation for the radar IPC surface. Renderer-supplied paths are untrusted (a
 * compromised renderer can invoke any channel with any argument): without these checks
 * `radar:delete` is an arbitrary unlink, and `radar:set-fields`/`task`/`handoff` rewrite
 * ANY file — `Blip.parse` never throws, so pointing them at a non-BLIP file prepends
 * frontmatter to it (a corruption primitive). Every path-taking handler funnels through
 * here; failures throw, which `ipcMain.handle` propagates as a rejected `invoke`.
 */

/** True if `target` (already resolved) lives strictly under `root` — no `..` escape. */
export function isUnderRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Validate a renderer-supplied BLIP.md path: must literally name a `BLIP.md` and resolve
 * under one of the configured scan roots. The Inbox always qualifies — the workspace is
 * unconditionally a root (see `getConfig` in store/config.ts). Returns the resolved path.
 */
export function assertBlipPath(blipPath: string, roots: string[]): string {
  const target = resolve(blipPath)
  if (basename(target) !== 'BLIP.md') {
    throw new Error(`refusing to touch a non-BLIP.md path: ${blipPath}`)
  }
  if (!roots.some((root) => isUnderRoot(root, target))) {
    throw new Error(`path is outside every configured root: ${blipPath}`)
  }
  return target
}

/** Validate a renderer-supplied init/adopt target: must be an existing directory. */
export async function assertInitDir(dir: string): Promise<string> {
  const target = resolve(dir)
  const s = await stat(target).catch(() => null)
  if (!s?.isDirectory()) throw new Error(`not an existing directory: ${dir}`)
  return target
}
