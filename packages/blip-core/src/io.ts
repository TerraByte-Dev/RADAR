import { readFile, rename, unlink, open, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Blip } from './blip.js';

/** Read and parse a BLIP.md from disk. */
export async function readBlip(path: string): Promise<Blip> {
  const raw = await readFile(path, 'utf8');
  return Blip.parse(raw);
}

/** Transient Windows rename failures: antivirus, sync clients, or a watcher briefly holding the file. */
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
const MAX_RETRIES = 5;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Sibling temp files this old are crash orphans (an in-flight write lives milliseconds, not an hour). */
const TMP_RE = /^\.BLIP\.[0-9a-f]+\.tmp$/;
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Serialize and write atomically + durably: write to a sibling temp file, fsync it,
 * then rename into place. fs.rename is a same-volume atomic replace and the fsync
 * flushes the temp file to disk first, so neither a crash mid-write nor a power loss
 * right after the rename can leave a corrupt BLIP.md. The rename retries with backoff
 * (~15–240 ms) because on Windows the destination can be transiently locked by
 * scanners/watchers; on any failure — including a partial temp write (e.g. ENOSPC) —
 * the temp file is removed so a failed write never litters the repo. After a
 * successful write, stale `.BLIP.*.tmp` orphans from crashed runs are swept.
 */
export async function writeBlipAtomic(path: string, blip: Blip): Promise<void> {
  const data = blip.toString();
  const dir = dirname(path);
  const tmp = join(dir, `.BLIP.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fh = await open(tmp, 'w');
    try {
      await fh.writeFile(data, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, path);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? '';
        if (attempt >= MAX_RETRIES || !RETRYABLE.has(code)) throw err;
        await sleep(15 * 2 ** attempt);
      }
    }
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  await sweepStaleTmp(dir).catch(() => {}); // best-effort — never fails a completed write
}

/** Remove sibling `.BLIP.*.tmp` files old enough (>1 h) to be crash orphans, never an in-flight write. */
async function sweepStaleTmp(dir: string): Promise<void> {
  const cutoff = Date.now() - TMP_MAX_AGE_MS;
  for (const name of await readdir(dir)) {
    if (!TMP_RE.test(name)) continue;
    const p = join(dir, name);
    try {
      if ((await stat(p)).mtimeMs < cutoff) await unlink(p);
    } catch {
      // Raced with another process or the file is locked — leave it for next time.
    }
  }
}

/**
 * Optimistic-concurrency read–modify–write: read + parse, apply `mutate`, then re-read
 * immediately before the atomic write — if another writer (the app vs. an agent CLI)
 * changed the file since our read, the stale result is discarded and `mutate` is
 * replayed on the fresh content instead of clobbering the concurrent update. Gives up
 * loudly after 3 conflicting rounds rather than spinning forever.
 *
 * Also retires a legacy `next_action` key here — *after* `mutate`, so the caller's task
 * refs still mean what they meant when it read the file. Every writer therefore migrates
 * for free, and nobody ever hand-edits a BLIP.md to do it.
 */
export async function updateBlip(path: string, mutate: (blip: Blip) => void | Promise<void>): Promise<Blip> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await readFile(path, 'utf8');
    const blip = Blip.parse(before);
    await mutate(blip);
    blip.migrateNextAction();
    const onDisk = await readFile(path, 'utf8');
    if (onDisk !== before) continue; // lost the race — retry on the fresh bytes
    await writeBlipAtomic(path, blip);
    return blip;
  }
  throw new Error(`BLIP.md at ${path} kept changing mid-update — gave up after ${MAX_ATTEMPTS} attempts`);
}
