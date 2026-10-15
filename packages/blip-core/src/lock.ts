import { randomBytes } from 'node:crypto';
import { link, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BlipError } from './core/schema.js';

const RETRY_MS = 50;
const WAIT_MS = 5_000;
/** A write takes milliseconds: a lock this old was left behind by a process that died. */
const STALE_MS = 30_000;
/** What Windows answers while a just-deleted file is still going away. */
const TRANSIENT = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const codeOf = (err: unknown): string => (err as NodeJS.ErrnoException).code ?? '';

async function ageMs(file: string): Promise<number | null> {
  try {
    return Date.now() - (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Take a stale lock out of the way: rename it to a name only this process uses, then
 * delete it. One contender's rename succeeds; the others find nothing to rename and go
 * back to waiting. If the file that came away is fresh after all (its holder replaced the
 * stale one a moment ago), it is put back, never over a newer lock.
 */
async function clearStale(file: string): Promise<void> {
  const aside = `${file}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    await rename(file, aside);
  } catch {
    return;
  }
  const age = await ageMs(aside);
  if (age !== null && age <= STALE_MS) await link(aside, file).catch(() => {});
  await unlink(aside).catch(() => {});
}

/**
 * Run `fn` holding an exclusive lock file. The file is created with `wx`, so exactly one
 * process holds it; the others retry every 50 ms for up to 5 s and then fail with
 * `E_BUSY`. The lock is released whatever `fn` does.
 */
export async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(file), { recursive: true });
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      const fh = await open(file, 'wx');
      try {
        await fh.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      } finally {
        await fh.close();
      }
      break;
    } catch (err) {
      if (!TRANSIENT.has(codeOf(err))) throw err;
    }
    if (Date.now() >= deadline) {
      throw new BlipError('E_BUSY', 'another radar-blip process is writing here and has not finished', {
        hint: 'try again in a moment',
        path: file,
      });
    }
    const age = await ageMs(file);
    if (age !== null && age > STALE_MS) await clearStale(file);
    else await sleep(RETRY_MS);
  }
  try {
    return await fn();
  } finally {
    await unlink(file).catch(() => {});
  }
}
