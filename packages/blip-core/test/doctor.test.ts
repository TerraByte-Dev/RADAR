import { describe, it, expect, beforeEach } from 'vitest';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor, type Check } from '../src/doctor.js';
import { registerProject } from '../src/registry.js';
import { applySetup, planSetup, shimPath, SKILL_STAMP, type Targets } from '../src/setup.js';
import { fixture } from './core/fixtures.js';
import { cleanPath, git, isolate, project, run, tmp } from './helpers.js';

let data: string;
beforeEach(() => {
  data = isolate();
});

const SKILLS = fileURLToPath(new URL('../skills/', import.meta.url));
const IDS = ['cli', 'node', 'git', 'skill-claude', 'skill-codex', 'hooks', 'registry', 'projects', 'worktrees', 'storage'];

function targets(opts: { claude?: boolean; codex?: boolean } = {}): Targets {
  const root = tmp('radar-doctor-');
  const t = { claudeDir: join(root, '.claude'), codexDir: join(root, '.codex'), dataDir: data, skillsDir: SKILLS };
  if (opts.claude !== false) mkdirSync(t.claudeDir, { recursive: true });
  if (opts.codex) mkdirSync(t.codexDir, { recursive: true });
  return t;
}
async function setUp(t: Targets): Promise<Targets> {
  await applySetup(await planSetup(t));
  return t;
}

