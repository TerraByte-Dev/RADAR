import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { dirtySnapshot } from './activity.js';
import { writeAtomic } from './atomic.js';
import { localDate, localTime } from './core/dates.js';
import { parseBlip, type BlipFile } from './core/doc.js';
import { applyEdit, type EditCtx, type EditOp, type EditResult, type RemovedBlock } from './core/edit.js';
import { migrateFile, type MigrationReport } from './core/normalize.js';
import { BlipError, type BlipDoc } from './core/schema.js';
import { hasSecret, redact } from './core/secrets.js';
import { syncToOps, type SyncPayload } from './core/sync.js';
import { withLock } from './lock.js';
import { BLIP_FILE, blipPath, dataDir, mainCheckoutPath, projectId } from './paths.js';
import { ensureRegistered } from './registry.js';
import { writeState } from './state.js';

/** The first 16 hex characters of sha256 over the file's bytes: what an agent's task numbers are tied to. */
export function revOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

const lockPath = (id: string): string => join(dataDir(), 'locks', `${id}.lock`);

async function readBytes(dir: string): Promise<Buffer> {
  try {
    return await readFile(blipPath(dir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new BlipError('E_NO_PROJECT', `there is no ${BLIP_FILE} in ${dir}`, { hint: 'run "radar-blip init" there to start tracking it', path: dir });
    }
    throw err;
  }
}

function parse(dir: string, bytes: Buffer, mtime?: Date): BlipFile {
  return parseBlip(bytes.toString('utf8'), mtime ? { dirName: basename(resolve(dir)), mtime } : { dirName: basename(resolve(dir)) });
}

/** A file about to be written: refused unless its bytes are UTF-8 (anything else would not survive the round trip) and the engine may write it. */
function parseForWrite(dir: string, bytes: Buffer, now: Date): BlipFile {
  const file = parse(dir, bytes);
  if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) {
    throw new BlipError('E_UNWRITABLE', `${BLIP_FILE} is not UTF-8 text`, { hint: 're-save the file as UTF-8 by hand', path: blipPath(dir) });
  }
  file.edit({ now }); // throws for a read-only file: broken YAML, a newer schema, v2
  return file;
}

/** Read and parse a project's BLIP.md. Works on any file, v2 included. */
export async function readProject(dir: string): Promise<{ file: BlipFile; rev: string }> {
  const bytes = await readBytes(dir);
  const { mtime } = await stat(blipPath(dir));
  return { file: parse(dir, bytes, mtime), rev: revOf(bytes) };
}

/** Keep a copy of what an edit takes out of the file. Append-only; the engine never reads it back. */
async function appendTrash(id: string, removed: readonly RemovedBlock[], ctx: EditCtx): Promise<void> {
  const dir = join(dataDir(), 'trash');
  await mkdir(dir, { recursive: true });
  const when = `${localDate(ctx.now)} ${localTime(ctx.now)}`;
  const text = removed.map((r) => `## ${when} — ${r.reason} — ${ctx.author}\n${r.text.replace(/\r\n/g, '\n')}\n\n`).join('');
  await appendFile(join(dir, `${id}.md`), text, 'utf8');
}

/** Ops, or a function that works them out from the file as it is under the lock. */
export type OpsSource = readonly EditOp[] | ((doc: BlipDoc, rev: string) => readonly EditOp[]);

export interface UpdateResult extends EditResult {
  doc: BlipDoc;
  rev: string;
  /** Set when the project could not be added to the registry. The write itself went through. */
  registry: string | null;
}

const WRITE_ATTEMPTS = 3;

