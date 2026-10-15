import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, relative, resolve } from 'node:path';

/** The one file RADAR keeps inside a project folder. */
export const BLIP_FILE = 'BLIP.md';

/**
 * The engine's data directory: registry, locks, state, trash, backups. Everything RADAR
 * writes outside a project's BLIP.md lives here. `RADAR_BLIP_HOME` overrides it (tests,
 * portable use).
 */
export function dataDir(): string {
  const override = process.env.RADAR_BLIP_HOME;
  if (override) return resolve(override);
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(process.env.USERPROFILE || homedir(), 'AppData', 'Roaming'), 'radar-blip');
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'radar-blip');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'radar-blip');
}

/** Path of a project's BLIP.md. */
export function blipPath(dir: string): string {
  return join(dir, BLIP_FILE);
}

/** Where file names are matched without regard to case: `blip.md` is the project file there, and `C:\X` is `c:\x`. */
export const IGNORES_CASE = process.platform === 'win32' || process.platform === 'darwin';

/** This machine's own drive, spelled as an administrative share: `\\localhost\C$\…`. */
const LOCAL_SHARE_RE = /^\\\\(?:localhost|127\.0\.0\.1)\\([a-z])\$(?=\\|$)/i;

/**
 * The registry key of a directory: resolved, symlinks followed when the directory exists,
 * no trailing separator, lower-cased where the filesystem ignores case. `C:\X`, `c:\x` and
 * `C:\X\` are one project, and so is `\\localhost\C$\X`: left as it is, that spelling would
 * be a second project with a lock of its own.
 */
export function projectKey(dir: string): string {
  let p = resolve(dir);
  if (process.platform === 'win32') p = resolve(p.replace(LOCAL_SHARE_RE, '$1:'));
  try {
    p = realpathSync.native(p);
  } catch {
    // not there (an unplugged drive, a removed folder): the resolved path is the key
  }
  const root = parse(p).root;
  while (p.length > root.length && /[\\/]$/.test(p)) p = p.slice(0, -1);
  return IGNORES_CASE ? p.toLowerCase() : p;
}

/** The handle for a project's files under the data directory and for IPC. Computed, never stored. */
export function projectId(dir: string): string {
  return idOfKey(projectKey(dir));
}

export function idOfKey(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 12);
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `start` and each of its parents, nearest first. */
function* ancestors(start: string): Generator<string> {
  let dir = resolve(start);
  for (;;) {
    yield dir;
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * When `start` is inside a linked git worktree, the same path inside the main checkout;
 * otherwise null. Read from the filesystem alone: a linked worktree's `.git` is a file
 * whose `gitdir:` target holds a `commondir` file (a submodule's does not), and the main
 * checkout is the parent of a common directory named `.git` (a bare repository has none).
 */
export function mainCheckoutPath(start: string): string | null {
  const from = resolve(start);
  for (const dir of ancestors(from)) {
    const dotGit = join(dir, '.git');
    let st;
    try {
      st = statSync(dotGit);
    } catch {
      continue;
    }
    if (!st.isFile()) return null;
    try {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
      if (!m) return null;
      const gitDir = resolve(dir, m[1]!);
      const common = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
      if (basename(common) !== '.git') return null;
      return join(dirname(common), relative(dir, from));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The project a path belongs to: the nearest folder, walking up, that holds a BLIP.md. A
 * path inside a linked worktree is mapped to the main checkout first, whose BLIP.md is the
 * canonical one; the worktree's own copy is never used. Null when there is no project.
 * Pure filesystem: no git process is started.
 */
export function resolveProject(start: string): string | null {
  for (const dir of ancestors(mainCheckoutPath(start) ?? start)) {
    if (isFile(blipPath(dir))) return dir;
  }
  return null;
}