/** A folder holding a `radar-blip` command the way npm installs one, from a package of the given version. */
function cliOnPath(version: string): string {
  const dir = tmp('radar-npm-');
  const bin = join(dir, process.platform === 'win32' ? 'radar-blip.cmd' : 'radar-blip');
  writeFileSync(bin, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
  mkdirSync(join(dir, 'node_modules', 'radar-blip'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'radar-blip', 'package.json'), JSON.stringify({ name: 'radar-blip', version }));
  return dir;
}
const SEP = process.platform === 'win32' ? ';' : ':';
const withPath = (dir: string): NodeJS.ProcessEnv => ({ PATH: `${dir}${SEP}${cleanPath()}` });

const check = (checks: Check[], id: string): Check => checks.find((c) => c.id === id)!;

describe('doctor', () => {
  it('reports every check, in order, all fine on a set-up machine', async () => {
    const t = await setUp(targets({ codex: true }));
    const checks = await runDoctor({ targets: t, env: withPath(cliOnPath('3.0.0')), nodeVersion: '22.12.0' });
    expect(checks.map((c) => c.id)).toEqual(IDS);
    expect(checks.filter((c) => c.level !== 'ok')).toEqual([]);
  });

  it('cli: a v2 radar-blip on PATH fails with its path and the command that removes it', async () => {
    const dir = cliOnPath('2.0.1');
    const c = check(await runDoctor({ targets: await setUp(targets()), env: withPath(dir) }), 'cli');
    expect(c.level).toBe('fail');
    expect(c.message).toContain(dir);
    expect(c.message).toContain('npm rm -g radar-blip');
  });

  it('cli: PATH running something else while the shim exists warns with both paths; the shim itself is fine; nothing on PATH warns', async () => {
    const t = await setUp(targets());
    mkdirSync(join(t.dataDir, 'bin'), { recursive: true });
    writeFileSync(shimPath(t), 'shim');
    const other = cliOnPath('3.0.1');
    const c = check(await runDoctor({ targets: t, env: withPath(other) }), 'cli');
    expect(c).toMatchObject({ level: 'warn' });
    expect(c.message).toContain(other);
    expect(c.message).toContain(shimPath(t));
    expect(check(await runDoctor({ targets: t, env: withPath(join(t.dataDir, 'bin')) }), 'cli').level).toBe('ok');
    expect(check(await runDoctor({ targets: t, env: { PATH: cleanPath() } }), 'cli').level).toBe('warn');
  });

  it('node: older than 22.12 fails', async () => {
    const t = targets({ claude: false });
    expect(check(await runDoctor({ targets: t, nodeVersion: '22.11.0' }), 'node').level).toBe('fail');
    expect(check(await runDoctor({ targets: t, nodeVersion: 'v24.1.0' }), 'node').level).toBe('ok');
  });

  it('git: missing warns', async () => {
    expect(check(await runDoctor({ targets: targets({ claude: false }), git: null }), 'git').level).toBe('warn');
  });

  it('skills: missing Claude skill fails, an old stamp warns, a missing Codex prompt warns, no Codex is fine', async () => {
    const t = targets({ codex: true });
    let checks = await runDoctor({ targets: t });
    expect(check(checks, 'skill-claude').level).toBe('fail');
    expect(check(checks, 'skill-codex').level).toBe('warn');
    await setUp(t);
    writeFileSync(join(t.claudeDir, 'skills', 'blip', 'SKILL.md'), '<!-- radar-blip-skill v0 -->\nold');
    checks = await runDoctor({ targets: t });
    expect(check(checks, 'skill-claude')).toMatchObject({ level: 'warn', message: expect.stringContaining('run radar-blip setup') });
    expect(check(await runDoctor({ targets: targets({ claude: false }) }), 'skill-claude').level).toBe('ok');
    expect(check(await runDoctor({ targets: targets() }), 'skill-codex').level).toBe('ok');
  });

  it.each([
    ['settings.json unreadable', '{ nope', /cannot be read/],
    ['an entry missing', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'radar-blip hook stop' }] }], SessionEnd: [{ hooks: [{ type: 'command', command: 'radar-blip hook session-end' }] }] } }), /0 "radar-blip hook session-start" entries under SessionStart/],
    ['an entry duplicated', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'radar-blip hook session-start' }] }], Stop: [{ hooks: [{ type: 'command', command: 'radar-blip hook stop' }, { type: 'command', command: '"C:/x/radar-blip.cmd" hook stop' }] }], SessionEnd: [{ hooks: [{ type: 'command', command: 'radar-blip hook session-end' }] }] } }), /2 "radar-blip hook stop" entries under Stop/],
    ['only the v2 entry', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'radar-blip hook stop', timeout: 15 }] }] } }), /only the v2 Stop hook is installed/],
  ])('hooks: %s fails', async (_name, settings, message) => {
    const t = await setUp(targets());
    writeFileSync(join(t.claudeDir, 'settings.json'), settings);
    expect(check(await runDoctor({ targets: t }), 'hooks')).toMatchObject({ level: 'fail', message: expect.stringMatching(message) });
  });

  it('registry: counts, and a registry recovered from its previous copy warns', async () => {
    const a = project(undefined, 'a');
    await registerProject(a);
    await registerProject(project(undefined, 'b'));
    copyFileSync(join(data, 'registry.json'), join(data, 'registry.json.prev'));
    writeFileSync(join(data, 'registry.json'), '{ broken');
    const c = check(await runDoctor({ targets: targets({ claude: false }) }), 'registry');
    expect(c.level).toBe('warn');
    expect(c.message).toMatch(/2 tracked, 0 hidden, 0 missing/);
  });

  it('projects: a v2 file warns; broken YAML fails', async () => {
    await registerProject(project(fixture('v2/legacy-enums.md'), 'old'));
    const t = targets({ claude: false });
    expect(check(await runDoctor({ targets: t }), 'projects')).toMatchObject({ level: 'warn', message: expect.stringContaining('radar-blip migrate') });
    await registerProject(project('---\nblip: 3\nname: [broken\n---\n\n# Tasks\n', 'broken'));
    expect(check(await runDoctor({ targets: t }), 'projects').level).toBe('fail');
  });

  it('worktrees: a tracked BLIP.md in a repo with a linked worktree warns; gitignored does not', async () => {
    const base = tmp('radar-doctor-wt-');
    const main = join(base, 'main');
    mkdirSync(main);
    git(main, 'init', '-q');
    writeFileSync(join(main, 'BLIP.md'), '---\nblip: 3\nname: Worktree Test\n---\n\n# Tasks\n\n# Session log\n');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'start');
    await registerProject(main);
    const t = targets({ claude: false });
    expect(check(await runDoctor({ targets: t }), 'worktrees').level).toBe('ok');
    git(main, 'worktree', 'add', '-q', '-b', 'feat', join(base, 'wt'));
    const c = check(await runDoctor({ targets: t }), 'worktrees');
    expect(c.level).toBe('warn');
    expect(c.message).toContain(main);
    expect(c.message).toContain('.gitignore');
  });

  it('storage: names the backup and trash folders', async () => {
    const c = check(await runDoctor({ targets: targets({ claude: false }) }), 'storage');
    expect(c.message).toContain(join(data, 'backups'));
    expect(c.message).toContain(join(data, 'trash'));
  });

  it('the command: --json lists each check id; a failure exits 4', () => {
    const root = tmp('radar-doctor-cli-');
    const claude = join(root, '.claude');
    mkdirSync(claude);
    const env = { ...process.env, PATH: cleanPath(), CLAUDE_CONFIG_DIR: claude };
    const r = run(['doctor', '--json'], { env });
    expect(r.code).toBe(4);
    const out = JSON.parse(r.stdout) as { ok: boolean; data: { checks: Check[] } };
    expect(out.data.checks.map((c) => c.id)).toEqual(IDS);
    expect(out.data.checks.find((c) => c.id === 'skill-claude')!.level).toBe('fail');
    expect(run(['doctor'], { env }).stdout).toMatch(/^fail {2}hooks {9}/m);
    expect(SKILL_STAMP).toMatch(/v\d+/);
  });
});
