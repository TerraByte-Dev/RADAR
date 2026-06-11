import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Intercept fs renames (transitively, inside dist/io.js) to simulate the transient
// EPERM/EBUSY failures Windows produces when antivirus / sync clients / file watchers
// briefly hold the destination during an atomic replace.
const renameControl: { failures: number; code: string } = { failures: 0, code: 'EPERM' };
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    rename: async (from: string, to: string): Promise<void> => {
      if (renameControl.failures > 0) {
        renameControl.failures--;
        const err = new Error(`${renameControl.code}: simulated lock`) as NodeJS.ErrnoException;
        err.code = renameControl.code;
        throw err;
      }
      return real.rename(from, to);
    },
  };
});

const { createBlip, readBlip, writeBlipAtomic } = await import('../dist/index.js');

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'blip-io-'));
}

describe('writeBlipAtomic — transient-failure durability', () => {
  beforeEach(() => {
    renameControl.failures = 0;
    renameControl.code = 'EPERM';
  });

  it('writes through transient EPERM renames (the Windows AV/watcher case)', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    renameControl.failures = 3;

    await writeBlipAtomic(path, createBlip({ name: 'Retry' }));

    const blip = await readBlip(path);
    expect(blip.toReadModel().name).toBe('Retry');
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]); // no litter
  });

  it('gives up after persistent failures, removes the temp file, and leaves the original intact', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    writeFileSync(path, '---\nname: Original\n---\n', 'utf8');
    renameControl.failures = Number.MAX_SAFE_INTEGER;

    await expect(writeBlipAtomic(path, createBlip({ name: 'Doomed' }))).rejects.toThrow(/EPERM/);

    expect(readFileSync(path, 'utf8')).toContain('Original'); // destination untouched
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]); // tmp cleaned up
  });

  it('does not retry non-transient errors (e.g. ENOENT bubbles immediately)', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    renameControl.failures = 1;
    renameControl.code = 'ENOENT';

    const started = Date.now();
    await expect(writeBlipAtomic(path, createBlip({ name: 'X' }))).rejects.toThrow(/ENOENT/);
    expect(Date.now() - started).toBeLessThan(1000); // no backoff ladder for hard errors
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
