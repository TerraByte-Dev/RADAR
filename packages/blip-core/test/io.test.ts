import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOW, fixture } from './core/fixtures.js';
import { bigV3, bytesOf, isolate, project, textOf, tmp } from './helpers.js';

// Intercept fs calls (transitively, inside src/io.ts) to simulate the transient
// EPERM/EBUSY failures Windows produces when antivirus / sync clients / file watchers
// briefly hold the destination during an atomic replace, and an ENOSPC mid-write that
// leaves a partial temp file behind.
const renameControl: { failures: number; code: string; calls: number } = { failures: 0, code: 'EPERM', calls: 0 };
const writeControl: { failPartial: boolean } = { failPartial: false };
// Runs once, just after the next migration backup has been written: an editor saving at the worst moment.
const backupControl: { afterBackup: (() => void) | null } = { afterBackup: null };
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    rename: async (from: string, to: string): Promise<void> => {
      renameControl.calls++;
      if (renameControl.failures > 0) {
        renameControl.failures--;
        const err = new Error(`${renameControl.code}: simulated lock`) as NodeJS.ErrnoException;
        err.code = renameControl.code;
        throw err;
      }
      return real.rename(from, to);
    },
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      await real.writeFile(...args);
      if (backupControl.afterBackup && String(args[0]).endsWith('-BLIP.md')) {
        const hook = backupControl.afterBackup;
        backupControl.afterBackup = null;
        hook();
      }
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

const { initProject, migrateProject, readProject, replaceIfRev, revOf, updateProject } = await import('../src/io.js');
const { writeAtomic } = await import('../src/atomic.js');
const { listProjects } = await import('../src/registry.js');
const { projectId } = await import('../src/paths.js');

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'blip-io-'));
}

const doc = (name: string): string => `---\nblip: 3\nname: ${name}\n---\n`;
const human = { actor: 'human' as const, now: NOW, author: 'Robin' };

let data: string;
beforeEach(() => {
  data = isolate();
  renameControl.failures = 0;
  renameControl.code = 'EPERM';
  writeControl.failPartial = false;
  backupControl.afterBackup = null;
});

describe('writeAtomic — transient-failure durability', () => {
  it('writes through transient EPERM renames (the Windows AV/watcher case)', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    renameControl.failures = 3;

    await writeAtomic(path, doc('Retry'));

    expect(readFileSync(path, 'utf8')).toBe(doc('Retry'));
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]); // no litter
  });

  it('gives up after persistent failures, removes the temp file, and leaves the original intact', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    writeFileSync(path, '---\nname: Original\n---\n', 'utf8');
    renameControl.failures = Number.MAX_SAFE_INTEGER;

    await expect(writeAtomic(path, doc('Doomed'))).rejects.toThrow(/EPERM/);

    expect(readFileSync(path, 'utf8')).toContain('Original'); // destination untouched
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]); // tmp cleaned up
  });

  it('does not retry non-transient errors (e.g. ENOENT bubbles immediately)', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    renameControl.failures = 1;
    renameControl.code = 'ENOENT';

    renameControl.calls = 0;
    await expect(writeAtomic(path, doc('X'))).rejects.toThrow(/ENOENT/);
    // one rename and no second: the ladder sleeps only before a retry, so there was no backoff
    expect(renameControl.calls).toBe(1);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('removes a partially-written temp file when the write itself fails (ENOSPC)', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    writeFileSync(path, '---\nname: Original\n---\n', 'utf8');
    writeControl.failPartial = true;

    await expect(writeAtomic(path, doc('Doomed'))).rejects.toThrow(/ENOSPC/);

    expect(readFileSync(path, 'utf8')).toContain('Original'); // destination untouched
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]); // partial tmp removed
  });

  // root writes through any mode, so the check cannot hold there
  it.skipIf(process.getuid?.() === 0)('refuses a read-only destination on every platform, without a rename or a temp file', async () => {
    const dir = tmpProject();
    const path = join(dir, 'BLIP.md');
    writeFileSync(path, '---\nname: Original\n---\n', 'utf8');
    chmodSync(path, 0o444);
    renameControl.calls = 0;
    try {
      await expect(writeAtomic(path, doc('Doomed'))).rejects.toThrow(/EACCES|EPERM/);
      expect(renameControl.calls).toBe(0);
      expect(readFileSync(path, 'utf8')).toContain('Original');
      expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    } finally {
      chmodSync(path, 0o644);
    }
  });

  it('sweeps crash-orphaned .BLIP.*.tmp files older than an hour after a successful write', async () => {
    const dir = tmpProject();
    const stale = join(dir, '.BLIP.deadbeef.tmp');
    const fresh = join(dir, '.BLIP.00ff00.tmp');
    writeFileSync(stale, 'crash orphan', 'utf8');
    writeFileSync(fresh, 'maybe another writer, in flight', 'utf8');
    const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(stale, twoHoursAgo, twoHoursAgo);

    await writeAtomic(join(dir, 'BLIP.md'), doc('Sweep'));

    const tmps = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(tmps).toEqual(['.BLIP.00ff00.tmp']); // stale orphan gone, recent tmp kept
  });
});

