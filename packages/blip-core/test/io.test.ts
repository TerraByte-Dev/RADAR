import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Intercept fs calls (transitively, inside dist/io.js) to simulate the transient
// EPERM/EBUSY failures Windows produces when antivirus / sync clients / file watchers
// briefly hold the destination during an atomic replace, and an ENOSPC mid-write that
// leaves a partial temp file behind.
const renameControl: { failures: number; code: string } = { failures: 0, code: 'EPERM' };
const writeControl: { failPartial: boolean } = { failPartial: false };
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
    open: async (...args: Parameters<typeof real.open>) => {
      const fh = await real.open(...args);
      if (!writeControl.failPartial) return fh;
      writeControl.failPartial = false;
      // A handle whose writeFile lands some bytes, then fails — the ENOSPC shape.
      return {
        writeFile: async (): Promise<void> => {
          await fh.writeFile('partial ', 'utf8');
          const err = new Error('ENOSPC: simulated full disk') as NodeJS.ErrnoException;
          err.code = 'ENOSPC';
          throw err;
        },
        sync: () => fh.sync(),
        close: () => fh.close(),
      } as unknown as Awaited<ReturnType<typeof real.open>>;
    },
  };
});

const { createBlip, readBlip, writeBlipAtomic, updateBlip, Blip } = await import('../dist/index.js');

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'blip-io-'));
}

describe('writeBlipAtomic — transient-failure durability', () => {
  beforeEach(() => {
    renameControl.failures = 0;
    renameControl.code = 'EPERM';
    writeControl.failPartial = false;
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

  it('removes a partially-written temp file when the write itself fails (ENOSPC)', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    writeFileSync(path, '---\nname: Original\n---\n', 'utf8');
    writeControl.failPartial = true;

    await expect(writeBlipAtomic(path, createBlip({ name: 'Doomed' }))).rejects.toThrow(/ENOSPC/);

    expect(readFileSync(path, 'utf8')).toContain('Original'); // destination untouched
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]); // partial tmp removed
  });

  it('sweeps crash-orphaned .BLIP.*.tmp files older than an hour after a successful write', async () => {
    const dir = tmpProject();
    const stale = join(dir, '.BLIP.deadbeef.tmp');
    const fresh = join(dir, '.BLIP.00ff00.tmp');
    writeFileSync(stale, 'crash orphan', 'utf8');
    writeFileSync(fresh, 'maybe another writer, in flight', 'utf8');
    const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(stale, twoHoursAgo, twoHoursAgo);

    await writeBlipAtomic(join(dir, 'BLIP.md'), createBlip({ name: 'Sweep' }));

    const tmps = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(tmps).toEqual(['.BLIP.00ff00.tmp']); // stale orphan gone, recent tmp kept
  });
});

describe('updateBlip — optimistic concurrency', () => {
  beforeEach(() => {
    renameControl.failures = 0;
    writeControl.failPartial = false;
  });

  it('replays the mutation when an external write lands mid-update (both changes survive)', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    await writeBlipAtomic(path, createBlip({ name: 'RMW' }));

    let calls = 0;
    await updateBlip(path, (blip) => {
      calls++;
      if (calls === 1) {
        // Deterministic interleave: an external agent writes between our read and our write.
        const raw = readFileSync(path, 'utf8');
        writeFileSync(path, raw.replace('name: RMW', 'name: RMW\nrepo: external/edit'), 'utf8');
      }
      blip.addTask('from the app');
    });

    expect(calls).toBe(2); // first round detected the race and was discarded
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('repo: external/edit'); // the external change survived
    expect(out).toContain('- [ ] from the app'); // and so did ours
    expect(Blip.parse(out).tasks.map((t) => t.text)).toEqual(['from the app']); // applied exactly once
  });

  it('gives up loudly after repeated conflicts instead of clobbering', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    await writeBlipAtomic(path, createBlip({ name: 'Hot' }));

    let calls = 0;
    await expect(
      updateBlip(path, () => {
        calls++;
        writeFileSync(path, `---\nname: Conflict${calls}\n---\n`, 'utf8'); // a fresh conflict every round
      }),
    ).rejects.toThrow(/kept changing mid-update/);
    expect(calls).toBe(3);
    expect(readFileSync(path, 'utf8')).toContain('Conflict3'); // the other writer's last word stands
  });

  it('returns the written Blip on the happy path', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    await writeBlipAtomic(path, createBlip({ name: 'Plain' }));

    const blip = await updateBlip(path, (b) => b.setHorizon('today'));
    expect(blip.fields.horizon).toBe('today');
    expect(readFileSync(path, 'utf8')).toContain('horizon: today');
  });
});
