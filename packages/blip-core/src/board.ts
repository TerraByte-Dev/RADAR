import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { computeActivity, type Activity } from './activity.js';
import { presenceOf, readLiveMarkers, type AgentPresence, type LiveMarker } from './agents/claude/live.js';
import { BlipError, type BlipDoc } from './core/schema.js';
import type { Git } from './git.js';
import { readProject } from './io.js';
import { dataDir, projectId } from './paths.js';
import type { RegisteredProject } from './registry.js';
import { readState } from './state.js';

/** One project as `status --json` and the app see it. */
export interface ProjectRecord {
  /** Registry id: the only handle the renderer sends back. */
  id: string;
  dir: string;
  state: 'ok' | 'needs-migrate' | 'needs-repair' | 'missing';
  /** Null only when missing; best-effort when needs-repair. */
  doc: BlipDoc | null;
  /** Null = not computed yet, never "no activity". */
  activity: Activity | null;
  agent: AgentPresence;
  hidden: boolean;
  /** First 16 hex of sha256(BLIP.md bytes); '' when missing. */
  rev: string;
}

export interface RecordOptions {
  hidden?: boolean;
  git?: Git | null;
  now?: Date;
  /** Live markers already read for a whole board; read here when absent. */
  markers?: readonly LiveMarker[];
  /** Activity known already (a fresh cache entry); used only while it still matches the log, the last sync and HEAD, else computed. */
  activity?: Activity;
  /** Never compute: `activity` is the given entry while it still holds, else null. No process is started. */
  cachedOnly?: boolean;
}

/** The record of the project in `dir`. A BLIP.md that is not there makes a `missing` record, not an error. */
export async function buildRecord(dir: string, opts: RecordOptions = {}): Promise<ProjectRecord> {
  const now = opts.now ?? new Date();
  const id = projectId(dir);
  const agent = presenceOf(dir, opts.markers ?? (await readLiveMarkers()), now);
  const hidden = opts.hidden ?? false;
  let read;
  try {
    read = await readProject(dir);
  } catch (err) {
    if (err instanceof BlipError && err.code === 'E_NO_PROJECT') return { id, dir, state: 'missing', doc: null, activity: null, agent, hidden, rev: '' };
    throw err;
  }
  const parsed = read.file.doc();
  const state = parsed.schema === 2 ? 'needs-migrate' : parsed.writable ? 'ok' : 'needs-repair';
  // A header that cannot be read names nothing reliably: the folder names the project (spec 8.1).
  const doc = state === 'needs-repair' ? { ...parsed, name: basename(resolve(dir)), nameSource: 'folder' as const } : parsed;
  const { lastSyncAt, dirtyAtSync } = await readState(id);
  const cached = opts.activity && (await stillTrue(opts.activity, doc.lastLogAt, lastSyncAt)) ? opts.activity : null;
  const activity = cached ?? (opts.cachedOnly ? null : await computeActivity(dir, { lastLogAt: doc.lastLogAt, lastSyncAt, dirtyAtSync, now, ...(opts.git === undefined ? {} : { git: opts.git }) }));
  return { id, dir, state, doc, activity, agent, hidden, rev: read.rev };
}

/**
 * HEAD of the repository whose worktree is `root`, read from the filesystem: the branch it
 * names (null when detached) and the commit it points at ('' before the first commit).
 * Null when it cannot be read.
 */
async function readHead(root: string): Promise<{ branch: string | null; sha: string } | null> {
  try {
    let gitDir = join(root, '.git');
    let common = gitDir;
    if ((await stat(gitDir)).isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(gitDir, 'utf8'));
      if (!m) return null;
      gitDir = resolve(root, m[1]!);
      common = await readFile(join(gitDir, 'commondir'), 'utf8').then((c) => resolve(gitDir, c.trim()), () => gitDir);
    }
    const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim();
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref) return { branch: null, sha: head };
    const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    const loose = await readFile(join(common, ref), 'utf8').then((t) => t.trim(), () => null);
    if (loose) return { branch, sha: loose };
    const packed = await readFile(join(common, 'packed-refs'), 'utf8').catch(() => '');
    const line = packed.split('\n').find((l) => l.trim().endsWith(` ${ref}`));
    return { branch, sha: line ? line.split(' ')[0]! : '' };
  } catch {
    return null;
  }
}

/** Whether a cached record still describes the project: the same log, the same last sync and, for git, the same HEAD. */
async function stillTrue(a: Activity, lastLogAt: string | null, lastSyncAt: string | null): Promise<boolean> {
  if (a.lastLogAt !== lastLogAt || a.lastSyncAt !== lastSyncAt) return false;
  if (!a.git) return true;
  const head = await readHead(a.git.repoRoot);
  return head !== null && head.branch === a.git.branch && head.sha === a.git.head;
}

