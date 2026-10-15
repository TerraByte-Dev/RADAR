import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { computeActivity, dirtySnapshot, DAYS, type Activity } from '../src/activity.js';
import { GitError, execGit, findGitBinary, gitEnv, makeGit, systemGit, type Exec } from '../src/git.js';
import { syncProject } from '../src/io.js';
import { buildRecord } from '../src/board.js';
import { parseSyncPayload } from '../src/core/sync.js';
import { git, gitAt, isolate, tmp } from './helpers.js';
import { FULL, cpuMs } from './timing.js';

let data: string;
beforeEach(() => {
  data = isolate();
});

const NOW = new Date();
const ago = (min: number): Date => new Date(NOW.getTime() - min * 60_000);
const iso = (min: number): string => ago(min).toISOString();

/** A file with the given text and mtime. */
function put(path: string, text: string, when: Date): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  utimesSync(path, when, when);
}

/** Write `file` in `dir` at `when` and commit it with that date. */
function commit(dir: string, file: string, when: Date, text = `${file} at ${when.toISOString()}\n`): void {
  put(join(dir, file), text, when);
  gitAt(dir, when, 'add', '--', file);
  gitAt(dir, when, 'commit', '-q', '-m', `change ${file}`);
}

/** A repository whose first commit (a file and BLIP.md) is `firstMin` minutes old. */
function repo(firstMin = 60 * 24 * 40): string {
  const dir = join(tmp('ra-'), 'proj');
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  put(join(dir, 'BLIP.md'), '---\nblip: 3\nname: Sample\nnow: Getting started.\n---\n\n# Tasks\n\n- [ ] First task here\n\n# Session log\n', ago(firstMin));
  commit(dir, 'readme.txt', ago(firstMin));
  gitAt(dir, ago(firstMin), 'add', 'BLIP.md');
  gitAt(dir, ago(firstMin), 'commit', '-q', '-m', 'blip');
  return dir;
}

/** Git calls one project with 5,000 commits costs (measured). */
const GIT_CALLS_5000 = 5;

const act = (dir: string, since: { log?: number; sync?: number } = {}): Promise<Activity> =>
  computeActivity(dir, { lastLogAt: since.log === undefined ? null : iso(since.log), lastSyncAt: since.sync === undefined ? null : iso(since.sync), now: NOW });

