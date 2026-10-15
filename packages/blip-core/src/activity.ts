import { lstat, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { localDate } from './core/dates.js';
import { GitError, filterOverrides, systemGit, type Git } from './git.js';
import { BLIP_FILE, IGNORES_CASE } from './paths.js';
import { FIND_SKIP } from './registry.js';

/**
 * Derived activity: what git and file times say happened in a project, set against what
 * its log and its last agent sync already cover. Computed on demand, never written to
 * BLIP.md. One implementation for `status`, `brief`, the hooks and the app.
 */
export interface Activity {
  source: 'git' | 'files' | 'none';
  /** ISO instant: newest commit, or newest dirty-file mtime, or newest file mtime. */
  lastWorkAt: string | null;
  lastLogAt: string | null;
  lastSyncAt: string | null;
  /** max(lastWorkAt, lastLogAt): the one recency number. */
  lastTouchedAt: string | null;
  /** Work exists after `drift.since`. */
  unlogged: boolean;
  drift: {
    /** max(lastLogAt, lastSyncAt). */
    since: string | null;
    /** Git only. Commits that touch only BLIP.md are not counted. */
    commits: number | null;
    /** Folders without git: files modified since. Null for git. */
    files: number | null;
  };
  git: null | {
    repoRoot: string;
    /** '' when the project is the repository root. */
    subpath: string;
    /** Null when HEAD is detached, or `status` did not answer. */
    branch: string | null;
    /** '' in a repository with no commits yet. */
    head: string;
    /** Null when `status` did not answer. */
    dirty: boolean | null;
    dirtyCount: number | null;
    lastCommit: { at: string; sha: string; subject: string } | null;
  };
  /** Git only: 30 local days, oldest first, commits per day. */
  daily: number[] | null;
  computedAt: string;
  /** Set when git failed (the record then falls back to file times), or 'partial' when the file walk hit its cap. */
  error: string | null;
}

export interface ActivityOptions {
  lastLogAt: string | null;
  lastSyncAt: string | null;
  /** The state file's `dirtyAtSync`: what the uncommitted files held at the last sync. */
  dirtyAtSync?: Readonly<Record<string, string | null>>;
  /** The git to use; null means none. Default: the one on PATH. */
  git?: Git | null;
  now?: Date;
}

export const DAYS = 30;
const WALK_DEPTH = 4;
const WALK_MAX_ENTRIES = 5000;
/** How many paths of a dirty tree are looked at for their mtime. */
const DIRTY_STAT_MAX = 50;
/** Commits after the baseline that are checked for work already in the log (below). Past this, they are simply counted. */
const LOGGED_CHECK_MAX = 50;

/** Every count is limited to the project's own folder, and a commit that touches only BLIP.md is not work. */
const PATHSPEC = ['--', '.', `:(exclude)${BLIP_FILE}`];

const maxIso = (...xs: (string | null)[]): string | null => {
  let best: string | null = null;
  for (const x of xs) if (x !== null && (best === null || Date.parse(x) > Date.parse(best))) best = x;
  return best;
};

/** A date git's `--since` reads exactly. */
const gitDate = (d: Date): string => `${d.toISOString().slice(0, 19).replace('T', ' ')} +0000`;

/** An instant as ISO, no later than `now`: a clock that runs ahead must not put work in the future. */
const clampIso = (t: number, now: Date): string => new Date(Math.min(t, now.getTime())).toISOString();

async function mtimeOf(path: string): Promise<number | null> {
  try {
    return (await lstat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** Local midnight `DAYS - 1` days before `now`: the start of the daily window. */
function windowStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1));
}

// ---- git ----

interface GitFacts {
  git: NonNullable<Activity['git']>;
  lastWorkMs: number | null;
  /** Newest mtime among the dirty paths looked at; null when none. */
  dirtyMs: number | null;
  commits: number;
  daily: number[];
}

interface StatusFacts {
  initial: boolean;
  head: string;
  branch: string | null;
  paths: string[];
}

/** `status --porcelain=v2 --branch -z`: the branch headers and every listed path. */
function parseStatus(out: string): StatusFacts {
  const facts: StatusFacts = { initial: false, head: '', branch: null, paths: [] };
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith('# branch.oid ')) {
      const oid = t.slice('# branch.oid '.length);
      facts.initial = oid === '(initial)';
      facts.head = facts.initial ? '' : oid;
    } else if (t.startsWith('# branch.head ')) {
      const head = t.slice('# branch.head '.length);
      facts.branch = head === '(detached)' ? null : head;
    } else if (t.startsWith('1 ')) facts.paths.push(t.split(' ').slice(8).join(' '));
    else if (t.startsWith('2 ')) {
      facts.paths.push(t.split(' ').slice(9).join(' '));
      i++; // the original path of a rename
    } else if (t.startsWith('u ')) facts.paths.push(t.split(' ').slice(10).join(' '));
    else if (t.startsWith('? ')) facts.paths.push(t.slice(2));
  }
  return facts;
}

