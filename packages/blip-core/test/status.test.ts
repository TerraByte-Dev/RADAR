import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { BOARD_CONCURRENCY, buildBoard, buildRecord, isProjectRecord } from '../src/board.js';
import { execGit, findGitBinary, makeGit, type Exec } from '../src/git.js';
import { readLiveMarkers, presenceOf } from '../src/agents/claude/live.js';
import { projectId } from '../src/paths.js';
import { listProjects, registerProject, setHidden } from '../src/registry.js';
import { fixture } from './core/fixtures.js';
import { fileURLToPath } from 'node:url';
import { git, gitAt, isolate, project, run, spawn, tmp } from './helpers.js';
import { FULL } from './timing.js';

let data: string;
beforeEach(() => {
  data = isolate();
});

const json = (r: { stdout: string }): any => JSON.parse(r.stdout);
/** Git calls one project costs when a board is built (measured: a repository 5, a folder without git 2), and the most one project has running at once (a Promise.all of 3). */
const GIT_CALLS_PER_REPO = 5;
const GIT_CALLS_PER_FOLDER = 2;
const GIT_CALLS_AT_ONCE = 3;
const file = (name: string, now = 'Working on it.', extra = ''): string => `---\nblip: 3\nname: ${name}\nnow: ${now}\n${extra}---\n\n# Tasks\n\n- [ ] First task here\n\n# Session log\n`;

/** Write a live marker for a session in `cwd` whose transcript was last written `minAgo` minutes ago. */
function marker(id: string, cwd: string, minAgo: number, projects: string[] = []): void {
  const transcript = join(tmp(), `${id}.jsonl`);
  writeFileSync(transcript, '{}\n');
  const t = new Date(Date.now() - minAgo * 60_000);
  utimesSync(transcript, t, t);
  mkdirSync(join(data, 'live'), { recursive: true });
  writeFileSync(join(data, 'live', `${id}.json`), JSON.stringify({ sessionId: id, cwd, transcriptPath: transcript, startedAt: t.toISOString(), scannedBytes: 0, projects: Object.fromEntries(projects.map((p) => [p, { files: [], committed: false, since: t.toISOString() }])) }));
}

