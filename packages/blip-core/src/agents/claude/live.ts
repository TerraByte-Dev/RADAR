import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '../../atomic.js';
import { dataDir, projectKey, resolveProject } from '../../paths.js';

/**
 * The live-session markers under `<data>/live/`, one per Claude Code session. The hooks
 * write, merge and sweep them; readers (`status`, the app) only read, and skip a marker
 * whose transcript has gone quiet.
 */

/** A project is live while a session that lists it has written to its transcript within this. */
export const LIVE_WINDOW_MS = 5 * 60 * 1000;
/** `session-start` deletes a marker whose transcript is missing or this old. */
export const MARKER_TTL_MS = 24 * 60 * 60 * 1000;

/** What a session did in one project since `since`: the evidence the Stop hook nudges on. */
export interface SessionProject {
  files: string[];
  committed: boolean;
  /** A shell command ran here: the evidence for a folder without git, where scripts write unseen. */
  ran: boolean;
  since: string;
}

export interface SessionMarker {
  sessionId: string;
  cwd: string;
  transcriptPath: string;
  startedAt: string;
  /** How far into the transcript the Stop hook has read. */
  scannedBytes: number;
  /** Keyed by project folder. */
  projects: Record<string, SessionProject>;
}

/** A session id Claude Code hands a hook, if it is safe to use as a file name. */
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const liveDir = (): string => join(dataDir(), 'live');
const markerPath = (sessionId: string): string => join(liveDir(), `${sessionId}.json`);

/** One session's marker, or null when there is none or it cannot be read. */
export async function readMarker(sessionId: string): Promise<SessionMarker | null> {
  try {
    const m = JSON.parse(await readFile(markerPath(sessionId), 'utf8')) as Partial<SessionMarker>;
    if (typeof m !== 'object' || m === null) return null;
    const projects: Record<string, SessionProject> = {};
    if (m.projects && typeof m.projects === 'object') {
      for (const [dir, p] of Object.entries(m.projects)) {
        if (!p || typeof p !== 'object') continue;
        projects[dir] = {
          files: Array.isArray(p.files) ? p.files.filter((f): f is string => typeof f === 'string') : [],
          committed: p.committed === true,
          ran: p.ran === true,
          since: typeof p.since === 'string' ? p.since : new Date(0).toISOString(),
        };
      }
    }
    return {
      sessionId,
      cwd: typeof m.cwd === 'string' ? m.cwd : '',
      transcriptPath: typeof m.transcriptPath === 'string' ? m.transcriptPath : '',
      startedAt: typeof m.startedAt === 'string' ? m.startedAt : new Date().toISOString(),
      scannedBytes: typeof m.scannedBytes === 'number' && m.scannedBytes >= 0 ? m.scannedBytes : 0,
      projects,
    };
  } catch {
    return null;
  }
}

export async function writeMarker(m: SessionMarker): Promise<void> {
  await mkdir(liveDir(), { recursive: true });
  await writeAtomic(markerPath(m.sessionId), `${JSON.stringify(m)}\n`);
}

export async function deleteMarker(sessionId: string): Promise<void> {
  await unlink(markerPath(sessionId)).catch(() => {});
}

/** Delete every marker whose transcript is missing or untouched for a day; an unreadable marker goes by its own age. */
export async function sweepMarkers(now: Date): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(liveDir())).filter((n) => n.endsWith('.json'));
  } catch {
    return;
  }
  const old = (ms: number | null): boolean => ms === null || now.getTime() - ms > MARKER_TTL_MS;
  await Promise.all(
    names.map(async (name) => {
      const path = join(liveDir(), name);
      let seen: number | null;
      try {
        const m = JSON.parse(await readFile(path, 'utf8')) as { transcriptPath?: unknown };
        seen = typeof m.transcriptPath === 'string' ? await stat(m.transcriptPath).then((s) => s.mtimeMs, () => null) : null;
      } catch {
        seen = await stat(path).then((s) => s.mtimeMs, () => null);
      }
      if (old(seen)) await unlink(path).catch(() => {});
    }),
  );
}

export interface AgentPresence {
  live: boolean;
  /** Live sessions in this project. */
  sessions: number;
  /** Newest transcript mtime among the sessions that list this project, live or not. */
  lastSeenAt: string | null;
}

export interface LiveMarker {
  /** Registry keys of the projects this session touched, its own `cwd`'s project included. */
  keys: Set<string>;
  /** The transcript's mtime, or null when it is gone. */
  seenMs: number | null;
}

/** Every readable marker. A missing folder or a damaged marker reads as nothing. */
export async function readLiveMarkers(): Promise<LiveMarker[]> {
  const dir = join(dataDir(), 'live');
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const markers = await Promise.all(
    names.map(async (name): Promise<LiveMarker | null> => {
      try {
        const m = JSON.parse(await readFile(join(dir, name), 'utf8')) as { cwd?: unknown; transcriptPath?: unknown; projects?: unknown };
        const keys = new Set<string>();
        if (m.projects && typeof m.projects === 'object') for (const d of Object.keys(m.projects)) keys.add(projectKey(d));
        if (typeof m.cwd === 'string') {
          const own = resolveProject(m.cwd);
          if (own) keys.add(projectKey(own));
        }
        let seenMs: number | null = null;
        if (typeof m.transcriptPath === 'string') seenMs = await stat(m.transcriptPath).then((s) => s.mtimeMs, () => null);
        return { keys, seenMs };
      } catch {
        return null;
      }
    }),
  );
  return markers.filter((m): m is LiveMarker => m !== null);
}

/** Whether an agent is working in the project at `dir` right now, by the markers given. */
export function presenceOf(dir: string, markers: readonly LiveMarker[], now: Date = new Date()): AgentPresence {
  const key = projectKey(dir);
  let sessions = 0;
  let seen: number | null = null;
  for (const m of markers) {
    if (!m.keys.has(key) || m.seenMs === null) continue;
    if (now.getTime() - m.seenMs <= LIVE_WINDOW_MS) sessions++;
    if (seen === null || m.seenMs > seen) seen = m.seenMs;
  }
  return { live: sessions > 0, sessions, lastSeenAt: seen === null ? null : new Date(seen).toISOString() };
}