/**
 * The commits after `since` that hold work already there, uncommitted, at the last sync:
 * every file they change is at the version the sync saw ({@link dirtySnapshot}). "Sync,
 * then commit" is the normal order of work, and those commits must not read as unlogged.
 * Judged by content, so a checkout or a formatter that rewrites a file changes nothing.
 * Every local branch is looked at, as the commit count does: a sync from a linked worktree
 * records that worktree's files too, and its commits land on the worktree's branch. Full shas.
 */
async function alreadyLogged(git: Git, dir: string, since: Date, synced: Readonly<Record<string, string | null>>): Promise<Set<string>> {
  const logged = new Set<string>();
  if (!Object.keys(synced).length) return logged;
  const out = await git.run(dir, ['log', '--branches', 'HEAD', `--since=${gitDate(new Date(Math.floor(since.getTime() / 1000) * 1000))}`, '--format=%x01%H%x00%cI', '--raw', '--no-abbrev', '--no-renames', '-z', ...PATHSPEC], 3000);
  for (const block of out.split('\x01').slice(1)) {
    // <sha>\0<date>\0\n:<modes> <old> <new> <status>\0<path>\0...
    const [sha = '', at = '', ...rest] = block.split('\0');
    if (!(Date.parse(at) > since.getTime())) continue;
    let files = 0;
    let covered = true;
    for (let i = 0; i + 1 < rest.length; i += 2) {
      const blob = rest[i]!.trim().split(' ')[3] ?? '';
      const path = rest[i + 1]!;
      files++;
      const want = synced[path];
      if (want === undefined || (want === null ? !/^0+$/.test(blob) : want !== blob)) covered = false;
    }
    if (files && covered) logged.add(sha);
  }
  return logged;
}

/** Paths of a dirty tree recorded at a sync, at most. */
const SNAPSHOT_MAX = 100;
/** The snapshot runs once per sync, not per board refresh: it may wait longer on a busy machine than the reads do. */
const SNAPSHOT_TIMEOUT_MS = 10_000;

/**
 * What the uncommitted files of the project in `dir` hold now, for the state file at a sync:
 * repository-relative path to the blob id git would store for it, or null for a deleted
 * file. Empty when `dir` is not in a repository, git fails, or the tree is clean. Never throws.
 */