async function write(dir: string, source: OpsSource, ctx: EditCtx, opts: { dryRun?: boolean; accepted?: (id: string) => Promise<void> } = {}): Promise<UpdateResult> {
  const id = projectId(dir);
  const path = blipPath(dir);
  const result = await withLock(lockPath(id), async () => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const before = await readBytes(dir);
      const file = parseForWrite(dir, before, ctx.now);
      const rev = revOf(before);
      const res = applyEdit(file, typeof source === 'function' ? source(file.doc(), rev) : source, ctx);
      const after = Buffer.from(file.toString(), 'utf8');
      if (res.changed && !opts.dryRun) {
        // Under the lock no other engine writes; this catches an editor or an old tool saving meanwhile.
        if (!(await readBytes(dir)).equals(before)) continue;
        if (res.removed.length) await appendTrash(id, res.removed, ctx);
        await writeAtomic(path, after);
      }
      if (!opts.dryRun) await opts.accepted?.(id);
      return { ...res, doc: file.doc(), rev: revOf(after) };
    }
    throw new BlipError('E_BUSY', `${BLIP_FILE} kept changing while it was being written`, { hint: 'something else is saving this file; try again in a moment', path });
  });
  return { ...result, registry: opts.dryRun ? null : await ensureRegistered(dir) };
}

/**
 * The one ordinary writer. The whole read-modify-write runs under the project's exclusive
 * lock, so concurrent writers queue instead of losing each other's changes. Nothing is
 * written when the ops change nothing. A read-only file is refused and never touched.
 */
export function updateProject(dir: string, ops: OpsSource, ctx: EditCtx): Promise<UpdateResult> {
  return write(dir, ops, ctx);
}

/**
 * Apply an agent's sync payload. Refs are resolved against the bytes read under the lock.
 * Every accepted sync — one that changes nothing included — records `lastSyncAt`, which is
 * how an agent says "the log already covers this". A dry run writes nothing at all.
 * `worktree`: the project's folder in the linked worktree the agent works in, whose
 * uncommitted files are recorded with the main checkout's.
 */
export function syncProject(dir: string, payload: SyncPayload, opts: { author: string; agent?: string; dryRun?: boolean; now?: Date; worktree?: string }): Promise<UpdateResult> {
  const now = opts.now ?? new Date();
  const ops = (doc: BlipDoc, rev: string): EditOp[] =>
    syncToOps(doc, payload, rev).map((op) => (op.op === 'log.add' && opts.agent ? { ...op, agent: opts.agent } : op));
  return write(dir, ops, { actor: 'agent', now, author: opts.author }, {
    dryRun: opts.dryRun === true,
    accepted: async (id) => {
      // An agent in a linked worktree has its uncommitted work there; for a path dirty in both, the worktree's wins.
      const dirty = { ...(await dirtySnapshot(dir)), ...(opts.worktree === undefined ? {} : await dirtySnapshot(opts.worktree)) };
      await writeState(id, { lastSyncAt: now.toISOString(), dirtyAtSync: dirty });
    },
  });
}

/**
 * Put back a byte snapshot, only if the file is still at `expectRev`. This is the app's
 * undo and nothing else uses it.
 */
export async function replaceIfRev(dir: string, expectRev: string, bytes: Buffer): Promise<{ doc: BlipDoc; rev: string }> {
  const result = await withLock(lockPath(projectId(dir)), async () => {
    const current = await readBytes(dir);
    parseForWrite(dir, current, new Date());
    if (revOf(current) !== expectRev) {
      throw new BlipError('E_STALE_REV', 'the file has changed since, so it was left as it is', { path: blipPath(dir) });
    }
    await writeAtomic(blipPath(dir), bytes);
    return { doc: parse(dir, bytes, new Date()).doc(), rev: revOf(bytes) };
  });
  await ensureRegistered(dir);
  return result;
}

/** What `migrateProject` did, or would do, to one project. */
export interface ProjectMigration extends MigrationReport {
  dir: string;
  /** The copy of the file as it was, taken before anything changed. Null when nothing was written. */
  backup: string | null;
  /** The file looks like it holds a token and was (or, on a dry run, would be) left alone. */
  secretSkipped: boolean;
}

/**
 * The report as it may be shown, printed and stored: where the file has token-shaped
 * lines, nothing taken from the file's text is passed on with such a value in it. A split
 * example is left out whole when its line has one, because the split can fall between a
 * label and its value and leave two halves that each look harmless.
 */
function withoutSecrets(report: MigrationReport): MigrationReport {
  if (!report.secretLines.length) return report;
  const pairs = (list: { key: string; value: string }[]): { key: string; value: string }[] => list.map((p) => ({ key: p.key, value: redact(p.value) }));
  return {
    ...report,
    keys: report.keys.map(redact),
    dropped: pairs(report.dropped),
    kept: pairs(report.kept),
    foreign: report.foreign.map((f) => ({ ...f, heading: redact(f.heading) })),
    examples: report.examples.filter((e) => !hasSecret(e.original)),
  };
}

