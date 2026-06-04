import { app } from 'electron'
import { join, delimiter } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import type { RadarConfig } from '../../shared/radar'

/**
 * RADAR config: which workspace roots to scan for BLIP.md, how deep, and the
 * app-managed workspace folder that holds the Inbox blip. Persisted as JSON in
 * the per-user app-data dir; `RADAR_WORKSPACE` (path-list) adds ephemeral roots.
 */

interface PersistedConfig {
  roots?: string[]
  maxDepth?: number
  workspace?: string
  ignored?: string[]
}

const DEFAULT_MAX_DEPTH = 5

function configPath(): string {
  return join(app.getPath('userData'), 'radar-config.json')
}

/** Default RADAR workspace — a visible folder under the user's Documents. */
function defaultWorkspace(): string {
  return join(app.getPath('documents'), 'RADAR')
}

function envRoots(): string[] {
  return (process.env.RADAR_WORKSPACE ?? '')
    .split(delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
}

function readPersisted(): PersistedConfig {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as PersistedConfig
  } catch {
    return {} // first run — defaults
  }
}

export function getConfig(): RadarConfig {
  const parsed = readPersisted()
  const workspace = parsed.workspace ?? defaultWorkspace()
  // The workspace is always a root (its Inbox blip must always show); env roots are ephemeral.
  const roots = [...new Set([...(parsed.roots ?? []), workspace, ...envRoots()])]
  return {
    roots,
    maxDepth: parsed.maxDepth ?? DEFAULT_MAX_DEPTH,
    workspace,
    ignored: parsed.ignored ?? []
  }
}

export function setConfig(patch: Partial<RadarConfig>): RadarConfig {
  const current = getConfig()
  const next: RadarConfig = { ...current, ...patch }
  // Persist neither the ephemeral env roots nor the always-derived workspace root.
  const persistRoots = next.roots.filter(
    (r) => !envRoots().includes(r) && r !== next.workspace
  )
  const p = configPath()
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(
    p,
    JSON.stringify(
      { roots: persistRoots, maxDepth: next.maxDepth, workspace: next.workspace, ignored: next.ignored },
      null,
      2
    ),
    'utf8'
  )
  return next
}

export function addRoot(root: string): RadarConfig {
  const cfg = getConfig()
  if (cfg.roots.includes(root)) return cfg
  return setConfig({ roots: [...cfg.roots, root] })
}

export function removeRoot(root: string): RadarConfig {
  const cfg = getConfig()
  // The workspace root can't be removed (getConfig always re-adds it anyway).
  return setConfig({ roots: cfg.roots.filter((r) => r !== root) })
}

export function addIgnore(path: string): RadarConfig {
  const cfg = getConfig()
  if (cfg.ignored.includes(path)) return cfg
  return setConfig({ ignored: [...cfg.ignored, path] })
}

export function removeIgnore(path: string): RadarConfig {
  const cfg = getConfig()
  return setConfig({ ignored: cfg.ignored.filter((p) => p !== path) })
}
