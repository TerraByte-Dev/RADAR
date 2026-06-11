import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
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

/**
 * Serialize and write atomically: write to a sibling temp file, then rename into place.
 * fs.rename is a same-volume atomic replace, so a crash mid-write never corrupts BLIP.md.
 * The rename retries with backoff (~15–240 ms) because on Windows the destination can be
 * transiently locked by scanners/watchers; on final failure the temp file is removed so a
 * failed write never litters the repo.
 */
export async function writeBlipAtomic(path: string, blip: Blip): Promise<void> {
  const data = blip.toString();
  const tmp = join(dirname(path), `.BLIP.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, data, 'utf8');
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, path);
        return;
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
}
