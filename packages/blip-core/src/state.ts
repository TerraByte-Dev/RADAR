import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from './atomic.js';
import { dataDir } from './paths.js';

/** What RADAR remembers about a project outside its BLIP.md. Instants are ISO strings. */
export interface ProjectState {
  /** The last accepted agent sync, a no-op one included: "the log covers the work up to here". */
  lastSyncAt: string | null;
  /** The last time a hook asked an agent to sync this project. */
  lastNudgeAt: string | null;
  /**
   * What the uncommitted files held at `lastSyncAt`: repository-relative path to git blob
   * id, or null for a deleted file. A later commit holding exactly these is work the log covers.
   */
  dirtyAtSync: Record<string, string | null>;
}

const statePath = (id: string): string => join(dataDir(), 'state', `${id}.json`);

/** A project's state. A file that is missing or unreadable reads as "never". */
export async function readState(id: string): Promise<ProjectState> {
  const state: ProjectState = { lastSyncAt: null, lastNudgeAt: null, dirtyAtSync: {} };
  try {
    const json = JSON.parse(await readFile(statePath(id), 'utf8')) as Record<string, unknown>;
    if (typeof json.lastSyncAt === 'string') state.lastSyncAt = json.lastSyncAt;
    if (typeof json.lastNudgeAt === 'string') state.lastNudgeAt = json.lastNudgeAt;
    const d = json.dirtyAtSync;
    if (typeof d === 'object' && d !== null && !Array.isArray(d) && Object.values(d).every((v) => v === null || typeof v === 'string')) {
      state.dirtyAtSync = d as Record<string, string | null>;
    }
  } catch {
    // never written, or damaged: start over
  }
  return state;
}

/** Change part of a project's state. Callers hold the project's lock. */
export async function writeState(id: string, patch: Partial<ProjectState>): Promise<ProjectState> {
  const next = { ...(await readState(id)), ...patch };
  const path = statePath(id);
  await mkdir(join(dataDir(), 'state'), { recursive: true });
  await writeAtomic(path, `${JSON.stringify(next)}\n`);
  return next;
}
