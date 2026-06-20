import { mkdir, access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBlip, writeBlipAtomic, readBlip } from 'radar-blip'
import type { ProjectRecord } from '../../shared/radar'
import { readProject } from './projects'
import { noteSelfWrite } from './selfwrite'

/**
 * The app-managed **Inbox** blip — universal capture for non-repo errands and
 * deadlines. It is a plain `BLIP.md` (in `<workspace>/Inbox/`) the app writes
 * through the same engine, so "the app is just another agent writing a file".
 * Kept electron-free (workspace path is passed in) so it is unit-testable.
 */

export function inboxDir(workspace: string): string {
  return join(workspace, 'Inbox')
}

export function inboxBlipPath(workspace: string): string {
  return join(inboxDir(workspace), 'BLIP.md')
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** In-flight `ensureInbox` per workspace — concurrent scans/captures share one attempt. */
const inflight = new Map<string, Promise<string>>()

/**
 * Ensure `<workspace>/Inbox/BLIP.md` exists; returns its path. Idempotent and race-safe:
 * concurrent callers share the in-flight promise, and the create itself is exclusive
 * (`wx` — EEXIST means another writer won), so a just-captured Inbox is never clobbered
 * by an exists→create TOCTOU.
 */
export function ensureInbox(workspace: string): Promise<string> {
  const pending = inflight.get(workspace)
  if (pending) return pending
  const p = createInboxIfMissing(workspace).finally(() => inflight.delete(workspace))
  inflight.set(workspace, p)
  return p
}

async function createInboxIfMissing(workspace: string): Promise<string> {
  const dir = inboxDir(workspace)
  const file = inboxBlipPath(workspace)
  await mkdir(dir, { recursive: true })
  if (await exists(file)) return file
  const blip = createBlip({
    name: 'Inbox',
    category: 'Personal',
    horizon: 'someday',
    priority: 3,
    next_action: 'Capture loose tasks & deadlines'
  })
  const content = blip.toString()
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' }) // exclusive — never replace
    noteSelfWrite(file, content)
  } catch (err) {
    // Lost the create race (another caller / an agent beat us) — their file wins.
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
  return file
}

/** Append a captured task to the Inbox blip and return its refreshed record. */
export async function inboxAddTask(workspace: string, text: string): Promise<ProjectRecord> {
  const file = await ensureInbox(workspace)
  const blip = await readBlip(file)
  blip.addTask(text)
  noteSelfWrite(file, blip.toString())
  await writeBlipAtomic(file, blip)
  return readProject(file)
}