/**
 * Rewrite a v2 file as v3, once. The exact old bytes and the report are copied to
 * `<data>/backups/<id>/` first; if that copy cannot be written the file is not migrated
 * (`E_BACKUP`). A file with something token-shaped in it is left alone unless
 * `allowSecretShaped` is set, because the backup would copy the value. A dry run writes
 * nothing anywhere.
 */
export async function migrateProject(dir: string, opts: { dryRun: boolean; allowSecretShaped: boolean }): Promise<ProjectMigration> {
  const path = blipPath(dir);
  const plan = async (): Promise<{ before: Buffer; text: string; out: ProjectMigration }> => {
    const before = await readBytes(dir);
    const { text, report } = migrateFile(parse(dir, before));
    const utf8 = Buffer.from(before.toString('utf8'), 'utf8').equals(before);
    const out: ProjectMigration = { ...withoutSecrets(report), dir, backup: null, secretSkipped: report.changed && report.secretLines.length > 0 && !opts.allowSecretShaped };
    if (!utf8 && report.changed) {
      out.changed = false;
      out.skipped = 'unwritable';
    }
    return { before, text, out };
  };
  if (opts.dryRun) return (await plan()).out;

  const id = projectId(dir);
  const result = await withLock(lockPath(id), async () => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const { before, text, out } = await plan();
      if (!out.changed || out.secretSkipped) return { ...out, changed: false };
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      // A retry within the same second must not find its own earlier copy in the way.
      const backup = join(dataDir(), 'backups', id, `${stamp}${attempt ? `-${attempt + 1}` : ''}-BLIP.md`);
      try {
        await mkdir(dirname(backup), { recursive: true });
        await writeFile(backup, before, { flag: 'wx' });
        await writeFile(backup.replace(/-BLIP\.md$/, '-report.json'), `${JSON.stringify({ ...out, backup }, null, 2)}\n`, 'utf8');
      } catch (err) {
        throw new BlipError('E_BACKUP', `could not write the backup copy (${err instanceof Error ? err.message : String(err)}), so the file was not migrated`, { path: backup });
      }
      if (!(await readBytes(dir)).equals(before)) continue;
      await writeAtomic(path, text);
      return { ...out, backup };
    }
    throw new BlipError('E_BUSY', `${BLIP_FILE} kept changing while it was being migrated`, { hint: 'close whatever is saving this file and run migrate again', path });
  });
  if (result.backup) await ensureRegistered(dir);
  return result;
}

const SKELETON = '---\nblip: 3\n---\n\n# Tasks\n\n# Session log\n';

/**
 * Start tracking a folder: create its BLIP.md, exclusively. An existing file is never
 * overwritten — it is read and returned with `created: false`. Inside a linked git
 * worktree the file is created in the main checkout.
 */
export async function initProject(dir: string, opts: { name?: string; now?: string; tasks?: string[] } = {}): Promise<{ created: boolean; dir: string; doc: BlipDoc; registry: string | null }> {
  const target = mainCheckoutPath(dir) ?? resolve(dir);
  const existing = async (): Promise<{ created: boolean; dir: string; doc: BlipDoc; registry: string | null }> => ({
    created: false,
    dir: target,
    doc: (await readProject(target)).file.doc(),
    registry: await ensureRegistered(target),
  });
  if (existsSync(blipPath(target))) return existing();

  const ops: EditOp[] = [];
  if (opts.name !== undefined) ops.push({ op: 'set', field: 'name', value: opts.name });
  if (opts.now !== undefined) ops.push({ op: 'set', field: 'now', value: opts.now });
  for (const title of opts.tasks ?? []) ops.push({ op: 'task.add', title });
  const file = parseBlip(SKELETON, { dirName: basename(target) });
  applyEdit(file, ops, { actor: 'agent', now: new Date(), author: 'init' });
  try {
    await writeFile(blipPath(target), file.toString(), { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    return existing();
  }
  return { created: true, dir: target, doc: file.doc(), registry: await ensureRegistered(target) };
}
