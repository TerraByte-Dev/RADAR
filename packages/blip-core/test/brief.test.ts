import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { buildBrief, briefBytes, fitBrief, ownerName, type Brief } from '../src/brief.js';
import { CAPS } from '../src/core/schema.js';
import { parseBlip } from '../src/core/doc.js';
import { migrateFile } from '../src/core/normalize.js';
import { lint } from '../src/core/lint.js';
import { readProject, syncProject } from '../src/io.js';
import { parseSyncPayload } from '../src/core/sync.js';
import { systemGit } from '../src/git.js';
import { fixture } from './core/fixtures.js';
import { bigV3, git, isolate, project, tmp } from './helpers.js';

let data: string;
beforeEach(() => {
  data = isolate();
});

const v3 = (rel: string): string => migrateFile(parseBlip(fixture(rel), { dirName: 'x' })).text;

const WORDS = ['paint', 'shed', 'ladder', 'hinge', 'gutter', 'fence', 'bench', 'lantern', 'trellis', 'barrow', 'kettle', 'shelf'];
const words = (n: number, seed: number): string => Array.from({ length: n }, (_, i) => WORDS[(i * 7 + seed) % WORDS.length]).join(' ');

/** A v3 file with 95 tasks, a 1,000-character detail line on task 1, and two 3,500-character log entries. */
function longEntryFile(): string {
  const tasks = Array.from({ length: 95 }, (_, i) => `- [ ] Check the ${words(6, i)} number ${i + 1}`);
  tasks.splice(1, 0, `  - ${words(200, 3).slice(0, 1000)}`);
  const entry = (h: string, seed: number): string => `## ${h}\n${Array.from({ length: 7 }, (_, i) => `- ${words(90, seed + i).slice(0, 499)}`).join('\n')}\n`;
  return `---\nblip: 3\nname: Long Entries\nnow: Clearing the shed before the open day.\n---\n\n# Tasks\n\n${tasks.join('\n')}\n\n# Session log\n\n${entry('2026-10-12 10:00 — Robin + Claude', 1)}\n${entry('2026-10-11 09:00 — Robin + Claude', 5)}`;
}