export async function dirtySnapshot(dir: string, git: Git | null = systemGit()): Promise<Record<string, string | null>> {
  const snap: Record<string, string | null> = {};
  if (!git) return snap;
  try {
    const filters = await filterOverrides(git, dir, SNAPSHOT_TIMEOUT_MS);
    if (filters === null) return snap;
    const [top, out] = await Promise.all([
      git.run(dir, ['rev-parse', '--show-toplevel'], SNAPSHOT_TIMEOUT_MS),
      git.run(dir, [...filters, 'status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignore-submodules=all', ...PATHSPEC], SNAPSHOT_TIMEOUT_MS),
    ]);
    const root = resolve(top.trim());
    const paths = parseStatus(out).paths.slice(0, SNAPSHOT_MAX);
    const present: string[] = [];
    for (const p of paths) {
      if (p.endsWith('/')) continue; // a nested repository: not a file to hash
      if ((await mtimeOf(join(root, p))) === null) snap[p] = null;
      else present.push(p);
    }
    if (present.length) {
      // The filters are switched off by name; line endings are still converted as for a commit.
      const ids = (await git.run(dir, [...filters, 'hash-object', '--', ...present.map((p) => join(root, p))], SNAPSHOT_TIMEOUT_MS)).split('\n').map((l) => l.trim());
      present.forEach((p, i) => {
        if (/^[0-9a-f]{40,64}$/.test(ids[i] ?? '')) snap[p] = ids[i]!;
      });
    }
  } catch {
    return {};
  }
  return snap;
}

/** Branch, head and dirt of the checkout `dir` is in, with the clean/smudge filters switched off. */
const statusArgs = (filters: readonly string[]): string[] => [...filters, 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal', '--ignore-submodules=all', ...PATHSPEC];

/**
 * The branch and dirt of the checkout at `dir` alone: for an agent in a linked worktree,
 * whose project record describes the main checkout. Null when git is missing or fails.
 */
export async function checkoutState(dir: string, git: Git | null = systemGit()): Promise<{ branch: string | null; dirty: boolean } | null> {
  if (!git) return null;
  try {
    const filters = await filterOverrides(git, dir);
    if (filters === null) return null;
    const status = parseStatus(await git.run(dir, statusArgs(filters), 3000));
    return { branch: status.branch, dirty: status.paths.length > 0 };
  } catch {
    return null;
  }
}

/** The git facts, or null when `dir` is not in a git repository. Throws GitError when git failed. */
async function gitFacts(git: Git, dir: string, since: Date | null, synced: Readonly<Record<string, string | null>>, now: Date): Promise<GitFacts | null> {
  const [top, filters] = await Promise.all([
    git.run(dir, ['rev-parse', '--show-toplevel', '--show-prefix'], 2000).catch((err: unknown) => {
      if (err instanceof GitError && !err.timedOut && /not a git repository/i.test(err.stderr)) return null;
      throw err;
    }),
    filterOverrides(git, dir),
  ]);
  if (top === null) return null;
  const [rootLine = '', prefix = ''] = top.split('\n').map((l) => l.trim());
  const root = resolve(rootLine);
  const start = windowStart(now);

  const failed = (err: unknown): GitError => (err instanceof GitError ? err : new GitError(String(err), null, false, ''));
  const [status, last, window] = await Promise.all([
    filters === null
      ? Promise.resolve(null)
      : git.run(dir, statusArgs(filters), 3000).then(parseStatus, () => null),
    git.run(dir, ['log', '-1', '--branches', 'HEAD', '--format=%cI%x00%h%x00%s', ...PATHSPEC], 3000).catch(failed),
    git.run(dir, ['log', '--branches', 'HEAD', `--since=${gitDate(start)}`, '--format=%cI', ...PATHSPEC], 3000).catch(failed),
  ]);
  // A repository with no commits has no HEAD to read a log from; that is not a failure.
  const unborn = status?.initial === true;
  if (!unborn && last instanceof GitError) throw last;
  if (!unborn && window instanceof GitError) throw window;

  // A folder its repository ignores, or has never tracked, has no history here: its file times are its activity.
  if (prefix && !unborn && typeof last === 'string' && !last.trim() && !(await git.run(dir, ['ls-files', '--', '.'], 2000)).trim()) return null;

  let lastCommit: NonNullable<Activity['git']>['lastCommit'] = null;
  if (typeof last === 'string' && last.trim()) {
    const [at = '', sha = '', ...subject] = last.replace(/\n$/, '').split('\0');
    if (!Number.isNaN(Date.parse(at))) lastCommit = { at: new Date(Date.parse(at)).toISOString(), sha, subject: subject.join(' ') };
  }

  const daily: number[] = new Array<number>(DAYS).fill(0);
  const days = new Map<string, number>();
  for (let i = 0; i < DAYS; i++) days.set(localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)), i);
  const instants = typeof window === 'string' ? window.split('\n').map((l) => Date.parse(l.trim())).filter((t) => !Number.isNaN(t)) : [];
  for (const t of instants) {
    const i = days.get(localDate(new Date(Math.min(t, now.getTime()))));
    if (i !== undefined) daily[i]!++;
  }

  let commits = 0;
  if (!unborn) {
    if (since === null) commits = instants.length;
    else if (since.getTime() >= start.getTime()) commits = instants.filter((t) => t > since.getTime()).length;
    else commits = Number((await git.run(dir, ['rev-list', '--count', '--branches', 'HEAD', `--since=${gitDate(since)}`, ...PATHSPEC], 3000)).trim()) || 0;
    if (since !== null && commits > 0 && commits <= LOGGED_CHECK_MAX) commits -= (await alreadyLogged(git, dir, since, synced)).size;
  }

  let dirtyMs: number | null = null;
  if (status) {
    // A deleted file has no mtime; its folder's records when it went. An untracked folder is listed
    // once, and its own mtime does not change when a file in it does: its newest file counts too.
    const listed = status.paths.slice(0, DIRTY_STAT_MAX);
    const share = Math.floor(WALK_MAX_ENTRIES / Math.max(1, listed.filter((p) => p.endsWith('/')).length));
    const mtimes = listed.map(async (p) => {
      const t = (await mtimeOf(join(root, p))) ?? (await mtimeOf(dirname(join(root, p))));
      const inside = p.endsWith('/') ? (await walk(join(root, p), Infinity, share)).newest : null;
      return t === null || (inside !== null && inside > t) ? inside : t;
    });
    for (const t of await Promise.all(mtimes)) {
      if (t !== null && (dirtyMs === null || t > dirtyMs)) dirtyMs = t;
    }
  }
  const lastCommitMs = lastCommit ? Date.parse(lastCommit.at) : null;
  const lastWorkMs = dirtyMs === null || (lastCommitMs !== null && lastCommitMs >= dirtyMs) ? lastCommitMs : dirtyMs;

  return {
    git: {
      repoRoot: root,
      subpath: prefix.replace(/\/$/, ''),
      branch: status ? status.branch : null,
      head: status ? status.head : (lastCommit?.sha ?? ''),
      dirty: status ? status.paths.length > 0 : null,
      dirtyCount: status ? status.paths.length : null,
      lastCommit,
    },
    lastWorkMs,
    dirtyMs,
    commits,
    daily,
  };
}