describe('board records', () => {
  it('one record per state: ok, needs-migrate, needs-repair, missing; each passes the type guard', async () => {
    const ok = project(file('Alpha'));
    const v2 = project(fixture('v2/legacy-enums.md'));
    const broken = project(fixture('readonly/broken-yaml.md'));
    const gone = join(tmp(), 'gone');
    const records = await Promise.all([ok, v2, broken, gone].map((d) => buildRecord(d)));
    expect(records.map((r) => r.state)).toEqual(['ok', 'needs-migrate', 'needs-repair', 'missing']);
    for (const r of records) expect(isProjectRecord(r)).toBe(true);
    expect(records[2]!.doc).toMatchObject({ name: 'sample-project', nameSource: 'folder' });
    expect(records[0]).toMatchObject({ id: projectId(ok), dir: ok, hidden: false, agent: { live: false, sessions: 0, lastSeenAt: null } });
    expect(records[0]!.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(isProjectRecord({ ...records[0], agent: null })).toBe(false);
    expect(isProjectRecord({ ...records[0], activity: { ...records[0]!.activity, daily: [1] } })).toBe(false);
  });

  it('cachedOnly: activity is the given entry while it holds, else null, and git is never run', async () => {
    const dir = project(file('Alpha'));
    git(dir, 'init', '-q');
    let calls = 0;
    const spy = { run: async (): Promise<string> => { calls++; throw new Error('not here'); } };
    expect((await buildRecord(dir, { cachedOnly: true, git: spy })).activity).toBeNull();
    const real = (await buildRecord(dir)).activity!;
    expect((await buildRecord(dir, { cachedOnly: true, git: spy, activity: real })).activity).toEqual(real);
    expect((await buildRecord(dir, { cachedOnly: true, git: spy, activity: { ...real, lastLogAt: '2001-01-01T00:00:00.000Z' } })).activity).toBeNull();
    expect(calls).toBe(0);
  });

  it('live: a marker naming the project, or whose cwd resolves to it, with a transcript written in the last five minutes', async () => {
    const a = project(file('Alpha'));
    const b = project(file('Bravo'));
    const c = project(file('Charlie'));
    marker('s1', join(a, 'src'), 1);
    marker('s2', tmp(), 2, [b]);
    marker('s3', c, 6);
    const markers = await readLiveMarkers();
    expect(presenceOf(a, markers)).toMatchObject({ live: true, sessions: 1 });
    expect(presenceOf(b, markers)).toMatchObject({ live: true, sessions: 1 });
    const stale = presenceOf(c, markers);
    expect(stale.live).toBe(false);
    expect(stale.sessions).toBe(0);
    expect(stale.lastSeenAt).not.toBeNull();
    writeFileSync(join(data, 'live', 'junk.json'), 'not json');
    expect(await readLiveMarkers()).toHaveLength(3);
  });
});

describe('CLI: status', () => {
  it('lists tracked projects, live then focused then most recent; hides hidden, archived and missing unless --all', async () => {
    const recent = project(file('Recent'));
    const focused = project(file('Focused', 'Pinned for the week.', 'focus: true\n'));
    const live = project(file('Live'));
    const hidden = project(file('Hidden'));
    const archived = project(file('Archived', 'Done with it.', 'status: archived\n'));
    const missing = project(file('Missing'));
    for (const d of [recent, focused, live, hidden, archived, missing]) await registerProject(d);
    await setHidden(hidden, true);
    rmSync(join(missing, 'BLIP.md'));
    // Give the projects distinct ages through their only file.
    const old = new Date(Date.now() - 3 * 86400_000);
    for (const d of [focused, live]) utimesSync(join(d, 'BLIP.md'), old, old);
    writeFileSync(join(recent, 'notes.txt'), 'x');
    marker('s1', live, 1);

    const r = run(['status']);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    const rows = r.stdout.trimEnd().split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^● {2}Live/);
    expect(rows[1]).toMatch(/^ ★ Focused/);
    expect(rows[2]).toMatch(/^ {3}Recent +Working on it\. +just now/);
    expect(r.stdout).not.toMatch(/overdue|neglected|attention/i);

    const all = json(run(['status', '--all', '--json']));
    expect(all.ok).toBe(true);
    expect(all.data.warning).toBeNull();
    expect(all.data.projects).toHaveLength(6);
    for (const rec of all.data.projects) expect(isProjectRecord(rec)).toBe(true);
    expect(all.data.projects.find((p: any) => p.dir === missing).state).toBe('missing');
    expect(all.data.projects.find((p: any) => p.dir === hidden).hidden).toBe(true);
    expect(run(['status', '--all']).stdout).toMatch(/Archived/);
  });

  it('never prints a judgement word, and never writes the activity cache: it uses a fresh entry and recomputes a stale one', async () => {
    const a = project(file('Alpha'));
    const b = project(file('Bravo'));
    await registerProject(a);
    await registerProject(b);
    const base = (await buildRecord(a)).activity!;
    const cachePath = join(data, 'activity-cache.json');
    const cache = {
      version: 1,
      projects: {
        [projectId(a)]: { ...base, drift: { ...base.drift, files: 99 }, unlogged: true, computedAt: new Date().toISOString() },
        [projectId(b)]: { ...base, drift: { ...base.drift, files: 77 }, unlogged: true, computedAt: new Date(Date.now() - 120_000).toISOString() },
      },
    };
    writeFileSync(cachePath, JSON.stringify(cache));
    const before = { bytes: readFileSync(cachePath), mtime: statSync(cachePath).mtimeMs };
    const r = run(['status', '--json']);
    const recs = json(r).data.projects;
    expect(recs.find((p: any) => p.dir === a).activity.drift.files).toBe(99);
    expect(recs.find((p: any) => p.dir === b).activity.drift.files).not.toBe(77);
    expect(readFileSync(cachePath).equals(before.bytes)).toBe(true);
    expect(statSync(cachePath).mtimeMs).toBe(before.mtime);
    expect(run(['status']).stdout).toMatch(/\+99 files/);
    expect(run(['status']).stdout).not.toMatch(/overdue|neglected|attention/i);
  });

  it('a fresh cache entry is not used once the log, the last sync or the checked-out commit has moved on', async () => {
    const dir = project(file('Alpha'));
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    gitAt(dir, new Date(Date.now() - 3600_000), 'commit', '-q', '-m', 'first');
    writeFileSync(join(dir, 'a.txt'), 'a');
    git(dir, 'add', 'a.txt');
    gitAt(dir, new Date(Date.now() - 1800_000), 'commit', '-q', '-m', 'work');
    await registerProject(dir);
    const cachePath = join(data, 'activity-cache.json');
    // The entry is computed before a change and written, stamped now, just before status reads
    // it, so it is always inside its minute however slow the machine: a recompute is never just
    // the entry going stale. 4242 files of drift marks an answer that came from the cache.
    let cached: object | null = null;
    const cacheNow = async (): Promise<void> => {
      const activity = (await buildRecord(dir)).activity!;
      cached = { ...activity, drift: { ...activity.drift, files: 4242 } };
    };
    const shown = (): any => {
      writeFileSync(cachePath, JSON.stringify({ version: 1, projects: { [projectId(dir)]: { ...cached, computedAt: new Date().toISOString() } } }));
      return json(run(['status', '--json'])).data.projects[0].activity;
    };

    await cacheNow();
    // nothing has moved on: the entry is used
    expect(shown()).toMatchObject({ git: { branch: 'main' }, drift: { commits: 1, files: 4242 }, unlogged: true, lastSyncAt: null });

    // A new branch with a commit on it, then the agent's `{}` sync.
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'b.txt'), 'b');
    git(dir, 'add', 'b.txt');
    git(dir, 'commit', '-q', '-m', 'more work');
    expect(run(['sync', '-', '--path', dir], { input: '{}' }).code).toBe(0);
    const after = shown();
    expect(after).toMatchObject({ git: { branch: 'feature' }, drift: { commits: 0 }, unlogged: false });
    expect(after.drift.files).not.toBe(4242);
    expect(after.lastSyncAt).not.toBeNull();

    // A commit on the same branch, nothing else.
    await cacheNow();
    expect(shown().drift.files).toBe(4242);
    writeFileSync(join(dir, 'c.txt'), 'c');
    git(dir, 'add', 'c.txt');
    gitAt(dir, new Date(Date.now() + 2000), 'commit', '-q', '-m', 'yet more work'); // a whole second after the sync: commit times have no milliseconds
    const moved = shown();
    expect(moved).toMatchObject({ drift: { commits: 1 }, unlogged: true });
    expect(moved.drift.files).not.toBe(4242);
    expect(moved.git.head).toBe(git(dir, 'rev-parse', 'HEAD'));
  });

  it('with nothing tracked says how to start, and strict arguments still apply', () => {
    expect(run(['status']).stdout).toMatch(/track --find/);
    expect(run(['status', '--jsno']).code).toBe(1);
    expect(run(['status', 'extra']).code).toBe(1);
  });

  it('24 projects, half of them git repositories, inside the budget of spec 7.5', { timeout: 120_000 }, async () => {
    const root = tmp('ra-b-');
    for (let i = 0; i < 24; i++) {
      const dir = join(root, `p${i}`);
      mkdirSync(dir);
      writeFileSync(join(dir, 'BLIP.md'), file(`Project ${i}`));
      for (let f = 0; f < 20; f++) writeFileSync(join(dir, `f${f}.txt`), `${f}`);
      if (i % 2 === 0) {
        git(dir, 'init', '-q');
        git(dir, 'add', '-A');
        gitAt(dir, new Date(Date.now() - 11 * 3600_000), 'commit', '-q', '-m', 'first');
        for (let c = 0; c < 5; c++) {
          writeFileSync(join(dir, `f${c}.txt`), `change ${c}`);
          gitAt(dir, new Date(Date.now() - (10 - c) * 3600_000), 'commit', '-q', '-a', '-m', `change ${c}`);
        }
      }
      await registerProject(dir);
    }
    const t0 = performance.now();
    const r = run(['status', '--json']);
    const ms = performance.now() - t0;
    expect(r.code).toBe(0);
    const recs = json(r).data.projects;
    expect(recs).toHaveLength(24);
    expect(recs.filter((p: any) => p.activity.source === 'git')).toHaveLength(12);
    for (const rec of recs) expect(isProjectRecord(rec)).toBe(true);

    // What the budget is made of, which no load changes: the same board built in process with
    // every git call counted. 7.5 prices a project at about 4 spawns, four projects at a time.
    const calls = new Map<string, number>();
    let running = 0;
    let most = 0;
    const counted: Exec = async (bin, args, opts) => {
      calls.set(args[1]!, (calls.get(args[1]!) ?? 0) + 1);
      most = Math.max(most, ++running);
      try {
        return await execGit(bin, args, opts);
      } finally {
        running--;
      }
    };
    const board = await buildBoard((await listProjects()).projects, { git: makeGit(findGitBinary()!, counted) });
    expect(board.filter((b) => b.activity?.source === 'git')).toHaveLength(12);
    const perRepo = [...calls.entries()].filter(([d]) => /p\d*[02468]$/.test(d)).map(([, n]) => n);
    expect(perRepo).toHaveLength(12);
    for (const n of perRepo) expect(n).toBeLessThanOrEqual(GIT_CALLS_PER_REPO);
    expect([...calls.values()].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12 * GIT_CALLS_PER_REPO + 12 * GIT_CALLS_PER_FOLDER);
    expect(most).toBeLessThanOrEqual(BOARD_CONCURRENCY * GIT_CALLS_AT_ONCE);
    console.log(`status, 24 projects: ${Math.round(ms)} ms as a process; git calls per repository ${Math.min(...perRepo)}-${Math.max(...perRepo)}, at most ${most} at once; ${[...calls.values()].reduce((a, b) => a + b, 0)} in all over ${calls.size} folders`);
    // 7.5: 40 projects cold in about 4 s at concurrency 4. 24 projects, process start included,
    // must fit inside that: a wall-clock number, so it is held on an idle machine (RADAR_TEST_FULL).
    if (FULL) expect(ms).toBeLessThan(4000);
  });
});

