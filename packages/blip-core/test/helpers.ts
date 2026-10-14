import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlip } from '../src/core/doc.js';
import { migrateFile } from '../src/core/normalize.js';
import { fixture } from './core/fixtures.js';

/** The built CLI. `npm test` builds before it runs the suites. */
export const CLI = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));

/** A fresh temp folder, with symlinks and 8.3 names resolved so paths compare equal. */
export function tmp(prefix = 'radar-blip-'): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * Point the engine at a fresh, empty data directory and a Claude config directory that
 * does not exist. Call it in `beforeEach`: no test ever sees the real ones.
 */
export function isolate(): string {
  const root = tmp('radar-blip-home-');
  process.env.RADAR_BLIP_HOME = join(root, 'data');
  process.env.CLAUDE_CONFIG_DIR = join(root, 'no-claude');
  process.env.CODEX_HOME = join(root, 'no-codex');
  return process.env.RADAR_BLIP_HOME;
}

/** A project folder holding the given BLIP.md text (default: the full v3 fixture). */
export function project(text: string = fixture('v3/full.md'), name = 'sample-project'): string {
  const dir = join(tmp(), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'BLIP.md'), text);
  return dir;
}

export const bytesOf = (dir: string): Buffer => readFileSync(join(dir, 'BLIP.md'));
export const textOf = (dir: string): string => readFileSync(join(dir, 'BLIP.md'), 'utf8');

/** The 83 KB fixture as a v3 file. */
export function bigV3(): string {
  return migrateFile(parseBlip(fixture('v2/big-83kb.md'), { dirName: 'big' })).text;
}

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

const PATH_SEP = process.platform === 'win32' ? ';' : ':';

/** PATH without any folder that holds a radar-blip command: no test may run, or be judged by, the machine's own CLI. */
export function cleanPath(path = process.env.PATH ?? process.env.Path ?? ''): string {
  return path
    .split(PATH_SEP)
    .filter((d) => !['radar-blip', 'radar-blip.cmd', 'radar-blip.exe'].some((n) => d && existsSync(join(d, n))))
    .join(PATH_SEP);
}

const env = (): NodeJS.ProcessEnv => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.toUpperCase() === 'PATH') e[k] = cleanPath(e[k]);
  return e;
};

/** Run the CLI and wait. Never throws on a non-zero exit. */
export function run(args: string[], opts: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv } = {}): Ran {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd: opts.cwd ?? tmpdir(), input: opts.input ?? '', encoding: 'utf8', env: opts.env ?? env(), stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Run a node script (or the CLI) without waiting: for tests that need several processes at once. */
export function spawn(script: string, args: string[], input?: string): Promise<Ran> {
  return new Promise((done) => {
    const child = execFile(process.execPath, [script, ...args], { env: env(), encoding: 'utf8' }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
    });
    child.stdin?.end(input ?? '');
  });
}

/** Run git in a folder, quietly, with an identity that does not depend on the machine; `when` sets the commit's dates. */
export function git(cwd: string, ...args: string[]): string {
  return gitAt(cwd, null, ...args);
}

export function gitAt(cwd: string, when: Date | null, ...args: string[]): string {
  const dates = when ? { GIT_AUTHOR_DATE: when.toISOString(), GIT_COMMITTER_DATE: when.toISOString() } : {};
  return execFileSync('git', ['-c', 'user.name=Robin', '-c', 'user.email=robin@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...dates },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
