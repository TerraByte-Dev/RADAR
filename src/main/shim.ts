// The `radar-blip` command the app ships (spec 5.4). The packaged app carries the CLI as one
// bundled file (`resources/cli/radar-blip.mjs`); the engine's setup keeps a shim at a path that
// never changes, `<data>/bin/radar-blip.cmd` (Windows) or `<data>/bin/radar-blip`, pointing at
// it. This file only decides what the shim runs.
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { nodeIsOld, type ShimTarget } from 'radar-blip'

/** What the shim runs, and the node version that runtime is (what `setup.status` judges). */
export type AppShim = ShimTarget & { nodeVersion: string }

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** `node -v` of that binary; null when it cannot be run. */
export function nodeVersionOf(exe: string): string | null {
  try {
    return execFileSync(exe, ['-v'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim() || null
  } catch {
    return null
  }
}

/**
 * The `node` in the first absolute PATH entry that has one new enough for the bundled CLI.
 * Relative entries are never consulted.
 */
export function findNode(
  pathEnv: string,
  platform: NodeJS.Platform,
  versionOf: (exe: string) => string | null = nodeVersionOf
): { path: string; version: string } | null {
  const exe = platform === 'win32' ? 'node.exe' : 'node'
  for (const d of pathEnv.split(platform === 'win32' ? ';' : delimiter)) {
    if (!d || !isAbsolute(d) || !isFile(join(d, exe))) continue
    const version = versionOf(join(d, exe))
    if (version && !nodeIsOld(version)) return { path: join(d, exe), version }
  }
  return null
}

/** The bundled CLI run by the `node` on PATH, or, when there is none new enough, by the app's own executable as node. */
export function shimTarget(
  cli: string,
  appExe: string,
  pathEnv: string = process.env.PATH ?? process.env.Path ?? '',
  platform: NodeJS.Platform = process.platform,
  versionOf?: (exe: string) => string | null
): AppShim {
  const node = findNode(pathEnv, platform, versionOf)
  return node ? { cli, runtime: node.path, nodeVersion: node.version } : { cli, runtime: appExe, electron: true, nodeVersion: process.versions.node }
}