/**
 * `<short sha> <subject>` of the newest commits after `since` (or in the daily window when
 * there is no baseline), newest first, at most `max`. A commit of work the last sync already
 * covered is left out, as it is from `drift.commits`. Empty when git is missing or fails.
 */
export async function commitSubjects(
  dir: string,
  since: string | null,
  opts: { git?: Git | null; now?: Date; max?: number; dirtyAtSync?: Readonly<Record<string, string | null>> } = {},
): Promise<string[]> {
  const git = opts.git === undefined ? systemGit() : opts.git;
  if (!git) return [];
  const from = since === null ? windowStart(opts.now ?? new Date()) : new Date(since);
  const max = opts.max ?? 10;
  try {
    const logged = since === null ? new Set<string>() : await alreadyLogged(git, dir, from, opts.dirtyAtSync ?? {});
    const out = await git.run(dir, ['log', '--branches', 'HEAD', `--since=${gitDate(from)}`, '-n', String(max + logged.size), '--format=%H%x00%h%x00%s', ...PATHSPEC], 3000);
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\0'))
      .filter(([sha = '']) => !logged.has(sha))
      .slice(0, max)
      .map(([, short = '', ...subject]) => `${short} ${subject.join(' ')}`);
  } catch {
    return [];
  }
}

// ---- folders without git ----

