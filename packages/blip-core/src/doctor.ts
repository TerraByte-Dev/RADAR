import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { findGitBinary, systemGit, type Git } from './git.js';
import { readProject } from './io.js';
import { blipPath, projectKey } from './paths.js';
import { listProjects } from './registry.js';
import { ANY_STAMP_RE, HOOK_EVENTS, SKILL_STAMP, claudeSkillPath, codexSkillPath, defaultTargets, hookEntries, hookProblems, radarHook, settingsPath, shimPath, type Targets } from './setup.js';

/** `radar-blip doctor` (spec 5.5): one line per check, ok / warn / fail. */

export type Level = 'ok' | 'warn' | 'fail';
export interface Check {
  id: string;
  level: Level;
  message: string;
}

export interface DoctorOptions {
  targets?: Targets;
  /** Where PATH is read from. */
  env?: NodeJS.ProcessEnv;
  git?: Git | null;
  /** The node version to judge (default: this process's). */
  nodeVersion?: string;
}

const NODE_MIN = [22, 12] as const;

const sameFile = (a: string, b: string): boolean => projectKey(a) === projectKey(b);

/** The first `radar-blip` command on PATH, as a shell would find it. Relative entries are skipped. */
function onPath(env: NodeJS.ProcessEnv): string | null {
  const names = process.platform === 'win32' ? ['radar-blip.cmd', 'radar-blip.exe'] : ['radar-blip'];
  for (const entry of (env.PATH ?? env.Path ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !isAbsolute(dir)) continue;
    for (const name of names) {
      try {
        if (statSync(join(dir, name)).isFile()) return join(dir, name);
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * The version of the radar-blip package a command on PATH runs, read from its manifest; never
 * by running it. An npm launcher on Windows sits beside `node_modules`; elsewhere the command
 * is a link into the package.
 */
function versionOf(command: string): string | null {
  const manifests = [join(dirname(command), 'node_modules', 'radar-blip', 'package.json')];
  try {
    for (let dir = dirname(realpathSync(command)); dir !== dirname(dir); dir = dirname(dir)) manifests.push(join(dir, 'package.json'));
  } catch {
    // a broken link
  }
  for (const m of manifests) {
    try {
      const pkg = JSON.parse(readFileSync(m, 'utf8')) as { name?: unknown; version?: unknown };
      if (pkg.name === 'radar-blip' && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // not this one
    }
  }
  return null;
}

function cliCheck(t: Targets, env: NodeJS.ProcessEnv): Check {
  const found = onPath(env);
  const shim = shimPath(t);
  const hasShim = existsSync(shim);
  if (found === null) return { id: 'cli', level: 'warn', message: hasShim ? `radar-blip is not on PATH; the hooks use ${shim}` : 'radar-blip is not on PATH' };
  if (hasShim && sameFile(found, shim)) return { id: 'cli', level: 'ok', message: `${found} (the app's shim)` };
  const version = versionOf(found);
  if (version !== null && Number(version.split('.')[0]) < 3) {
    return { id: 'cli', level: 'fail', message: `${found} is radar-blip ${version}, older than 3.0.0: remove it with "npm rm -g radar-blip"` };
  }
  if (hasShim) return { id: 'cli', level: 'warn', message: `PATH runs ${found}, not the app's ${shim}` };
  return { id: 'cli', level: version === null ? 'warn' : 'ok', message: version === null ? `${found} (its version cannot be read)` : `${found} (${version})` };
}

/** True for a node version (`v18.20.4` or `18.20.4`) older than the engine needs. */
export function nodeIsOld(version: string): boolean {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  return major < NODE_MIN[0] || (major === NODE_MIN[0] && minor < NODE_MIN[1]);
}

function nodeCheck(version: string): Check {
  const old = nodeIsOld(version);
  return { id: 'node', level: old ? 'fail' : 'ok', message: old ? `node ${version} is older than ${NODE_MIN.join('.')}` : `node ${version}` };
}

function skillCheck(id: string, path: string, appPresent: boolean, missingLevel: Level, app: string): Check {
  if (!appPresent) return { id, level: 'ok', message: `${app} is not installed here` };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { id, level: missingLevel, message: `the /blip skill is not installed (${path}): run radar-blip setup` };
  }
  if (text.includes(SKILL_STAMP)) return { id, level: 'ok', message: path };
  return { id, level: 'warn', message: `the /blip skill at ${path} is not the current one${ANY_STAMP_RE.test(text) ? '' : ' (it writes the old format)'}: run radar-blip setup` };
}

function hooksCheck(t: Targets): Check {
  if (!existsSync(t.claudeDir)) return { id: 'hooks', level: 'ok', message: 'Claude Code is not installed here' };
  let settings: unknown;
  try {
    settings = existsSync(settingsPath(t)) ? JSON.parse(readFileSync(settingsPath(t), 'utf8')) : {};
  } catch (err) {
    return { id: 'hooks', level: 'fail', message: `${settingsPath(t)} cannot be read (${err instanceof Error ? err.message : String(err)})` };
  }
  const problems = hookProblems(settings);
  if (!problems.length) return { id: 'hooks', level: 'ok', message: `${Object.keys(HOOK_EVENTS).join(', ')} installed` };
  const ours = new Set(hookEntries(settings).filter((h) => radarHook(h.command) !== null).map((h) => h.event));
  if (ours.has('Stop') && !ours.has('SessionStart') && !ours.has('SessionEnd')) problems.unshift('only the v2 Stop hook is installed');
  return { id: 'hooks', level: 'fail', message: `${problems.join('; ')}: run radar-blip setup` };
}

async function sizeOf(path: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const p = join(path, e.name);
    total += e.isDirectory() ? await sizeOf(p) : await stat(p).then((s) => s.size, () => 0);
  }
  return total;
}

/** The `.git` folder of the repository whose main checkout holds `dir`, when it is one. */
function gitDirOf(dir: string): string | null {
  for (let d = resolve(dir); ; d = dirname(d)) {
    try {
      if (statSync(join(d, '.git')).isDirectory()) return join(d, '.git');
    } catch {
      // keep walking
    }
    if (dirname(d) === d) return null;
  }
}

/** Every check, in the order of spec 5.5. Reads only. */
export async function runDoctor(opts: DoctorOptions = {}): Promise<Check[]> {
  const t = opts.targets ?? defaultTargets();
  const env = opts.env ?? process.env;
  const git = opts.git === undefined ? systemGit() : opts.git;
  const checks: Check[] = [
    cliCheck(t, env),
    nodeCheck(opts.nodeVersion ?? process.versions.node),
    git ? { id: 'git', level: 'ok', message: findGitBinary(env.PATH ?? env.Path ?? '') ?? 'found' } : { id: 'git', level: 'warn', message: 'git was not found: activity falls back to file times' },
    skillCheck('skill-claude', claudeSkillPath(t), existsSync(t.claudeDir), 'fail', 'Claude Code'),
    skillCheck('skill-codex', codexSkillPath(t), existsSync(t.codexDir), 'warn', 'Codex'),
    hooksCheck(t),
  ];

  const { projects, warning } = await listProjects();
  const missing = projects.filter((p) => !existsSync(blipPath(p.dir)));
  checks.push({
    id: 'registry',
    level: warning ? 'warn' : 'ok',
    message: `${warning ? `${warning}; ` : ''}${projects.length} tracked, ${projects.filter((p) => p.hidden).length} hidden, ${missing.length} missing`,
  });

  const v2: string[] = [];
  const broken: string[] = [];
  let lintErrors = 0;
  const worktreed: string[] = [];
  for (const p of projects) {
    if (missing.includes(p)) continue;
    try {
      const doc = (await readProject(p.dir)).file.doc();
      if (doc.schema === 2) v2.push(p.dir);
      if (doc.problems.some((x) => x.code === 'yaml-invalid')) broken.push(p.dir);
      lintErrors += doc.problems.filter((x) => x.severity === 'error').length;
    } catch {
      broken.push(p.dir);
      continue;
    }
    const gitDir = gitDirOf(p.dir);
    let linked = false;
    try {
      linked = gitDir !== null && readdirSync(join(gitDir, 'worktrees')).length > 0;
    } catch {
      // no linked worktrees
    }
    if (linked && git) {
      const tracked = await git.run(p.dir, ['ls-files', '--', 'BLIP.md'], 2000).then((o) => o.trim() !== '', () => false);
      if (tracked) worktreed.push(p.dir);
    }
  }
  const count = projects.length - missing.length;
  checks.push(
    broken.length
      ? { id: 'projects', level: 'fail', message: `cannot be read: ${broken.join(', ')}` }
      : v2.length
        ? { id: 'projects', level: 'warn', message: `${v2.length} in the v2 format (run radar-blip migrate): ${v2.join(', ')}` }
        : { id: 'projects', level: 'ok', message: `${count} readable, ${lintErrors} lint error${lintErrors === 1 ? '' : 's'}` },
  );
  checks.push(
    worktreed.length
      ? { id: 'worktrees', level: 'warn', message: `BLIP.md is tracked by git in a repository with linked worktrees, so each worktree's copy goes stale (add BLIP.md to .gitignore): ${worktreed.join(', ')}` }
      : { id: 'worktrees', level: 'ok', message: 'no tracked BLIP.md in a repository with linked worktrees' },
  );

  const data = t.dataDir;
  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`;
  checks.push({
    id: 'storage',
    level: 'ok',
    message: `backups ${join(data, 'backups')} ${mb(await sizeOf(join(data, 'backups')))}, trash ${join(data, 'trash')} ${mb(await sizeOf(join(data, 'trash')))} (backups hold full copies of BLIP.md files)`,
  });
  return checks;
}

/**
 * Why this machine is not ready for `migrate` to change files; empty when it is: the `cli`,
 * `skill-claude` and `hooks` checks. A v2 CLI, skill or hook left installed would go on
 * writing the v2 way into a migrated file, so for the skill an old stamp counts too.
 */
export function migratePreflight(): Check[] {
  const t = defaultTargets();
  const checks = [cliCheck(t, process.env), skillCheck('skill-claude', claudeSkillPath(t), existsSync(t.claudeDir), 'fail', 'Claude Code'), hooksCheck(t)];
  return checks.filter((c) => c.level === 'fail' || (c.id === 'skill-claude' && c.level === 'warn'));
}

