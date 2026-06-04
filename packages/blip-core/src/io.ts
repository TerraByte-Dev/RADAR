import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Blip } from './blip.js';

/** Read and parse a BLIP.md from disk. */
export async function readBlip(path: string): Promise<Blip> {
  const raw = await readFile(path, 'utf8');
  return Blip.parse(raw);
}

/**
 * Serialize and write atomically: write to a sibling temp file, then rename into place.
 * fs.rename is a same-volume atomic replace, so a crash mid-write never corrupts BLIP.md.
 */
export async function writeBlipAtomic(path: string, blip: Blip): Promise<void> {
  const data = blip.toString();
  const tmp = join(dirname(path), `.BLIP.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}