describe('updateProject', () => {
  it('writes the change, returns the new read model and rev, and leaves nothing else in the folder', async () => {
    const dir = project();
    const res = await updateProject(dir, [{ op: 'task.add', title: 'Check the sync flag', due: '2026-12-01' }], human);
    expect(res.changed).toBe(true);
    expect(res.doc.tasks.open.at(-1)).toMatchObject({ title: 'Check the sync flag', due: '2026-12-01', n: 5 });
    expect(res.rev).toBe(revOf(bytesOf(dir)));
    expect(res.rev).toMatch(/^[0-9a-f]{16}$/);
    expect((await readProject(dir)).rev).toBe(res.rev);
    expect(readdirSync(dir)).toEqual(['BLIP.md']);
    expect(readdirSync(join(data, 'locks'))).toEqual([]);
  });

  it('writes nothing when the ops change nothing: the file keeps its bytes and its mtime', async () => {
    const dir = project();
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(join(dir, 'BLIP.md'), old, old);
    const before = statSync(join(dir, 'BLIP.md')).mtimeMs;
    const res = await updateProject(dir, [{ op: 'set', field: 'status', value: 'blocked' }, { op: 'task.add', title: 'Write the release notes for 4.2' }], human);
    expect(res.changed).toBe(false);
    expect(statSync(join(dir, 'BLIP.md')).mtimeMs).toBe(before);
    expect(textOf(dir)).toBe(fixture('v3/full.md'));
  });

  it('keeps CRLF, a BOM and a missing final newline through a write', async () => {
    for (const rel of ['v3/crlf.md', 'v3/bom.md']) {
      const dir = project(fixture(rel));
      await updateProject(dir, [{ op: 'set', field: 'focus', value: true }], human);
      await updateProject(dir, [{ op: 'set', field: 'focus', value: false }], human);
      expect(textOf(dir), rel).toBe(fixture(rel));
    }
  });

  it('replays on fresh bytes when an editor saves mid-update (both changes survive)', async () => {
    const dir = project();
    let calls = 0;
    const res = await updateProject(
      dir,
      () => {
        calls++;
        if (calls === 1) writeFileSync(join(dir, 'BLIP.md'), textOf(dir).replace('name: Lantern Notes', 'name: Lantern Notes\nrepo: external/edit'));
        return [{ op: 'task.add', title: 'From the app' }];
      },
      human,
    );
    expect(calls).toBe(2); // the first round saw the other save and was thrown away
    expect(res.changed).toBe(true);
    const out = textOf(dir);
    expect(out).toContain('repo: external/edit');
    expect(out.match(/- \[ \] From the app/g)).toHaveLength(1);
  });

  it('gives up with E_BUSY after three conflicts instead of clobbering', async () => {
    const dir = project();
    let calls = 0;
    await expect(
      updateProject(
        dir,
        () => {
          calls++;
          writeFileSync(join(dir, 'BLIP.md'), `---\nblip: 3\nname: Conflict${calls}\n---\n`);
          return [{ op: 'task.add', title: 'From the app' }];
        },
        human,
      ),
    ).rejects.toMatchObject({ code: 'E_BUSY' });
    expect(calls).toBe(3);
    expect(textOf(dir)).toBe('---\nblip: 3\nname: Conflict3\n---\n'); // the other writer's last word stands
    expect(readdirSync(join(data, 'locks'))).toEqual([]);
  });

  it('refuses a file that is not UTF-8 rather than re-encode it', async () => {
    const dir = project();
    const bytes = Buffer.concat([bytesOf(dir), Buffer.from([0xff, 0xfe, 0x0a])]);
    writeFileSync(join(dir, 'BLIP.md'), bytes);
    await expect(updateProject(dir, [{ op: 'task.add', title: 'Check the sync flag' }], human)).rejects.toMatchObject({ code: 'E_UNWRITABLE' });
    expect(bytesOf(dir).equals(bytes)).toBe(true);
  });

  it('a folder with no BLIP.md is E_NO_PROJECT', async () => {
    await expect(updateProject(tmp(), [], human)).rejects.toMatchObject({ code: 'E_NO_PROJECT' });
    await expect(readProject(tmp())).rejects.toMatchObject({ code: 'E_NO_PROJECT' });
  });

  it('readProject clamps a date-only entry dated today to the file mtime', async () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dir = project(`---\nblip: 3\n---\n\n# Session log\n\n## ${iso}\n- Did a thing\n`);
    const { file } = await readProject(dir);
    expect(new Date(file.doc().lastLogAt!).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('replaceIfRev (the app undo)', () => {
  it('puts a snapshot back only while the file is at the expected rev', async () => {
    const dir = project();
    const snapshot = bytesOf(dir);
    const res = await updateProject(dir, [{ op: 'task.remove', task: { title: 'Renew the signing certificate' } }], human);
    await expect(replaceIfRev(dir, 'ffffffffffffffff', snapshot)).rejects.toMatchObject({ code: 'E_STALE_REV' });
    expect(textOf(dir)).not.toContain('signing certificate');
    const back = await replaceIfRev(dir, res.rev, snapshot);
    expect(bytesOf(dir).equals(snapshot)).toBe(true);
    expect(back.rev).toBe(revOf(snapshot));
    expect(back.doc.tasks.open).toHaveLength(4);
  });
});

describe('initProject', () => {
  it('creates a v3 file with what it was given, and registers it', async () => {
    const dir = tmp();
    const res = await initProject(dir, { name: 'Lantern Notes', now: 'Just started; nothing is built yet.', tasks: ['Sketch the data model', 'Pick a sync library'] });
    expect(res.created).toBe(true);
    expect(textOf(dir)).toBe(
      '---\nblip: 3\nname: Lantern Notes\nnow: Just started; nothing is built yet.\n---\n\n# Tasks\n\n- [ ] Sketch the data model\n- [ ] Pick a sync library\n\n# Session log\n',
    );
    expect(res.doc.problems).toEqual([]);
    expect((await listProjects()).projects.map((p) => p.dir)).toEqual([dir]);
  });

  it('with nothing given, writes the bare skeleton and no made-up name', async () => {
    const dir = tmp();
    const res = await initProject(dir);
    expect(textOf(dir)).toBe('---\nblip: 3\n---\n\n# Tasks\n\n# Session log\n');
    expect(res.doc.nameSource).toBe('folder');
    // An engine write to the skeleton is stable.
    await updateProject(dir, [{ op: 'task.add', title: 'Sketch the data model' }], human);
    expect(textOf(dir)).toBe('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Sketch the data model\n\n# Session log\n');
  });

  it('never overwrites: an existing file keeps its bytes, whatever is passed', async () => {
    for (const rel of ['v3/full.md', 'v2/legacy-enums.md', 'readonly/broken-yaml.md']) {
      const dir = project(fixture(rel));
      const before = bytesOf(dir);
      const res = await initProject(dir, { name: 'Something Else', tasks: ['x'.repeat(200)] });
      expect(res.created).toBe(false);
      expect(bytesOf(dir).equals(before)).toBe(true);
    }
  });

  it('rejects a bad name before creating anything', async () => {
    const dir = tmp();
    await expect(initProject(dir, { name: 'my-folder-slug' })).rejects.toMatchObject({ code: 'E_NAME_STYLE' });
    expect(existsSync(join(dir, 'BLIP.md'))).toBe(false);
  });
});

describe('migrateProject', () => {
  const opts = { dryRun: false, allowSecretShaped: false };

  it('a dry run changes no mtime and creates no backup', async () => {
    const dir = project(fixture('v2/big-83kb.md'));
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(join(dir, 'BLIP.md'), old, old);
    const before = statSync(join(dir, 'BLIP.md')).mtimeMs;
    const report = await migrateProject(dir, { dryRun: true, allowSecretShaped: false });
    expect(report).toMatchObject({ from: 2, changed: true, backup: null, secretSkipped: false });
    expect(report.tasks.split + report.tasks.cut).toBeGreaterThan(0);
    expect(statSync(join(dir, 'BLIP.md')).mtimeMs).toBe(before);
    expect(textOf(dir)).toBe(fixture('v2/big-83kb.md'));
    expect(existsSync(data)).toBe(false); // no backups, no locks, no registry: nothing at all
  });

  it('copies the exact old bytes and the report to the backup folder, then rewrites the file', async () => {
    const dir = project(fixture('v2/crlf.md'));
    const before = bytesOf(dir);
    const report = await migrateProject(dir, opts);
    expect(report.changed).toBe(true);
    const folder = join(data, 'backups', projectId(dir));
    const files = readdirSync(folder).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^\d{8}T\d{6}Z-BLIP\.md$/);
    expect(files[1]).toBe(files[0]!.replace('-BLIP.md', '-report.json'));
    expect(report.backup).toBe(join(folder, files[0]!));
    expect(readFileSync(report.backup!).equals(before)).toBe(true);
    expect(JSON.parse(readFileSync(join(folder, files[1]!), 'utf8'))).toMatchObject({ from: 2, changed: true, dir, backup: report.backup });

    const { file } = await readProject(dir);
    expect(file.schema).toBe(3);
    expect(file.writable).toBe(true);
    expect((await listProjects()).projects.map((p) => p.dir)).toEqual([dir]);
    expect(readdirSync(dir)).toEqual(['BLIP.md']);

    // A second pass changes zero bytes and takes no second backup.
    const after = bytesOf(dir);
    expect(await migrateProject(dir, opts)).toMatchObject({ changed: false, skipped: 'already-v3', backup: null });
    expect(bytesOf(dir).equals(after)).toBe(true);
    expect(readdirSync(folder)).toHaveLength(2);
  });

  it('an unwritable backup directory is E_BACKUP and the file is not migrated', async () => {
    const dir = project(fixture('v2/legacy-enums.md'));
    const before = bytesOf(dir);
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'backups'), 'a file where the backups folder should be');
    await expect(migrateProject(dir, opts)).rejects.toMatchObject({ code: 'E_BACKUP' });
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(readdirSync(join(data, 'locks'))).toEqual([]);
  });

  it('a file with a secret-shaped line is skipped unless allowed, and the report gives line numbers only', async () => {
    const text = fixture('lint/secret-shaped.pos.md').replace(/^blip: 3\r?\n/m, '');
    const dir = project(text);
    const before = bytesOf(dir);
    const dry = await migrateProject(dir, { dryRun: true, allowSecretShaped: false });
    expect(dry.secretSkipped).toBe(true);
    expect(dry.secretLines.length).toBeGreaterThan(0);

    const skipped = await migrateProject(dir, opts);
    expect(skipped).toMatchObject({ changed: false, secretSkipped: true, backup: null });
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(existsSync(join(data, 'backups'))).toBe(false);

    const allowed = await migrateProject(dir, { dryRun: false, allowSecretShaped: true });
    expect(allowed).toMatchObject({ changed: true, secretSkipped: false });
    expect((await readProject(dir)).file.schema).toBe(3);
  });

  it('the report never repeats a value from a secret-shaped line, allowed or not', async () => {
    const text = [
      '---',
      'last_session: TOKEN=fake-fake-fake-123',
      '---',
      '',
      '# Tasks',
      '',
      '- [ ] Store the staging deploy TOKEN: not-a-real-value-67890 in the vault and then update the runbook so the team knows',
      '- [ ] Write the long release notes for the spring version: cover the sync engine, the conflict screen and the new export',
      '',
    ].join('\n');
    for (const allowSecretShaped of [false, true]) {
      const report = await migrateProject(project(text), { dryRun: true, allowSecretShaped });
      expect(report.secretLines).toEqual([2, 7]);
      expect(report.dropped).toEqual([{ key: 'last_session', value: 'TOKEN=«redacted»' }]);
      expect(report.examples.map((e) => e.title)).toEqual(['Write the long release notes for the spring version:']);
      expect(JSON.stringify(report)).not.toMatch(/fake-fake-fake|not-a-real-value/);
    }
  });

  it('an editor saving between the backup and the write costs a retry, not the migration', async () => {
    const dir = project(fixture('v2/legacy-enums.md'));
    const saved = `${fixture('v2/legacy-enums.md').trimEnd()}\n\n# Scratch\n\nSaved by an editor mid-migration.\n`;
    backupControl.afterBackup = () => writeFileSync(join(dir, 'BLIP.md'), saved);
    const report = await migrateProject(dir, opts);
    expect(report.changed).toBe(true);
    expect(textOf(dir)).toContain('Saved by an editor mid-migration.');
    expect((await readProject(dir)).file.schema).toBe(3);
    // The backup named in the report is of the bytes that were actually migrated.
    expect(readFileSync(report.backup!, 'utf8')).toBe(saved);
    expect(readdirSync(join(data, 'locks'))).toEqual([]);
  });

  it('broken YAML and a newer schema are left alone', async () => {
    for (const [rel, skipped] of [['readonly/broken-yaml.md', 'unwritable'], ['readonly/newer-schema.md', 'newer-schema']] as const) {
      const dir = project(fixture(rel));
      const before = bytesOf(dir);
      expect(await migrateProject(dir, opts)).toMatchObject({ changed: false, skipped, backup: null });
      expect(bytesOf(dir).equals(before)).toBe(true);
    }
    expect(existsSync(join(data, 'backups'))).toBe(false);
  });

  it('the engine writes to the migrated 83 KB fixture', async () => {
    const dir = project(bigV3());
    const res = await updateProject(dir, [{ op: 'task.add', title: 'Order more seed trays' }], human);
    expect(res.changed).toBe(true);
    expect(bytesOf(dir).length).toBeGreaterThan(80_000);
  });
});