describe('brief', () => {
  it('on the 95-task fixture: under 8 KB, every title, rev, owner and a payload path under <data>/tmp', async () => {
    const dir = project(v3('v2/queue-95.md'));
    const doc = (await readProject(dir)).file.doc();
    expect(doc.tasks.open.length).toBe(95);
    const b = await buildBrief(dir);
    expect(briefBytes(b)).toBeLessThanOrEqual(CAPS.BRIEF_MAX_BYTES);
    expect(b.tasks.map((t) => t.title)).toEqual(doc.tasks.open.map((t) => t.title));
    expect(b.omitted).toBeUndefined();
    expect(b.open).toBe(95);
    expect(b.rev).toBe((await readProject(dir)).rev);
    expect(b.owner === null || typeof b.owner === 'string').toBe(true);
    expect(relative(join(data, 'tmp'), b.payloadPath)).not.toMatch(/^\.\.|[\\/]/);
    expect(b.payloadPath).toMatch(/\.json$/);
    expect(existsSync(join(data, 'tmp'))).toBe(true);
    expect(b.tasks.slice(1).every((t) => t.detail === undefined)).toBe(true);
  });

  it('on the long-entry fixture: under 8 KB, the clipping recorded, task 1 kept whole', async () => {
    const dir = project(longEntryFile());
    const doc = (await readProject(dir)).file.doc();
    expect(doc.log[0]!.bullets.join('').length).toBeGreaterThan(3400);
    expect(doc.tasks.open[0]!.detail[0]!.length).toBeGreaterThanOrEqual(1000);
    const b = await buildBrief(dir);
    expect(briefBytes(b)).toBeLessThanOrEqual(CAPS.BRIEF_MAX_BYTES);
    expect(b.clipped).toBeDefined();
    expect(b.clipped!.lines).toBeGreaterThan(0);
    expect(b.tasks[0]!.title).toBe(doc.tasks.open[0]!.title);
    expect(Array.from(b.tasks[0]!.detail![0]!).length).toBe(200);
  });

  it('on the 83 KB file: under 8 KB, and the next step is never cut', async () => {
    const dir = project(bigV3());
    const doc = (await readProject(dir)).file.doc();
    const b = await buildBrief(dir);
    expect(briefBytes(b)).toBeLessThanOrEqual(CAPS.BRIEF_MAX_BYTES);
    expect(b.tasks[0]).toMatchObject({ n: 1, title: doc.next!.title });
    expect(b.tasks.length + (b.omitted ?? 0)).toBe(doc.tasks.open.length);
    expect(b.log.length).toBeGreaterThan(0);
  });

  it('keeps the cap on a file nobody should write: a 20,000-character Now line and a 3,000-character first title', async () => {
    const text = `---\nblip: 3\nname: Overgrown\nnow: ${words(4000, 1).slice(0, 20000)}\n---\n\n# Tasks\n\n- [ ] ${words(600, 2).slice(0, 3000)}\n${Array.from({ length: 200 }, (_, i) => `- [ ] Task ${i} ${words(30, i)}`).join('\n')}\n\n# Session log\n`;
    const dir = project(text);
    const b = await buildBrief(dir);
    expect(briefBytes(b)).toBeLessThanOrEqual(CAPS.BRIEF_MAX_BYTES);
    expect(b.tasks[0]!.n).toBe(1);
    expect(b.tasks[0]!.title.startsWith(words(600, 2).slice(0, 70))).toBe(true);
  });

  it('applies the steps in order, and only as far as needed', () => {
    const base = (): Brief => ({
      dir: 'C:\\p',
      rev: '0123456789abcdef',
      owner: 'Dana',
      payloadPath: 'C:\\d\\tmp\\x.json',
      name: 'Sample',
      now: 'Working.',
      status: 'active',
      focus: false,
      open: 22,
      tasks: [
        { n: 1, title: 'First task', detail: ['x'.repeat(300)] },
        { n: 2, title: 'y'.repeat(120) },
        ...Array.from({ length: 20 }, (_, i) => ({ n: i + 3, title: `Another task to do, number ${i + 3}` })),
      ],
      log: [
        { heading: 'one', bullets: ['z'.repeat(250)] },
        { heading: 'two', bullets: ['short'] },
      ],
      since: { at: null, commits: 7, subjects: Array.from({ length: 10 }, (_, i) => `abc123${i} subject`), files: null, dirty: false, branch: 'main' },
      problems: [],
    });
    expect(fitBrief(base()).clipped).toBeUndefined();
    const full = briefBytes(base());
    // Just short of fitting: step 1 is enough.
    const one = fitBrief(base(), full - 100);
    expect(one.clipped).toEqual({ lines: 2 });
    expect(one.log).toHaveLength(2);
    // Much smaller: every step through 6.
    const six = fitBrief(base(), full - 700);
    expect(Object.keys(six.clipped!)).toEqual(['lines', 'log', 'subjects', 'titles', 'tasks']);
    expect(six.tasks[0]!.title).toBe('First task');
    expect(six.omitted).toBeGreaterThan(0);
    expect(briefBytes(six)).toBeLessThanOrEqual(full - 700);
  });

  it('orders problems: errors, then the ones an agent fixes, then a count of the rest', async () => {
    const text = '---\nblip: 3\n---\n\n# Tasks\n\n- [ ] FIX THE GATE NOW PLEASE\n- [ ] Paint the shed (due friday)\n- [ ] Oil the hinge\n- [ ] Oil the hinge\n\n# Session log\n';
    const dir = project(text);
    const problems = lint((await readProject(dir)).file);
    const b = await buildBrief(dir);
    const codes = b.problems.map((p) => p.code);
    const errors = problems.filter((p) => p.severity === 'error').length;
    expect(codes.slice(0, errors).every((c) => problems.find((p) => p.code === c)?.severity === 'error')).toBe(true);
    expect(codes).toContain('name-missing');
    expect(codes).toContain('now-missing');
    expect(codes.indexOf('name-missing')).toBeLessThan(codes.indexOf('now-missing'));
    const shown = b.problems.filter((p) => p.code !== 'more').length;
    expect(codes.at(-1)).toBe('more');
    expect(b.problems.at(-1)!.message).toBe(`${problems.length - shown} more: radar-blip lint`);
  });

  it('deletes payload files older than a day and keeps the rest', async () => {
    const dir = project();
    const tmpDir = join(data, 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    const old = join(tmpDir, 'old.json');
    const fresh = join(tmpDir, 'fresh.json');
    writeFileSync(old, '{}');
    writeFileSync(fresh, '{}');
    const twoDays = new Date(Date.now() - 48 * 3600_000);
    utimesSync(old, twoDays, twoDays);
    await buildBrief(dir);
    expect(readdirSync(tmpDir).sort()).toEqual(['fresh.json']);
  });

  it('since: commits after the baseline with their subjects, the branch and dirt; files for a folder without git', async () => {
    const dir = project();
    git(dir, 'init', '-q');
    git(dir, 'add', 'BLIP.md');
    git(dir, 'commit', '-q', '-m', 'blip');
    writeFileSync(join(dir, 'a.txt'), 'a');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'add the a file');
    writeFileSync(join(dir, 'b.txt'), 'b');
    const b = await buildBrief(dir);
    expect(b.since).toMatchObject({ commits: 1, files: null, dirty: true, branch: 'main' });
    expect(b.since.subjects).toHaveLength(1);
    expect(b.since.subjects[0]).toMatch(/^[0-9a-f]{7,} add the a file$/);

    const plain = project();
    writeFileSync(join(dirname(join(plain, 'x')), 'notes.txt'), 'n');
    const p = await buildBrief(plain);
    expect(p.since).toMatchObject({ commits: null, files: 1, dirty: null, branch: null, subjects: [] });
  });

  it('since: a commit of work the last sync already covered is neither counted nor listed', async () => {
    const dir = project();
    git(dir, 'init', '-q');
    git(dir, 'add', 'BLIP.md');
    git(dir, 'commit', '-q', '-m', 'blip');
    writeFileSync(join(dir, 'a.txt'), 'work in the log');
    await syncProject(dir, parseSyncPayload({}), { author: 'Robin', now: new Date(Date.now() - 60_000) });
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'commit of work already in the log');
    writeFileSync(join(dir, 'b.txt'), 'new work');
    git(dir, 'add', 'b.txt');
    git(dir, 'commit', '-q', '-m', 'genuinely new work');
    const b = await buildBrief(dir);
    expect(b.since.commits).toBe(1);
    expect(b.since.subjects).toHaveLength(1);
    expect(b.since.subjects[0]).toMatch(/^[0-9a-f]{7,} genuinely new work$/);
  });

  it('owner is the first word of the global git user name', async () => {
    const home = tmp('ra-home-');
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Dana Example\n');
    const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(home, 'xdg');
    try {
      expect(await ownerName(systemGit())).toBe('Dana');
      const dir = project();
      expect((await buildBrief(dir)).owner).toBe('Dana');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(typeof (await ownerName(null))).toBe('string');
  });
});