describe('activity: git projects', () => {
  it('reads the last commit, branch, head and 30 daily counts that sum to the commits in the window', async () => {
    const dir = repo();
    commit(dir, 'old.txt', ago(60 * 24 * 35)); // outside the window
    for (const d of [29, 5, 1, 1, 0]) commit(dir, `f${Math.random().toString(36).slice(2)}.txt`, new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - d, 9, 0));
    const a = await act(dir);
    expect(a.source).toBe('git');
    expect(a.error).toBeNull();
    expect(a.daily).toHaveLength(DAYS);
    const today = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 9, 0);
    // A commit at 09:00 today may still be in the future when the suite runs early: it is clamped to now, still today.
    expect(a.daily![DAYS - 1]).toBe(1);
    expect(a.daily![DAYS - 2]).toBe(2);
    expect(a.daily![0]).toBe(1);
    expect(a.daily!.reduce((x, y) => x + y, 0)).toBe(5);
    expect(a.drift).toEqual({ since: null, commits: 5, files: null });
    expect(a.git).toMatchObject({ repoRoot: dir, subpath: '', branch: 'main', dirty: false, dirtyCount: 0 });
    expect(a.git!.head).toMatch(/^[0-9a-f]{40}$/);
    expect(a.git!.lastCommit!.subject).toMatch(/^change f/);
    expect(Date.parse(a.lastWorkAt!)).toBe(Math.min(today.getTime(), NOW.getTime()));
    expect(a.unlogged).toBe(true);
  });

  it('a commit on a branch that is not checked out moves lastWorkAt and adds to the drift', async () => {
    const dir = repo();
    commit(dir, 'a.txt', ago(120));
    const before = await act(dir, { sync: 100 });
    expect(before.drift.commits).toBe(0);
    git(dir, 'checkout', '-q', '-b', 'side');
    commit(dir, 'side.txt', ago(30));
    git(dir, 'checkout', '-q', 'main');
    const after = await act(dir, { sync: 100 });
    expect(after.drift.commits).toBe(1);
    expect(after.unlogged).toBe(true);
    expect(Date.parse(after.lastWorkAt!)).toBeGreaterThan(Date.parse(before.lastWorkAt!));
  });

  it('a commit made in a linked worktree counts, even when it changes a file whose copy here is old', async () => {
    const dir = repo();
    commit(dir, 'a.txt', ago(120));
    const wt = join(dir, '..', 'wt');
    git(dir, 'worktree', 'add', '-q', '-b', 'feat', wt);
    commit(wt, 'a.txt', ago(20), 'changed in the worktree\n');
    commit(wt, 'new.txt', ago(10));
    const a = await act(dir, { sync: 100 });
    expect(a.drift.commits).toBe(2);
    expect(a.git!.repoRoot).toBe(dir);
    expect(Date.parse(a.lastWorkAt!)).toBe(ago(10).getTime() - (ago(10).getTime() % 1000));
  });

  it('a fetched remote-tracking commit is not activity', async () => {
    const origin = repo();
    const dir = join(origin, '..', 'clone');
    git(join(origin, '..'), 'clone', '-q', origin, dir);
    const before = await act(dir, { sync: 100 });
    commit(origin, 'theirs.txt', ago(5));
    git(dir, 'fetch', '-q');
    expect(git(dir, 'log', '-1', '--format=%s', 'origin/main')).toBe('change theirs.txt');
    const after = await act(dir, { sync: 100 });
    expect(after.drift.commits).toBe(0);
    expect(after.lastWorkAt).toBe(before.lastWorkAt);
  });

  it('a project in a subfolder counts only commits that touch it, and only its own dirty files', async () => {
    const root = repo();
    const sub = join(root, 'app');
    put(join(sub, 'BLIP.md'), '---\nblip: 3\n---\n\n# Tasks\n\n# Session log\n', ago(200));
    commit(root, 'app/one.txt', ago(50));
    commit(root, 'other/two.txt', ago(40));
    commit(root, 'other/three.txt', ago(30));
    put(join(root, 'other', 'dirty.txt'), 'x', ago(5));
    put(join(sub, 'dirty.txt'), 'x', ago(6));
    const a = await act(sub, { sync: 100 });
    expect(a.git).toMatchObject({ repoRoot: root, subpath: 'app', dirtyCount: 1, dirty: true });
    expect(a.drift.commits).toBe(1);
    expect(a.git!.lastCommit!.subject).toBe('change app/one.txt');
    expect(Date.parse(a.lastWorkAt!)).toBe(ago(6).getTime());
  });

  it('a project folder its enclosing repository ignores, or has never tracked, reads file times', async () => {
    for (const ignored of [true, false]) {
      const root = repo();
      if (ignored) commit(root, '.gitignore', ago(300), 'proj/\n');
      const proj = join(root, 'proj');
      put(join(proj, 'BLIP.md'), '---\nblip: 3\n---\n\n# Tasks\n\n# Session log\n', ago(200));
      put(join(proj, 'plan.md'), 'old plan\n', ago(200));
      utimesSync(proj, ago(200), ago(200));
      expect(await act(proj, { log: 100 })).toMatchObject({ source: 'files', unlogged: false, drift: { files: 0 } });
      put(join(proj, 'plan.md'), 'edited plan\n', ago(5));
      expect(await act(proj, { log: 100 })).toMatchObject({ source: 'files', unlogged: true, lastWorkAt: iso(5), drift: { files: 1 } });
    }
  });

  it('an edit inside an untracked folder of a git project is seen', async () => {
    const dir = repo();
    put(join(dir, 'notes', 'deep', 'a.md'), 'a\n', ago(200));
    put(join(dir, 'notes', 'b.md'), 'b\n', ago(200));
    for (const d of [join(dir, 'notes', 'deep'), join(dir, 'notes')]) utimesSync(d, ago(200), ago(200));
    expect(await act(dir, { sync: 100 })).toMatchObject({ source: 'git', unlogged: false, git: { dirty: true, dirtyCount: 1 } });
    put(join(dir, 'notes', 'deep', 'a.md'), 'a, edited\n', ago(5));
    expect(await act(dir, { sync: 100 })).toMatchObject({ unlogged: true, lastWorkAt: iso(5), git: { dirtyCount: 1 } });
  });

  it('a commit that touches only BLIP.md is not work, and a dirty BLIP.md is not dirty', async () => {
    const dir = repo();
    commit(dir, 'a.txt', ago(120));
    commit(dir, 'BLIP.md', ago(10), '---\nblip: 3\n---\n\n# Tasks\n\n# Session log\n');
    put(join(dir, 'BLIP.md'), '---\nblip: 3\nnow: Edited.\n---\n\n# Tasks\n\n# Session log\n', ago(1));
    const a = await act(dir, { sync: 100 });
    expect(a.drift.commits).toBe(0);
    expect(a.git!.dirty).toBe(false);
    expect(a.unlogged).toBe(false);
    expect(a.git!.lastCommit!.subject).toBe('change a.txt');
  });

  it('sync, then commit the same work, then commit BLIP.md: nothing unlogged; N further commits are N', async () => {
    const dir = repo();
    put(join(dir, 'work.txt'), 'the work\n', ago(50));
    put(join(dir, 'more.txt'), 'more work\n', ago(48));
    await syncProject(dir, parseSyncPayload({ now: 'Wrote the work file.', log: ['Wrote the work file and more'] }), { author: 'Robin', now: ago(45) });
    gitAt(dir, ago(40), 'add', 'work.txt', 'more.txt');
    gitAt(dir, ago(40), 'commit', '-q', '-m', 'the work');
    gitAt(dir, ago(39), 'add', 'BLIP.md');
    gitAt(dir, ago(39), 'commit', '-q', '-m', 'blip');
    let r = await buildRecord(dir, { now: NOW });
    expect(r.activity!.drift.since).toBe(iso(45));
    expect(r.activity!.drift.commits).toBe(0);
    expect(r.activity!.unlogged).toBe(false);

    commit(dir, 'next1.txt', ago(20));
    commit(dir, 'work.txt', ago(15), 'the work, changed again\n');
    commit(dir, 'next2.txt', ago(10));
    r = await buildRecord(dir, { now: NOW });
    expect(r.activity!.drift.commits).toBe(3);
    expect(r.activity!.unlogged).toBe(true);
  });

  it('sync, then commit: switching to another branch and back does not bring the drift back', async () => {
    const dir = repo();
    git(dir, 'branch', 'other');
    put(join(dir, 'readme.txt'), 'the logged work\n', ago(50));
    put(join(dir, 'sub', 'new file.txt'), 'a new file\n', ago(50));
    await syncProject(dir, parseSyncPayload({}), { author: 'Robin', now: ago(45) });
    gitAt(dir, ago(40), 'add', '-A');
    gitAt(dir, ago(40), 'commit', '-q', '-m', 'commit of logged work');
    expect((await buildRecord(dir, { now: NOW })).activity).toMatchObject({ drift: { commits: 0 }, unlogged: false });
    git(dir, 'checkout', '-q', 'other');
    git(dir, 'checkout', '-q', 'main');
    expect(statSync(join(dir, 'readme.txt')).mtimeMs).toBeGreaterThan(ago(1).getTime()); // the checkout rewrote it
    expect((await buildRecord(dir, { now: NOW })).activity).toMatchObject({ drift: { commits: 0 }, unlogged: false });
  });

  it('sync, then commit: a commit holding a different version of a file dirty at the sync is new work', async () => {
    const dir = repo();
    put(join(dir, 'readme.txt'), 'the logged work\n', ago(50));
    await syncProject(dir, parseSyncPayload({}), { author: 'Robin', now: ago(45) });
    put(join(dir, 'readme.txt'), 'changed again after the sync\n', ago(44));
    utimesSync(join(dir, 'readme.txt'), ago(46), ago(46)); // an mtime that says "before the sync" must not matter
    gitAt(dir, ago(40), 'commit', '-q', '-am', 'more work');
    expect((await buildRecord(dir, { now: NOW })).activity).toMatchObject({ drift: { commits: 1 }, unlogged: true });
  });

  it('sync, then commit: a file left dirty from before the sync does not make the work unlogged', async () => {
    const dir = repo();
    put(join(dir, 'notes.txt'), 'scratch, never committed\n', ago(60));
    put(join(dir, 'work.txt'), 'the work\n', ago(50));
    await syncProject(dir, parseSyncPayload({}), { author: 'Robin', now: ago(45) });
    gitAt(dir, ago(40), 'add', 'work.txt');
    gitAt(dir, ago(40), 'commit', '-q', '-m', 'the work');
    const a = (await buildRecord(dir, { now: NOW })).activity!;
    expect(a.git!.dirty).toBe(true);
    expect(a.drift.commits).toBe(0);
    expect(a.unlogged).toBe(false);
    rmSync(join(dir, 'readme.txt')); // a deletion has no mtime of its own; its folder's says when
    expect((await buildRecord(dir, { now: new Date() })).activity!.unlogged).toBe(true);
    git(dir, 'checkout', '-q', '--', 'readme.txt');
    utimesSync(dir, ago(60), ago(60));
    utimesSync(join(dir, 'readme.txt'), ago(60), ago(60));
    expect((await buildRecord(dir, { now: NOW })).activity!.unlogged).toBe(false);
    put(join(dir, 'notes.txt'), 'scratch, edited after the sync\n', ago(5));
    expect((await buildRecord(dir, { now: NOW })).activity!.unlogged).toBe(true);
  });

  it('a {} sync after two commits clears the drift', async () => {
    const dir = repo();
    commit(dir, 'a.txt', ago(30));
    commit(dir, 'b.txt', ago(20));
    expect((await buildRecord(dir, { now: NOW })).activity!.drift.commits).toBe(2);
    await syncProject(dir, parseSyncPayload({}), { author: 'Robin', now: ago(5) });
    const r = await buildRecord(dir, { now: NOW });
    expect(r.activity!.drift).toEqual({ since: iso(5), commits: 0, files: null });
    expect(r.activity!.unlogged).toBe(false);
  });

  it('a baseline older than the 30-day window counts with rev-list', async () => {
    const dir = repo(60 * 24 * 90);
    commit(dir, 'a.txt', ago(60 * 24 * 50));
    commit(dir, 'b.txt', ago(60 * 24 * 45));
    commit(dir, 'c.txt', ago(60));
    const a = await act(dir, { log: 60 * 24 * 60 });
    expect(a.drift.commits).toBe(3);
    expect(a.daily!.reduce((x, y) => x + y, 0)).toBe(1);
  });

  it('a project reached through a junction (a symlink elsewhere) reads like the folder itself', async () => {
    const dir = repo();
    commit(dir, 'a.txt', ago(30));
    put(join(dir, 'dirty.txt'), 'x', ago(5));
    const link = join(tmp('ra-'), 'via-link');
    symlinkSync(dir, link, 'junction');
    const direct = await act(dir, { sync: 100 });
    const linked = await act(link, { sync: 100 });
    expect(linked).toMatchObject({ source: 'git', error: null, lastWorkAt: direct.lastWorkAt, drift: direct.drift, git: { subpath: '', dirty: true, dirtyCount: 1 } });
  });

  it('a branch name with non-ASCII letters is read as it is', async () => {
    const dir = repo();
    git(dir, 'checkout', '-q', '-b', 'fé/agent-ü');
    expect((await act(dir)).git!.branch).toBe('fé/agent-ü');
  });

  it('a detached HEAD has no branch and a full head', async () => {
    const dir = repo();
    commit(dir, 'a.txt', ago(30));
    git(dir, 'checkout', '-q', '--detach');
    const a = await act(dir);
    expect(a.git!.branch).toBeNull();
    expect(a.git!.head).toBe(git(dir, 'rev-parse', 'HEAD'));
  });

  it('a repository with no commits is git, with no last commit and its untracked files as dirty', async () => {
    const dir = join(tmp('ra-'), 'empty');
    mkdirSync(dir);
    git(dir, 'init', '-q');
    put(join(dir, 'new.txt'), 'x', ago(3));
    const a = await act(dir);
    expect(a).toMatchObject({ source: 'git', error: null, drift: { commits: 0, files: null } });
    expect(a.git).toMatchObject({ head: '', lastCommit: null, dirty: true, dirtyCount: 1, branch: 'main' });
    expect(a.daily!.every((n) => n === 0)).toBe(true);
    expect(Date.parse(a.lastWorkAt!)).toBe(ago(3).getTime());
  });

  it('a shallow clone reads like any other', async () => {
    const origin = repo();
    commit(origin, 'a.txt', ago(30));
    commit(origin, 'b.txt', ago(20));
    const dir = join(origin, '..', 'shallow');
    git(join(origin, '..'), 'clone', '-q', '--depth', '1', `file://${origin.replace(/\\/g, '/')}`, dir);
    expect(git(dir, 'rev-parse', '--is-shallow-repository')).toBe('true');
    const a = await act(dir);
    expect(a.source).toBe('git');
    expect(a.error).toBeNull();
    expect(a.git!.lastCommit!.subject).toBe('change b.txt');
    expect(a.drift.commits).toBe(1);
  });

  it('a clock that runs ahead never puts work in the future', async () => {
    const dir = repo();
    commit(dir, 'future.txt', new Date(NOW.getTime() + 3 * 24 * 3600_000));
    put(join(dir, 'dirty.txt'), 'x', new Date(NOW.getTime() + 24 * 3600_000));
    const a = await act(dir, { sync: 60 });
    expect(a.lastWorkAt).toBe(NOW.toISOString());
    expect(a.daily![DAYS - 1]).toBe(1);
    expect(a.drift.commits).toBe(1);
  });

  it('5,000 commits: one project inside its time budget', { timeout: 120_000 }, async () => {
    const dir = join(tmp('ra-'), 'big');
    mkdirSync(dir);
    git(dir, 'init', '-q');
    const start = Math.floor(NOW.getTime() / 1000) - 200 * 86400;
    let stream = '';
    for (let i = 0; i < 5000; i++) {
      const t = start + i * Math.floor((200 * 86400) / 5000);
      const body = `line ${i}\n`;
      stream += `commit refs/heads/main\ncommitter Robin <robin@example.com> ${t} +0000\ndata 7\ncommit\n${i ? '' : ''}M 644 inline f${i % 50}.txt\ndata ${Buffer.byteLength(body)}\n${body}\n`;
    }
    execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: stream, stdio: ['pipe', 'ignore', 'pipe'] });
    git(dir, 'reset', '-q', '--hard', 'main');
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('5000');
    const calls: string[][] = [];
    const counted: Exec = (file, args, opts) => (calls.push([...args]), execGit(file, args, opts));
    const t0 = performance.now();
    const a = await computeActivity(dir, { lastLogAt: iso(60 * 24 * 10), lastSyncAt: null, now: NOW, git: makeGit(findGitBinary()!, counted) });
    const ms = performance.now() - t0;
    expect(a.source).toBe('git');
    expect(a.drift.commits).toBeGreaterThan(200);
    expect(a.daily!.reduce((x, y) => x + y, 0)).toBeGreaterThan(700);
    // 7.5: about 4 spawns at 40–80 ms each per project. What keeps 5,000 commits inside that, on
    // any machine: few spawns, and no call that walks the history unbounded (each log or
    // rev-list is cut by a date or a count).
    const sub = (c: string[]): string => {
      for (let i = c.indexOf('--no-optional-locks') + 1; i < c.length; i += c[i] === '-c' ? 2 : 1) if (c[i] !== '-c') return c[i]!;
      return '';
    };
    console.log(`5,000 commits: ${Math.round(ms)} ms, git ${calls.map(sub).join(', ')}`);
    expect(calls.length).toBeLessThanOrEqual(GIT_CALLS_5000);
    for (const c of calls.filter((c) => ['log', 'rev-list'].includes(sub(c)))) expect(c.some((x) => /^--since=|^-n$|^-1$/.test(x)), c.join(' ')).toBe(true);
    // a generous ceiling, not a benchmark, and a wall-clock one: held on an idle machine
    if (FULL) expect(ms).toBeLessThan(2000);
    rmSync(join(dir, '..'), { recursive: true, force: true });
  });
});

