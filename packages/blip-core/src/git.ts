import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { dataDir } from './paths.js';

/**
 * The one way the engine runs git. A project folder is untrusted: it may be a cloned or
 * unpacked repository whose `.git/config` names programs to run, or hold a `git.cmd` of
 * its own. So:
 *
 * - the binary is an absolute path found on PATH, never looked up in a project;
 * - the child's working directory is the engine's data folder (the system temp folder until
 *   that exists, so a dry run creates nothing), never the project;
 * - no shell, and every dynamic value is its own argv element;
 * - every repo-local setting that runs a program is overridden on the command line
 *   (fsmonitor, pager, signature checking, hooks), and the caller adds the clean/smudge
 *   filters by name before `status` (see {@link filterOverrides});
 * - every `GIT_*` variable is dropped from the environment, so nothing inherited can point
 *   git at another repository, config or program.
 */

/** Options the runner passes to {@link execGit}; a test can wrap the real one to watch every call. */
export interface ExecOptions {
  cwd: string;
  timeout: number;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
  windowsHide: true;
}

export type Exec = (file: string, args: readonly string[], opts: ExecOptions) => Promise<string>;

/** A git call that did not succeed: a non-zero exit, a timeout, or output over the limit. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly timedOut: boolean,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export interface Git {
  /** Run `git -C dir <neutralising flags> ...args`. Resolves stdout; rejects with {@link GitError}. */
  run(dir: string, args: readonly string[], timeoutMs: number): Promise<string>;
}

const MAX_BUFFER = 1024 * 1024;

/** The fixed part of every invocation, in front of the caller's arguments. */
export function gitArgv(dir: string, args: readonly string[]): string[] {
  return ['-C', dir, '-c', 'core.fsmonitor=', '-c', 'core.pager=cat', '-c', 'log.showSignature=false', '-c', 'core.hooksPath=', '-c', 'core.quotePath=false', '--no-pager', '--no-optional-locks', ...args];
}

/** The parent's environment without any `GIT_*` variable, plus the ones that keep git quiet, lock-free and in English. */
export function gitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!/^GIT_/i.test(k)) out[k] = v;
  out.GIT_TERMINAL_PROMPT = '0';
  out.GIT_OPTIONAL_LOCKS = '0';
  out.LC_ALL = 'C'; // messages in English, so "not a git repository" can be told from a failure
  return out;
}

/**
 * End `child` and every process it started. Killing git alone leaves its children running:
 * on Windows `Git\cmd\git.exe` is a launcher whose real git outlives it. So Windows ends the
 * tree with taskkill (by absolute path), and elsewhere the child leads its own process group.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/**
 * Run `file` and resolve its stdout: what {@link makeGit} uses unless a test passes its own.
 * `spawn`, not `execFile`, which kills only the child on a timeout and cannot make it a
 * process-group leader. Past the timeout or the output limit the whole tree is ended and the
 * call rejects with `timedOut` set. Nothing is ever written to git's stdin.
 */
export const execGit: Exec = (file, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let ended: string | null = null;
    const end = (why: string): void => {
      if (ended !== null) return;
      ended = why;
      killTree(child);
    };
    const timer = setTimeout(() => end('git timed out'), opts.timeout);
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      bytes += Buffer.byteLength(d);
      if (bytes > opts.maxBuffer) end('git output over the limit');
      else stdout += d;
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      if (stderr.length < opts.maxBuffer) stderr += d;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new GitError(err.message, null, false, stderr));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (ended === null && code === 0) return resolve(stdout);
      const first = stderr.split(/\r?\n/).find((l) => l.trim()) ?? `git exited with ${code}`;
      reject(new GitError(ended ?? first.trim(), code, ended !== null, stderr));
    });
  });

/** A runner for the git binary at `bin`. */
export function makeGit(bin: string, exec: Exec = execGit): Git {
  return {
    run(dir, args, timeoutMs) {
      const data = dataDir();
      const cwd = existsSync(data) ? data : tmpdir();
      return exec(bin, gitArgv(dir, args), { cwd, timeout: timeoutMs, env: gitEnv(), maxBuffer: MAX_BUFFER, windowsHide: true });
    },
  };
}

/**
 * The git binary on PATH: the first absolute PATH entry holding `git.exe` (Windows) or
 * `git`. Relative entries, `.` among them, are skipped, and the current folder is never
 * consulted. Null when there is none.
 */
export function findGitBinary(path = process.env.PATH ?? process.env.Path ?? ''): string | null {
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const entry of path.split(sep)) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

let cached: Git | null | undefined;

/** The system git, resolved once per process. Null when git is not installed. */
export function systemGit(): Git | null {
  if (cached === undefined) {
    const bin = findGitBinary();
    cached = bin ? makeGit(bin) : null;
  }
  return cached;
}

/**
 * `-c` overrides that switch off every clean/smudge filter configured for the repository
 * at `dir`, by name. `status` runs a file's clean filter when it re-reads a changed file,
 * and a filter is a program named in config, so an unpacked repository could otherwise
 * run anything. Null when the filters cannot be listed, or a name cannot be passed safely:
 * the caller then skips `status`.
 */
export async function filterOverrides(git: Git, dir: string, timeoutMs = 2000): Promise<string[] | null> {
  let out: string;
  try {
    out = await git.run(dir, ['config', '--name-only', '--get-regexp', '^filter\\.'], timeoutMs);
  } catch (err) {
    if (err instanceof GitError && err.exitCode === 1 && !err.timedOut) return []; // no filters at all
    return null;
  }
  const names = new Set<string>();
  for (const key of out.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const name = key.slice('filter.'.length, key.lastIndexOf('.'));
    if (!name || /[=\s]/.test(name)) return null;
    names.add(name);
  }
  return [...names].flatMap((n) => ['-c', `filter.${n}.clean=`, '-c', `filter.${n}.smudge=`, '-c', `filter.${n}.process=`, '-c', `filter.${n}.required=false`]);
}

/** `git config user.name` as seen from `dir` (or the user's global config when `dir` is null). Null when unset or git fails. */
export async function gitUserName(git: Git | null, dir: string | null): Promise<string | null> {
  if (!git) return null;
  try {
    const name = (await git.run(dir ?? dataDir(), dir ? ['config', 'user.name'] : ['config', '--global', 'user.name'], 2000)).trim();
    return name || null;
  } catch {
    return null;
  }
}