interface WalkFacts {
  newest: number | null;
  /** Files modified after the baseline. */
  changed: number;
  files: number;
  partial: boolean;
}

/**
 * One bounded walk: no dot-folders and none of the build folders `track --find` skips,
 * at most four levels down, at most 5,000 entries. BLIP.md is not work.
 */
async function walk(dir: string, after: number, max: number = WALK_MAX_ENTRIES): Promise<WalkFacts> {
  const facts: WalkFacts = { newest: null, changed: 0, files: 0, partial: false };
  const isBlip = (name: string): boolean => (IGNORES_CASE ? name.toLowerCase() === BLIP_FILE.toLowerCase() : name === BLIP_FILE);
  let entries = 0;
  let level = [dir];
  for (let depth = 0; depth <= WALK_DEPTH && level.length; depth++) {
    const next: string[] = [];
    for (const d of level) {
      let list;
      try {
        list = await readdir(d, { withFileTypes: true });
      } catch {
        continue;
      }
      if (entries + list.length > max) {
        facts.partial = true;
        list = list.slice(0, max - entries);
      }
      entries += list.length;
      const files = list.filter((e) => e.isFile() && !isBlip(e.name));
      for (const t of await Promise.all(files.map((e) => mtimeOf(join(d, e.name))))) {
        if (t === null) continue;
        facts.files++;
        if (t > after) facts.changed++;
        if (facts.newest === null || t > facts.newest) facts.newest = t;
      }
      for (const e of list) if (e.isDirectory() && !e.name.startsWith('.') && !FIND_SKIP.has(e.name)) next.push(join(d, e.name));
      if (facts.partial) return facts;
    }
    level = next;
  }
  return facts;
}

// ---- the record ----

/** The activity record of the project in `dir`. Never throws: a git failure falls back to file times. */
export async function computeActivity(dir: string, opts: ActivityOptions): Promise<Activity> {
  const now = opts.now ?? new Date();
  const git = opts.git === undefined ? systemGit() : opts.git;
  const since = maxIso(opts.lastLogAt, opts.lastSyncAt);
  const sinceDate = since === null ? null : new Date(since);
  const base = { lastLogAt: opts.lastLogAt, lastSyncAt: opts.lastSyncAt, computedAt: now.toISOString() };

  let error: string | null = null;
  if (git) {
    try {
      const facts = await gitFacts(git, dir, sinceDate, opts.dirtyAtSync ?? {}, now);
      if (facts) {
        const lastWorkAt = facts.lastWorkMs === null ? null : clampIso(facts.lastWorkMs, now);
        // Dirty work is new only when a dirty file changed after the baseline: a file left over from before it is already covered.
        const dirtyAfter = facts.git.dirty === true && (since === null || (facts.dirtyMs !== null && facts.dirtyMs > Date.parse(since)));
        return {
          source: 'git',
          lastWorkAt,
          ...base,
          lastTouchedAt: maxIso(lastWorkAt, opts.lastLogAt),
          unlogged: facts.commits > 0 || dirtyAfter,
          drift: { since, commits: facts.commits, files: null },
          git: facts.git,
          daily: facts.daily,
          error: null,
        };
      }
    } catch (err) {
      error = err instanceof Error ? err.message || 'git failed' : 'git failed';
    }
  }

  // With no baseline, the drift counts cover the same 30-day window the daily counts do.
  const after = sinceDate?.getTime() ?? windowStart(now).getTime();
  const w = await walk(resolve(dir), after);
  const lastWorkAt = w.newest === null ? null : clampIso(w.newest, now);
  return {
    source: w.files === 0 && !w.partial ? 'none' : 'files',
    lastWorkAt,
    ...base,
    lastTouchedAt: maxIso(lastWorkAt, opts.lastLogAt),
    unlogged: w.changed > 0,
    drift: { since, commits: null, files: w.changed },
    git: null,
    daily: null,
    error: error ?? (w.partial ? 'partial' : null),
  };
}