describe('activity: folders without git', () => {
  function folder(): string {
    const dir = join(tmp('ra-'), 'plain');
    put(join(dir, 'BLIP.md'), '---\nblip: 3\n---\n\n# Tasks\n\n# Session log\n', ago(1));
    put(join(dir, 'old.txt'), 'x', ago(600));
    put(join(dir, 'docs', 'new.md'), 'x', ago(30));
    put(join(dir, 'docs', 'deeper', 'newer.md'), 'x', ago(20));
    put(join(dir, 'node_modules', 'pkg', 'index.js'), 'x', ago(2));
    put(join(dir, '.cache', 'thing'), 'x', ago(2));
    put(join(dir, 'dist', 'out.js'), 'x', ago(2));
    put(join(dir, '.env'), 'x', ago(700));
    return dir;
  }

  it('counts files modified after the baseline; BLIP.md, dot-folders and build folders are not work; no daily counts', async () => {
    const dir = folder();
    const a = await act(dir, { sync: 100 });
    expect(a).toMatchObject({ source: 'files', git: null, daily: null, error: null, unlogged: true });
    expect(a.drift).toEqual({ since: iso(100), commits: null, files: 2 });
    expect(a.lastWorkAt).toBe(iso(20));
    expect(a.lastTouchedAt).toBe(iso(20));
    const quiet = await act(dir, { log: 10 });
    expect(quiet.drift.files).toBe(0);
    expect(quiet.unlogged).toBe(false);
    expect(quiet.lastTouchedAt).toBe(iso(10));
  });

  it('without a baseline, counts the files of the last 30 days', async () => {
    const dir = folder();
    put(join(dir, 'ancient.txt'), 'x', ago(60 * 24 * 45));
    expect((await act(dir)).drift.files).toBe(4);
  });

  it('a future mtime is clamped to now', async () => {
    const dir = folder();
    put(join(dir, 'skewed.txt'), 'x', new Date(NOW.getTime() + 7 * 24 * 3600_000));
    const a = await act(dir, { sync: 100 });
    expect(a.lastWorkAt).toBe(NOW.toISOString());
    expect(a.drift.files).toBe(3);
  });

  it('a folder with nothing but BLIP.md is source none', async () => {
    const dir = join(tmp('ra-'), 'bare');
    put(join(dir, 'BLIP.md'), '---\nblip: 3\n---\n', ago(1));
    expect(await act(dir)).toMatchObject({ source: 'none', lastWorkAt: null, drift: { files: 0 }, unlogged: false });
  });

  it('a missing git binary leaves every project on file times, without throwing', async () => {
    const dir = repo();
    const a = await computeActivity(dir, { lastLogAt: null, lastSyncAt: null, git: null, now: NOW });
    expect(a).toMatchObject({ source: 'files', git: null, daily: null, error: null });
    expect(findGitBinary('')).toBeNull();
    expect(findGitBinary(join(tmp(), 'nothing-here'))).toBeNull();
  });

  describe('a 50,000-file tree beside a node_modules', () => {
    let dir: string;
    beforeAll(() => {
      dir = join(tmp('ra-'), 'huge');
      for (let a = 0; a < 50; a++) {
        for (let b = 0; b < 10; b++) {
          const d = join(dir, `a${a}`, `b${b}`);
          mkdirSync(d, { recursive: true });
          for (let f = 0; f < 100; f++) writeFileSync(join(d, `f${f}.txt`), '');
        }
      }
      for (let f = 0; f < 2000; f++) put(join(dir, 'node_modules', `m${f % 20}`, `f${f}.js`), '', new Date());
    }, 300_000);
    afterAll(() => rmSync(join(dir, '..'), { recursive: true, force: true }), 300_000);

    it('stops at 5,000 entries inside its time budget and says the numbers are partial', async () => {
      let a!: Activity;
      const t0 = performance.now();
      const cpu = await cpuMs(async () => (a = await act(dir, { sync: 60 * 24 })));
      const ms = performance.now() - t0;
      expect(a.source).toBe('files');
      expect(a.error).toBe('partial');
      expect(a.drift.files).toBeGreaterThan(1000);
      expect(a.drift.files).toBeLessThan(5000);
      // the walk's own work (its file reads on libuv's threads included) on any machine; wall time on an idle one
      expect(cpu).toBeLessThan(3000);
      if (FULL) expect(ms).toBeLessThan(3000);
    });
  });
});