describe('CLI: brief', () => {
  it('prints the brief, and --json carries rev, owner and payloadPath', () => {
    const dir = project(file('Alpha'));
    const before = readFileSync(join(dir, 'BLIP.md'));
    const r = run(['brief', '--path', dir]);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    expect(r.stdout).toMatch(/^Alpha {2}\[active\]/);
    expect(r.stdout).toMatch(/ {2}1\. First task here/);
    const j = json(run(['brief', '--json', '--path', dir]));
    expect(j.ok).toBe(true);
    expect(j.data).toMatchObject({ dir, name: 'Alpha', open: 1, tasks: [{ n: 1, title: 'First task here' }] });
    expect(j.data.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(j.data.payloadPath.startsWith(join(data, 'tmp'))).toBe(true);
    expect('owner' in j.data).toBe(true);
    // Nothing derived is ever written into the file.
    expect(run(['track', dir]).code).toBe(0);
    expect(run(['status', '--json']).code).toBe(0);
    expect(readFileSync(join(dir, 'BLIP.md')).equals(before)).toBe(true);
  });

  it('from inside a linked worktree, briefs the main checkout', () => {
    const main = project(file('Alpha'));
    git(main, 'init', '-q');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'first');
    const wt = join(main, '..', 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
    const j = json(run(['brief', '--json'], { cwd: wt }));
    expect(j.data.dir).toBe(main);
    expect(j.data.since).toMatchObject({ dirty: false, branch: 'feat' });

    // The agent's own uncommitted work is in the worktree, not in the main checkout.
    writeFileSync(join(wt, 'BLIP.md'), `${readFileSync(join(wt, 'BLIP.md'), 'utf8')}\n`);
    writeFileSync(join(wt, 'new.txt'), 'agent work in progress');
    mkdirSync(join(wt, 'src'));
    const k = json(run(['brief', '--json'], { cwd: join(wt, 'src') }));
    expect(k.data.dir).toBe(main);
    expect(k.data.since).toMatchObject({ dirty: true, branch: 'feat' });
    expect(json(run(['brief', '--json'], { cwd: main })).data.since).toMatchObject({ dirty: false, branch: 'main' });
  });

  it('run inside a hostile repository, with "." first on PATH, runs nothing the repository holds', () => {
    const dir = project(file('Alpha'));
    const marker = join(dir, '..', 'marker.txt');
    const m = marker.replace(/\\/g, '/');
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'first');
    git(dir, 'config', 'core.fsmonitor', `echo fsmonitor >> "${m}"`);
    git(dir, 'config', 'filter.evil.clean', `echo clean >> "${m}"; cat`);
    writeFileSync(join(dir, '.gitattributes'), '* filter=evil\n');
    for (const name of ['git.cmd', 'git.bat']) writeFileSync(join(dir, name), `@echo off\r\necho local-git >> "${marker}"\r\n`);
    writeFileSync(join(dir, 'git'), `#!/bin/sh\necho local-git >> "${m}"\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `.${delimiter}${process.env.PATH ?? process.env.Path ?? ''}` };
    delete env.Path;
    for (const args of [['add', 'Another task here'], ['brief'], ['brief', '--json'], ['status']]) {
      const r = run(args, { cwd: dir, env });
      expect(r.code).toBe(0);
    }
    expect(existsSync(marker)).toBe(false);
  });
});

describe('scripts/bench-activity.mjs', () => {
  it('runs and prints a time', async () => {
    const r = await spawn(fileURLToPath(new URL('../scripts/bench-activity.mjs', import.meta.url)), ['4']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^activity for 4 projects \(2 git\) in \d+ ms/);
  });
});
