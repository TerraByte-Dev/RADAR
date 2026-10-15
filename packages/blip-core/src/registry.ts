import { copyFile, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeAtomic } from './atomic.js';
import { BlipError } from './core/schema.js';
import { withLock } from './lock.js';
import { BLIP_FILE, IGNORES_CASE, blipPath, dataDir, idOfKey, mainCheckoutPath, projectKey } from './paths.js';

/** One tracked project. `hidden` is the only thing the registry knows that the file does not. */
export interface RegisteredProject {
  /** `sha1(key).slice(0, 12)`: the handle for the project's files under the data directory. */
  id: string;
  /** The normalised directory. */
  key: string;
  /** The directory in the casing it was first seen in. */
  dir: string;
  hidden: boolean;
}

interface RegistryFile {
  version: 1;
  projects: Record<string, { dir: string; hidden: boolean }>;
}

const registryPath = (): string => join(dataDir(), 'registry.json');
const prevPath = (): string => `${registryPath()}.prev`;
const empty = (): RegistryFile => ({ version: 1, projects: {} });

/** The file's contents: `null` when it is not there, `'bad'` when it cannot be used. */
async function load(path: string): Promise<RegistryFile | null | 'bad'> {
  let text = '';
  for (let attempt = 0; ; attempt++) {
    try {
      text = await readFile(path, 'utf8');
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (code === 'ENOENT') return null;
      // On Windows a read can collide with another process replacing the file: look again before calling it bad.
      if (attempt >= 3 || !['EPERM', 'EACCES', 'EBUSY'].includes(code)) return 'bad';
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  try {
    const json: unknown = JSON.parse(text);
    const projects = (json as { projects?: unknown } | null)?.projects;
    if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return 'bad';
    const out = empty();
    for (const [key, value] of Object.entries(projects as Record<string, unknown>)) {
      const dir = (value as { dir?: unknown } | null)?.dir;
      if (typeof dir === 'string') out.projects[key] = { dir, hidden: (value as { hidden?: unknown }).hidden === true };
    }
    return out;
  } catch {
    return 'bad';
  }
}

/** The registry as it stands, falling back to the previous good copy. Reads only: nothing is repaired here. */
async function read(): Promise<{ file: RegistryFile; state: 'ok' | 'recovered' | 'lost' }> {
  const current = await load(registryPath());
  if (current === null) return { file: empty(), state: 'ok' };
  if (current !== 'bad') return { file: current, state: 'ok' };
  const prev = await load(prevPath());
  return prev && prev !== 'bad' ? { file: prev, state: 'recovered' } : { file: empty(), state: 'lost' };
}

const stamp = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Read, change and write the registry under its lock. `change` returns false when there is nothing to write. */
async function mutate(change: (file: RegistryFile) => boolean): Promise<boolean> {
  await mkdir(dataDir(), { recursive: true });
  return withLock(join(dataDir(), 'locks', 'registry.lock'), async () => {
    const { file, state } = await read();
    if (!change(file)) return false;
    const path = registryPath();
    // Keep the last good copy; a file that cannot be read is set aside, never copied over it.
    if (state === 'ok') {
      if (existsSync(path)) await copyFile(path, prevPath());
    } else if (state === 'lost') {
      await rename(path, join(dataDir(), `registry.bad-${stamp()}.json`));
    }
    await writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
    return true;
  });
}

/**
 * Every registered project, in the order they were added. `warning` is set when
 * `registry.json` could not be read and the previous copy (or nothing) was used instead.
 */
export async function listProjects(): Promise<{ projects: RegisteredProject[]; warning: string | null }> {
  const { file, state } = await read();
  const projects = Object.entries(file.projects).map(([key, p]) => ({ id: idOfKey(key), key, dir: p.dir, hidden: p.hidden }));
  const warning =
    state === 'recovered'
      ? 'registry.json could not be read; the previous copy was used'
      : state === 'lost'
        ? `registry.json ${existsSync(prevPath()) ? 'and its previous copy could not be read' : 'could not be read and there is no previous copy'} (the unreadable file is ${registryPath()}; the next change sets it aside as registry.bad-<time>.json beside it); run "radar-blip track --find DIR" to list your projects again`
        : null;
  return { projects, warning };
}

/**
 * Add a project to the registry. False when it is already listed: that check takes no
 * lock and writes nothing, so an ordinary sync never touches `registry.json`. A directory
 * inside a linked git worktree is refused; the main checkout is the project.
 */
export async function registerProject(dir: string): Promise<boolean> {
  const full = resolve(dir);
  const key = projectKey(full);
  if (key in (await read()).file.projects) return false;
  const main = mainCheckoutPath(full);
  if (main !== null && projectKey(main) !== key) {
    throw new BlipError('E_WORKTREE', 'this folder is a linked git worktree; the main checkout is the project', { hint: `the project is ${main}`, path: full });
  }
  if (!existsSync(blipPath(full))) throw new BlipError('E_NO_PROJECT', `there is no ${BLIP_FILE} in ${full}`, { path: full });
  return mutate((file) => {
    if (key in file.projects) return false;
    file.projects[key] = { dir: full, hidden: false };
    return true;
  });
}

/**
 * Register after a write, without ever failing it. Returns the line to show when the
 * registry could not be written, or null.
 */
export async function ensureRegistered(dir: string): Promise<string | null> {
  try {
    await registerProject(dir);
    return null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return `registry: could not register this project (${reason}) — it will be retried on the next sync`;
  }
}

/** Hide a project from the board, or show it again. False when it is not registered or already so. */
export async function setHidden(dir: string, hidden: boolean): Promise<boolean> {
  const key = projectKey(dir);
  return mutate((file) => {
    const entry = file.projects[key];
    if (!entry || entry.hidden === hidden) return false;
    entry.hidden = hidden;
    return true;
  });
}

/** Take a project out of the registry. Its BLIP.md is never touched. False when it was not listed. */
export async function unregisterProject(dir: string): Promise<boolean> {
  const key = projectKey(dir);
  return mutate((file) => {
    if (!(key in file.projects)) return false;
    delete file.projects[key];
    return true;
  });
}

const FIND_DEPTH = 12;
const FIND_MAX_DIRS = 20_000;
/** Folders no scan enters (with every dot-folder): `track --find` and the activity walk of a folder without git. */
export const FIND_SKIP: ReadonlySet<string> = new Set(['node_modules', 'dist', 'out', 'build', 'release', 'coverage', 'target', 'vendor']);

/**
 * The one scan there is, explicit and one-shot: every folder under `root` that holds a
 * BLIP.md. It does not stop at a project, so nested projects are found. Dot-folders and
 * build folders are never entered. `capped` is true when it gave up at 20,000 folders.
 */
export async function findProjects(root: string): Promise<{ dirs: string[]; scanned: number; capped: boolean }> {
  const dirs: string[] = [];
  let scanned = 0;
  let capped = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (scanned >= FIND_MAX_DIRS) {
      capped = true;
      return;
    }
    scanned++;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // The same file every other command would use here: on a filesystem that ignores case, `blip.md` too.
    const isBlip = (name: string): boolean => (IGNORES_CASE ? name.toLowerCase() === BLIP_FILE.toLowerCase() : name === BLIP_FILE);
    if (entries.some((e) => e.isFile() && isBlip(e.name))) dirs.push(dir);
    if (depth >= FIND_DEPTH) return;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !FIND_SKIP.has(e.name)) await walk(join(dir, e.name), depth + 1);
    }
  };
  await walk(resolve(root), 0);
  return { dirs, scanned, capped };
}
