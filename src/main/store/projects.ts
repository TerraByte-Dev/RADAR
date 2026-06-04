import { readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { readBlip, writeBlipAtomic, createBlip } from 'radar-blip'
import type {
  BlipFieldPatch,
  BlipTaskOp,
  InitProjectOptions,
  ProjectRecord
} from '../../shared/radar'
import { noteSelfWrite } from './selfwrite'

/**
 * BLIP.md scan + write layer (electron-free, so it is unit-testable). Every write
 * goes through the `radar-blip` engine — atomic and round-trip-clean — and is noted
 * for self-write suppression so the file watcher doesn't echo it back as a change.
 */

/** Directories never worth descending into when hunting for BLIP.md files. */
const IGNORE = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.cache',
  'release',
  'coverage',
  '.turbo',
  '.git'
])

async function* walkForBlips(root: string, depth: number): AsyncGenerator<string> {
  if (depth < 0) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return // unreadable dir — skip silently
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue
      yield* walkForBlips(join(root, e.name), depth - 1)
    } else if (e.isFile() && e.name === 'BLIP.md') {
      yield join(root, e.name)
    }
  }
}

/** Walk every root for BLIP.md files and return one ProjectRecord each (deduped by path). */
export async function scanProjects(roots: string[], maxDepth = 5): Promise<ProjectRecord[]> {
  const found = new Map<string, string>() // blipPath -> projectDir
  for (const root of roots) {
    for await (const blipPath of walkForBlips(root, maxDepth)) {
      found.set(blipPath, join(blipPath, '..'))
    }
  }
  const records: ProjectRecord[] = []
  for (const [blipPath, dir] of found) records.push(await readProject(blipPath, dir))
  return records.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

/** Read + parse one BLIP.md into a ProjectRecord. A parse failure becomes a "signal lost" record. */
export async function readProject(
  blipPath: string,
  dir = join(blipPath, '..')
): Promise<ProjectRecord> {
  try {
    const blip = await readBlip(blipPath)
    return { path: dir, blipPath, ...blip.toReadModel() }
  } catch (err) {
    return {
      path: dir,
      blipPath,
      name: basename(dir),
      horizon: 'someday',
      priority: 3,
      category: '',
      status: 'active',
      tasks: [],
      unknown: {},
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** Apply a managed-field patch (null clears an optional field) and re-read. */
export async function setFields(blipPath: string, patch: BlipFieldPatch): Promise<ProjectRecord> {
  const blip = await readBlip(blipPath)
  if (patch.name !== undefined) blip.setField('name', patch.name)
  if (patch.horizon !== undefined) blip.setHorizon(patch.horizon)
  if (patch.priority !== undefined) blip.setPriority(patch.priority)
  if (patch.category !== undefined) blip.setCategory(patch.category)
  if (patch.status !== undefined) blip.setStatus(patch.status)
  if (patch.next_action !== undefined) blip.setNextAction(patch.next_action)
  if (patch.deadline !== undefined) blip.setDeadline(patch.deadline)
  if (patch.operation !== undefined) blip.setOperation(patch.operation)
  if (patch.radar_angle !== undefined) blip.setRadarAngle(patch.radar_angle)
  if (patch.tags !== undefined) blip.setField('tags', patch.tags)
  noteSelfWrite(blipPath)
  await writeBlipAtomic(blipPath, blip)
  return readProject(blipPath)
}

/** Mutate the project's `# Tasks` checklist. */
export async function taskOp(blipPath: string, op: BlipTaskOp): Promise<ProjectRecord> {
  const blip = await readBlip(blipPath)
  switch (op.action) {
    case 'add':
      blip.addTask(op.text ?? '')
      break
    case 'done':
      blip.setTaskDone(op.ref!, true)
      break
    case 'undone':
      blip.setTaskDone(op.ref!, false)
      break
    case 'toggle':
      blip.toggleTask(op.ref!)
      break
    case 'rm':
      blip.removeTask(op.ref!)
      break
    case 'edit':
      blip.editTask(op.ref!, op.text ?? '')
      break
  }
  noteSelfWrite(blipPath)
  await writeBlipAtomic(blipPath, blip)
  return readProject(blipPath)
}

/** Append a dated session-log entry (append-only) and update next_action + last_session. */
export async function handoff(
  blipPath: string,
  lines: string[],
  next?: string,
  author?: string
): Promise<ProjectRecord> {
  const blip = await readBlip(blipPath)
  blip.appendSession({ lines, author })
  if (next) blip.setNextAction(next)
  noteSelfWrite(blipPath)
  await writeBlipAtomic(blipPath, blip)
  return readProject(blipPath)
}

/** Create a BLIP.md in `dir` (adopt a folder / ghost). */
export async function initProject(
  dir: string,
  opts: InitProjectOptions
): Promise<ProjectRecord> {
  const blipPath = join(dir, 'BLIP.md')
  const blip = createBlip({ name: opts.name ?? basename(dir), ...opts })
  noteSelfWrite(blipPath)
  await writeBlipAtomic(blipPath, blip)
  return readProject(blipPath, dir)
}
