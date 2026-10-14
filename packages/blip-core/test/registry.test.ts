import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSyncPayload } from '../src/core/sync.js';
import { syncProject, updateProject } from '../src/io.js';
import { projectKey, resolveProject } from '../src/paths.js';
import { findProjects, listProjects, registerProject, setHidden, unregisterProject } from '../src/registry.js';
import { NOW } from './core/fixtures.js';
import { bytesOf, isolate, project, spawn, tmp } from './helpers.js';

const REGISTER = fileURLToPath(new URL('./procs/register.mjs', import.meta.url));

let data: string;
beforeEach(() => {
  data = isolate();
});

const registryFile = (): string => join(data, 'registry.json');
const dirs = async (): Promise<string[]> => (await listProjects()).projects.map((p) => p.dir);
const human = { actor: 'human' as const, now: NOW, author: 'Robin' };

describe('registry', () => {
  it('records a project once, as { dir, hidden } under its normalised key', async () => {
    const dir = project();
    expect(await registerProject(dir)).toBe(true);
    expect(await registerProject(dir)).toBe(false);
    expect(JSON.parse(readFileSync(registryFile(), 'utf8'))).toEqual({ version: 1, projects: { [projectKey(dir)]: { dir, hidden: false } } });
    const listed = (await listProjects()).projects;
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('refuses a folder with no BLIP.md', async () => {
    await expect(registerProject(tmp())).rejects.toMatchObject({ code: 'E_NO_PROJECT' });
  });

  it('8 concurrent first registrations are all present', async () => {
    const projects = Array.from({ length: 8 }, (_, i) => project(undefined, `project-${i}`));
    const ran = await Promise.all(projects.map((dir) => spawn(REGISTER, [dir])));
    expect(ran.map((r) => r.stderr).join('')).toBe('');
    expect((await dirs()).sort()).toEqual([...projects].sort());
  });

  it('a write to a project registers it; a write to a registered project leaves registry.json alone', async () => {
    const dir = project();
    const first = await updateProject(dir, [{ op: 'task.add', title: 'Check the sync flag' }], human);
    expect(first.registry).toBeNull();
    expect(await dirs()).toEqual([dir]);

    const old = new Date(Date.now() - 3_600_000);
    utimesSync(registryFile(), old, old);
    const before = statSync(registryFile()).mtimeMs;
    await syncProject(dir, parseSyncPayload({ add: ['Archive the old sketches'] }), { author: 'Robin', now: NOW });
    await syncProject(dir, parseSyncPayload({}), { author: 'Robin', now: NOW });
    expect(statSync(registryFile()).mtimeMs).toBe(before);
    expect(readdirSync(data).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('a corrupt registry.json is read from registry.json.prev, with a warning', async () => {
    const a = project(undefined, 'a');
    const b = project(undefined, 'b');
    await registerProject(a);
    await registerProject(b); // registry.json.prev now holds [a]
    writeFileSync(registryFile(), '{ "version": 1, "projects": { tru');
    const read = await listProjects();
    expect(read.projects.map((p) => p.dir)).toEqual([a]);
    expect(read.warning).toContain('previous copy');
    // Reading repairs nothing.
    expect(readFileSync(registryFile(), 'utf8')).toBe('{ "version": 1, "projects": { tru');

    // The next registration writes a good file again and does not copy the bad one over the last good copy.
    await registerProject(b);
    expect((await listProjects()).warning).toBeNull();
    expect((await dirs()).sort()).toEqual([a, b].sort());
    expect(Object.keys(JSON.parse(readFileSync(`${registryFile()}.prev`, 'utf8')).projects)).toEqual([projectKey(a)]);
  });

  it('when both copies are unreadable the bad file is set aside and the registry starts empty', async () => {
    const a = project(undefined, 'a');
    mkdirSync(data, { recursive: true });
    writeFileSync(registryFile(), 'not json');
    writeFileSync(`${registryFile()}.prev`, 'not json either');
    expect((await listProjects()).warning).toContain('track --find');
    await registerProject(a);
    expect(await dirs()).toEqual([a]);
    const aside = readdirSync(data).filter((f) => /^registry\.bad-\d{8}T\d{6}Z\.json$/.test(f));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(data, aside[0]!), 'utf8')).toBe('not json');
  });

  it('a registry that cannot be written does not fail the BLIP write, and the result says so', async () => {
    const other = project(undefined, 'other');
    await registerProject(other);
    // The copy to registry.json.prev cannot succeed while a folder sits at that path.
    mkdirSync(`${registryFile()}.prev`);
    const dir = project(undefined, 'mine');
    const res = await updateProject(dir, [{ op: 'task.add', title: 'Check the sync flag' }], human);
    expect(res.changed).toBe(true);
    expect(bytesOf(dir).toString()).toContain('- [ ] Check the sync flag');
    expect(res.registry).toMatch(/^registry: could not register this project \(.+\) — it will be retried on the next sync$/);
    expect(await dirs()).toEqual([other]);
  });

  it.runIf(process.platform === 'win32')('C:\\X, c:\\x and C:\\X\\ are one entry on Windows', async () => {
    const dir = project(undefined, 'Mixed Case');
    expect(await registerProject(dir)).toBe(true);
    expect(await registerProject(dir.toLowerCase())).toBe(false);
    expect(await registerProject(dir.toUpperCase())).toBe(false);
    expect(await registerProject(`${dir}\\`)).toBe(false);
    expect(await dirs()).toEqual([dir]);
  });

  it('its own crash leftovers are swept from the data folder, and it never names a temp file after BLIP.md', async () => {
    const a = project(undefined, 'a');
    await registerProject(a);
    const stale = join(data, '.registry.deadbeef.tmp');
    const foreign = join(data, '.BLIP.deadbeef.tmp');
    const old = new Date(Date.now() - 2 * 3_600_000);
    for (const file of [stale, foreign]) {
      writeFileSync(file, 'left by a crash');
      utimesSync(file, old, old);
    }
    await registerProject(project(undefined, 'b'));
    expect(readdirSync(data).filter((f) => f.endsWith('.tmp'))).toEqual(['.BLIP.deadbeef.tmp']);
  });

  it('hide survives writes; show clears it; remove deletes the entry and never the file', async () => {
    const dir = project();
    await registerProject(dir);
    expect(await setHidden(dir, true)).toBe(true);
    expect(await setHidden(dir, true)).toBe(false);
    await updateProject(dir, [{ op: 'task.add', title: 'Check the sync flag' }], human);
    expect((await listProjects()).projects[0]!.hidden).toBe(true);
    expect(await setHidden(dir, false)).toBe(true);
    expect(await unregisterProject(dir)).toBe(true);
    expect(await unregisterProject(dir)).toBe(false);
    expect(await dirs()).toEqual([]);
    expect(bytesOf(dir).length).toBeGreaterThan(0);
  });
});

describe('findProjects', () => {
  it('finds every BLIP.md in a tree 10 levels deep, nested projects included, and enters no skipped folder', async () => {
    const root = join(tmp(), 'workspace');
    const blip = (...parts: string[]): string => {
      const dir = join(root, ...parts);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'BLIP.md'), '---\nblip: 3\n---\n');
      return dir;
    };
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), '# workspace rules\n');
    const deep = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'];
    const expected = [
      blip('alpha'),
      blip('alpha', 'archive', 'inner'), // a project inside a project
      blip('group', 'beta'),
      blip(...deep),
    ];
    writeFileSync(join(root, 'alpha', 'AGENTS.md'), 'x');
    mkdirSync(join(root, 'group', 'beta', '.git'), { recursive: true });
    // None of these may be entered.
    const skipped = ['node_modules', 'dist', 'out', 'build', 'release', 'coverage', 'target', 'vendor', '.hidden'].map((name) => blip('alpha', name, 'pkg'));

    const found = await findProjects(root);
    expect(found.dirs.sort()).toEqual([...expected].sort());
    for (const dir of skipped) expect(found.dirs).not.toContain(dir);
    expect(found.capped).toBe(false);
    // root, alpha, archive, inner, group, beta and the ten levels: nothing under a skipped folder was read.
    expect(found.scanned).toBe(16);
  });

  it.runIf(process.platform === 'win32' || process.platform === 'darwin')('finds a file spelled blip.md where the filesystem ignores case, as every other command does', async () => {
    const root = tmp();
    mkdirSync(join(root, 'lower'));
    writeFileSync(join(root, 'lower', 'blip.md'), '---\nblip: 3\n---\n');
    expect(resolveProject(join(root, 'lower'))).toBe(join(root, 'lower'));
    expect((await findProjects(root)).dirs).toEqual([join(root, 'lower')]);
  });

  it('stops at depth 12', async () => {
    const root = join(tmp(), 'workspace');
    const levels = Array.from({ length: 13 }, (_, i) => `d${i + 1}`);
    mkdirSync(join(root, ...levels), { recursive: true });
    writeFileSync(join(root, ...levels.slice(0, 12), 'BLIP.md'), 'x');
    writeFileSync(join(root, ...levels, 'BLIP.md'), 'x');
    expect((await findProjects(root)).dirs).toEqual([join(root, ...levels.slice(0, 12))]);
  });
});