/** The activity cache is fresh enough to show without recomputing for this long. */
export const CACHE_FRESH_MS = 60_000;

/**
 * Entries of `<data>/activity-cache.json` computed less than a minute ago, by project id.
 * The app is the only writer, as `{ "version": 1, "projects": { "<id>": Activity } }`;
 * this side only reads, and anything unreadable reads as empty.
 */
export async function readFreshActivity(now: Date = new Date()): Promise<Map<string, Activity>> {
  const fresh = new Map<string, Activity>();
  try {
    const json = JSON.parse(await readFile(join(dataDir(), 'activity-cache.json'), 'utf8')) as { projects?: Record<string, Activity> };
    for (const [id, a] of Object.entries(json.projects ?? {})) {
      const age = now.getTime() - Date.parse(a?.computedAt ?? '');
      if (age >= 0 && age < CACHE_FRESH_MS) fresh.set(id, a);
    }
  } catch {
    // no cache yet
  }
  return fresh;
}

/** Projects worked on at once when a whole board is built. */
export const BOARD_CONCURRENCY = 4;

/** Records for the given registered projects, in their order, four at a time; fresh cached activity is used as it is. */
export async function buildBoard(projects: readonly RegisteredProject[], opts: { git?: Git | null; now?: Date } = {}): Promise<ProjectRecord[]> {
  const now = opts.now ?? new Date();
  const [markers, cache] = await Promise.all([readLiveMarkers(), readFreshActivity(now)]);
  const out: ProjectRecord[] = new Array(projects.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < projects.length) {
      const i = next++;
      const p = projects[i]!;
      const cached = cache.get(p.id);
      out[i] = await buildRecord(p.dir, { ...opts, now, markers, hidden: p.hidden, ...(cached ? { activity: cached } : {}) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(BOARD_CONCURRENCY, projects.length) }, worker));
  return out;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isStrOrNull = (x: unknown): boolean => x === null || typeof x === 'string';
const isNumOrNull = (x: unknown): boolean => x === null || typeof x === 'number';

function isActivity(a: unknown): a is Activity {
  if (!isObj(a)) return false;
  const d = a.drift;
  const g = a.git;
  return (
    ['git', 'files', 'none'].includes(a.source as string) &&
    isStrOrNull(a.lastWorkAt) &&
    isStrOrNull(a.lastLogAt) &&
    isStrOrNull(a.lastSyncAt) &&
    isStrOrNull(a.lastTouchedAt) &&
    typeof a.unlogged === 'boolean' &&
    isObj(d) &&
    isStrOrNull(d.since) &&
    isNumOrNull(d.commits) &&
    isNumOrNull(d.files) &&
    (g === null ||
      (isObj(g) &&
        isStr(g.repoRoot) &&
        isStr(g.subpath) &&
        isStrOrNull(g.branch) &&
        isStr(g.head) &&
        (g.dirty === null || typeof g.dirty === 'boolean') &&
        isNumOrNull(g.dirtyCount) &&
        (g.lastCommit === null || (isObj(g.lastCommit) && isStr(g.lastCommit.at) && isStr(g.lastCommit.sha) && isStr(g.lastCommit.subject))))) &&
    (a.daily === null || (Array.isArray(a.daily) && a.daily.length === 30 && a.daily.every((n) => typeof n === 'number'))) &&
    isStr(a.computedAt) &&
    isStrOrNull(a.error)
  );
}

function isDoc(d: unknown): d is BlipDoc {
  if (!isObj(d)) return false;
  const t = d.tasks;
  return (
    (d.schema === 2 || d.schema === 3) &&
    isStr(d.name) &&
    isStrOrNull(d.now) &&
    isStr(d.status) &&
    typeof d.focus === 'boolean' &&
    isStrOrNull(d.due) &&
    Array.isArray(d.tags) &&
    Array.isArray(d.links) &&
    isObj(t) &&
    Array.isArray(t.open) &&
    Array.isArray(t.done) &&
    Array.isArray(d.log) &&
    isStrOrNull(d.lastLogAt) &&
    Array.isArray(d.problems) &&
    typeof d.writable === 'boolean'
  );
}

/** The shape check `status --json` and the app's contract test hold every record to. */
export function isProjectRecord(r: unknown): r is ProjectRecord {
  if (!isObj(r)) return false;
  const ag = r.agent;
  return (
    isStr(r.id) &&
    isStr(r.dir) &&
    ['ok', 'needs-migrate', 'needs-repair', 'missing'].includes(r.state as string) &&
    (r.state === 'missing' ? r.doc === null : isDoc(r.doc)) &&
    (r.activity === null || isActivity(r.activity)) &&
    isObj(ag) &&
    typeof ag.live === 'boolean' &&
    typeof ag.sessions === 'number' &&
    isStrOrNull(ag.lastSeenAt) &&
    typeof r.hidden === 'boolean' &&
    isStr(r.rev)
  );
}