describe('activity: the git runner', () => {
  /** A repository whose own config names programs to run, and which holds a git of its own. */
  function hostile(): { dir: string; marker: string } {
    const dir = repo();
    const base = join(dir, '..');
    const marker = join(base, 'marker.txt');
    const m = marker.replace(/\\/g, '/');
    const script = join(base, 'evil.sh').replace(/\\/g, '/');
    writeFileSync(script, `#!/bin/sh\necho "$1" >> "${m}"\ncat\n`);
    const run = `sh "${script}"`;
    const hooks = join(base, 'hooks');
    mkdirSync(hooks);
    for (const h of ['post-index-change', 'reference-transaction', 'post-checkout', 'pre-commit']) writeFileSync(join(hooks, h), `#!/bin/sh\necho hook-${h} >> "${m}"\n`, { mode: 0o755 });
    const set = (k: string, v: string): string => git(dir, 'config', k, v);
    set('core.fsmonitor', `${run} fsmonitor`);
    set('core.pager', `${run} pager`);
    set('core.hooksPath', hooks.replace(/\\/g, '/'));
    set('alias.status', `!${run} alias`);
    set('alias.log', `!${run} alias`);
    set('log.showSignature', 'true');
    set('gpg.program', `${run} gpg`);
    set('diff.external', `${run} diff`);
    set('filter.evil.clean', `${run} clean`);
    set('filter.evil.smudge', `${run} smudge`);
    set('filter.evil.process', `${run} process`);
    // The same settings again, through an included file and a conditional include.
    const included = join(base, 'included.cfg');
    writeFileSync(included, `[core]\n\tfsmonitor = ${run} included\n[filter "incl"]\n\tclean = ${run} included-clean\n`);
    set('include.path', included.replace(/\\/g, '/'));
    set(`includeIf.gitdir:${dir.replace(/\\/g, '/')}/.path`, included.replace(/\\/g, '/'));
    writeFileSync(join(dir, '.gitattributes'), '* filter=evil\n*.txt filter=incl\n');
    for (const name of ['git.cmd', 'git.bat']) writeFileSync(join(dir, name), `@echo off\r\necho local-git >> "${marker}"\r\n`);
    writeFileSync(join(dir, 'git'), `#!/bin/sh\necho local-git >> "${m}"\n`, { mode: 0o755 });
    // Make every tracked file look changed, so status has to read it again through the filter.
    put(join(dir, 'readme.txt'), readFileSync(join(dir, 'readme.txt'), 'utf8'), ago(1));
    return { dir, marker };
  }

  it('the hostile fixture is live: plain git runs its programs', () => {
    const { dir, marker } = hostile();
    try {
      execFileSync('git', ['status'], { cwd: dir, stdio: 'ignore' });
    } catch {
      // only the marker matters
    }
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toMatch(/fsmonitor|clean|process/);
  });

  it('never runs anything a hostile repository names, nor a git of its own', async () => {
    const { dir, marker } = hostile();
    const a = await act(dir, { sync: 100 });
    expect(a.source).toBe('git');
    expect(a.git!.dirty).toBe(true); // .gitattributes and the stub gits are untracked
    const snap = await dirtySnapshot(dir); // what a sync records: hash-object reads every dirty file
    expect(snap['.gitattributes']).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(marker)).toBe(false);
  });

  it('every call carries the neutralising flags, one argv element per value, outside the project, with no GIT_* variable', async () => {
    const { dir } = hostile();
    mkdirSync(data, { recursive: true });
    const calls: { file: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
    const bin = findGitBinary()!;
    const spy: Exec = (file, args, opts) => {
      calls.push({ file, args, cwd: opts.cwd, env: opts.env });
      return execGit(file, args, opts);
    };
    process.env.GIT_DIR = join(tmp(), 'elsewhere');
    process.env.GIT_CONFIG_PARAMETERS = "'core.fsmonitor'='true'";
    try {
      const a = await computeActivity(dir, { lastLogAt: null, lastSyncAt: null, git: makeGit(bin, spy), now: NOW });
      expect(a.source).toBe('git');
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.GIT_CONFIG_PARAMETERS;
    }
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) {
      expect(isAbsolute(c.file)).toBe(true);
      expect(relative(dir, c.file).startsWith('..')).toBe(true);
      expect(c.args.slice(0, 13)).toEqual(['-C', dir, '-c', 'core.fsmonitor=', '-c', 'core.pager=cat', '-c', 'log.showSignature=false', '-c', 'core.hooksPath=', '-c', 'core.quotePath=false', '--no-pager']);
      expect(c.args).toContain('--no-optional-locks');
      expect(relative(dir, c.cwd).startsWith('..')).toBe(true);
      expect(c.cwd).toBe(data);
      expect(Object.keys(c.env).filter((k) => /^GIT_/i.test(k)).sort()).toEqual(['GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT']);
      expect(c.args.every((x) => typeof x === 'string')).toBe(true);
    }
    const status = calls.find((c) => c.args.includes('status'))!;
    expect(status.args).toContain('filter.evil.clean=');
    expect(status.args).toContain('filter.evil.process=');
    expect(status.args).toContain('filter.incl.clean='); // named only in an included file
  });

  it('a timeout ends git and everything git started, not git alone', async () => {
    const base = tmp();
    const marker = join(base, 'marker.txt');
    // A stand-in for any slow child of git (and, on Windows, for the real git behind Git\cmd\git.exe).
    const args = ['-c', `alias.slow=!sleep 3; echo still-running > "${marker.replace(/\\/g, '/')}"`, 'slow'];
    const err = await systemGit()!.run(base, args, 500).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).timedOut).toBe(true);
    await new Promise((r) => setTimeout(r, 5000));
    expect(existsSync(marker)).toBe(false);
  });

  it('the snapshot a sync records waits out a git that is slower than the board would', async () => {
    const dir = repo();
    put(join(dir, 'work.txt'), 'the work\n', ago(5));
    // Every call takes 3.5 s: one with a shorter timeout times out, as execFile's would.
    const slow: Exec = async (file, args, opts) => {
      if (opts.timeout < 3500) throw new GitError('git timed out', null, true, '');
      return execGit(file, args, opts);
    };
    expect(await dirtySnapshot(dir, makeGit(findGitBinary()!, slow))).toEqual({ 'work.txt': git(dir, 'hash-object', 'work.txt') });
  });

  it('git that fails for a reason other than "not a repository" falls back to file times and says why', async () => {
    const dir = repo();
    const failing = makeGit(findGitBinary()!, async () => {
      throw new GitError("fatal: detected dubious ownership in repository at '/x'", 128, false, "fatal: detected dubious ownership in repository at '/x'");
    });
    const a = await computeActivity(dir, { lastLogAt: null, lastSyncAt: null, git: failing, now: NOW });
    expect(a.source).toBe('files');
    expect(a.error).toMatch(/dubious ownership/);
  });

  it('finds git only in absolute PATH entries', () => {
    const base = tmp();
    const name = process.platform === 'win32' ? 'git.exe' : 'git';
    mkdirSync(join(base, 'bin'));
    writeFileSync(join(base, 'bin', name), '');
    const sep = process.platform === 'win32' ? ';' : ':';
    expect(findGitBinary(['.', 'bin', join(base, 'bin')].join(sep))).toBe(join(base, 'bin', name));
    expect(findGitBinary(['.', 'bin'].join(sep))).toBeNull();
    expect(systemGit()).not.toBeNull();
  });

  it('drops every GIT_ variable, whatever its case', () => {
    const env = gitEnv({ PATH: 'p', GIT_DIR: 'x', git_work_tree: 'y', GIT_EXEC_PATH: 'z', HOME: 'h' });
    expect(env).toEqual({ PATH: 'p', HOME: 'h', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' });
  });

  it('a removed project folder is a missing record, not an error', async () => {
    const dir = repo();
    rmSync(join(dir, 'BLIP.md'));
    expect(await buildRecord(dir, { now: NOW })).toMatchObject({ state: 'missing', doc: null, activity: null, rev: '' });
  });
});
