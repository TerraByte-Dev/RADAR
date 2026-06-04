import { mkdir, access } from 'node:fs/promises'
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

/** Ensure `<workspace>/Inbox/BLIP.md` exists; returns its path. Idempotent. */
export async function ensureInbox(workspace: string): Promise<string> {
  const dir = inboxDir(workspace)
  const file = inboxBlipPath(workspace)
  await mkdir(dir, { recursive: true })
  if (!(await exists(file))) {
    const blip = createBlip({
      name: 'Inbox',
      category: 'Personal',
      horizon: 'someday',
      priority: 3,
      next_action: 'Capture loose tasks & deadlines'
    })
    noteSelfWrite(file)
    await writeBlipAtomic(file, blip)
  }
  return file
}

/** Append a captured task to the Inbox blip and return its refreshed record. */
export async function inboxAddTask(workspace: string, text: string): Promise<ProjectRecord> {
  const file = await ensureInbox(workspace)
  const blip = await readBlip(file)
  blip.addTask(text)
  noteSelfWrite(file)
  await writeBlipAtomic(file, blip)
  return readProject(file)
}
