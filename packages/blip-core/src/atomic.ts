import { randomBytes } from 'node:crypto';
import { open, readdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';

/** Transient Windows rename failures: antivirus, sync clients, or a watcher briefly holding the file. */
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
const MAX_RETRIES = 5;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Sibling temp files this old are crash orphans (an in-flight write lives milliseconds, not an hour). */
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

/** A temp file is named after the file it is for: `.BLIP.<hex>.tmp` beside BLIP.md, `.registry.<hex>.tmp` beside registry.json. */
const tmpPrefix = (path: string): string => `.${parse(path).name}.`;

/**
 * Write atomically and durably: write to a sibling temp file, fsync it, then rename into
 * place. fs.rename is a same-volume atomic replace and the fsync flushes the temp file to
 * disk first, so neither a crash mid-write nor a power loss right after the rename can
 * leave a corrupt BLIP.md. The rename retries with backoff (~15–240 ms) because on Windows
 * the destination can be transiently locked by scanners/watchers; on any failure —
 * including a partial temp write (e.g. ENOSPC) — the temp file is removed so a failed
 * write never litters the repo. After a successful write, this file's stale temp orphans
 * from crashed runs are swept. Carried over from the v2 engine.
 */
export async function writeAtomic(path: string, data: string | Buffer): Promise<void> {
  const dir = dirname(path);
  const prefix = tmpPrefix(path);
  const tmp = join(dir, `${prefix}${randomBytes(6).toString('hex')}.tmp`);
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
  await sweepStaleTmp(dir, prefix).catch(() => {}); // best-effort — never fails a completed write
}

/** Remove this file's sibling temp files old enough (>1 h) to be crash orphans, never an in-flight write. */
async function sweepStaleTmp(dir: string, prefix: string): Promise<void> {
  const cutoff = Date.now() - TMP_MAX_AGE_MS;
  for (const name of await readdir(dir)) {
    if (!name.startsWith(prefix) || !/^[0-9a-f]+\.tmp$/.test(name.slice(prefix.length))) continue;
    const p = join(dir, name);
    try {
      if ((await stat(p)).mtimeMs < cutoff) await unlink(p);
    } catch {
      // Raced with another process or the file is locked — leave it for next time.
    }
  }
}
