import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseBlip, type BlipFile } from '../../src/core/doc.js';
import { applyEdit, type EditOp } from '../../src/core/edit.js';
import { rawEntries } from '../../src/core/log.js';
import { migrateFile } from '../../src/core/normalize.js';

/**
 * Opt-in: point RADAR_CORPUS at a text file listing real BLIP.md paths, one per line
 * (`#` starts a comment). The files are opened read-only and nothing from them is ever
 * written, logged or put in an assertion message — only invariants are checked, and a
 * failure names the path and the invariant, never the content.
 *
 * Read path: the round trip is lossless, migrate is idempotent and gives schema 3, and every
 * split task is title + " " + detail[0] of the v2 text. Write path, on the migrated text in
 * memory: an agent sync (now, a log entry, the last open task done) leaves the other tasks
 * as they were and only puts the entry on top of the log, a replay of it changes nothing,
 * and an edit that sets a task's title to what it already is changes nothing.
 */
const list = process.env.RADAR_CORPUS;
const paths = list
  ? readFileSync(list, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  : [];

describe.skipIf(paths.length === 0)('real files (RADAR_CORPUS)', () => {
  it.each(paths)('%s', (path) => {
    const text = readFileSync(path, 'utf8');
    const ctx = { dirName: basename(dirname(path)), mtime: statSync(path).mtime };

    let failure: string | null = null;
    try {
      const file = parseBlip(text, ctx);
      file.doc();
      if (file.toString() !== text) failure = 'round trip is not lossless';
      const first = migrateFile(file);
      const second = migrateFile(parseBlip(first.text, ctx));
      if (second.text !== first.text) failure = 'a second migration changed bytes';
      if (first.report.changed && parseBlip(first.text, ctx).schema !== 3) failure = 'migration did not produce a v3 file';
      failure ??= splitsAreLossless(file, parseBlip(first.text, ctx), first.report.nextAction === 'promote');
      failure ??= writePath(parseBlip(first.text, ctx));
    } catch (err) {
      failure = `threw ${err instanceof Error ? err.name : 'a non-error'}`;
    }
    expect(failure).toBeNull();
  });
});

const block = (b: { title: string; due: string | null; children: readonly string[] }): string => JSON.stringify([b.title, b.due, b.children]);

function splitsAreLossless(v2: BlipFile, v3: BlipFile, promoted: boolean): string | null {
  const after = v3.openTasks().slice(promoted ? 1 : 0);
  const before = v2.openTasks();
  if (after.length !== before.length) return 'migration changed the number of open tasks';
  for (const [i, orig] of before.entries()) {
    const b = after[i]!;
    if (b.due !== orig.due) return `open task ${i + 1}: due changed`;
    if (b.title === orig.title) continue;
    if (`${b.title} ${b.children[0]?.slice(2) ?? ''}` !== orig.title) return `open task ${i + 1}: title + detail[0] is not the v2 text`;
  }
  return null;
}

function writePath(file: BlipFile): string | null {
  if (!file.writable) return null;
  const at = new Date('2026-10-14T12:00:00Z');
  const open = file.openTasks().map(block);
  const last = file.openTasks().at(-1);
  const log = file.logSection ? rawEntries(file.logSection).map((e) => e.lines) : [];
  const ops: EditOp[] = [
    { op: 'set', field: 'now', value: 'The corpus write check ran and the queue is as it was.' },
    { op: 'log.add', bullets: ['Ran the corpus write check'] },
    ...(last ? [{ op: 'task.done', task: { title: last.title } } as const] : []),
  ];
  applyEdit(file, ops, { actor: 'agent', now: at, author: 'Corpus' });
  if (JSON.stringify(file.openTasks().map(block)) !== JSON.stringify(last ? open.slice(0, -1) : open)) return 'a sync changed open tasks it did not name';
  const entries = file.logSection ? rawEntries(file.logSection).map((e) => e.lines) : [];
  if (entries.length !== log.length + 1 || JSON.stringify(entries.slice(1)) !== JSON.stringify(log)) return 'a sync changed the log below the new entry';
  const once = file.toString();
  applyEdit(file, ops, { actor: 'agent', now: new Date(at.getTime() + 86_400_000), author: 'Corpus' });
  if (file.toString() !== once) return 'a replayed sync changed bytes';
  const first = file.openTasks()[0];
  if (first) {
    applyEdit(file, [{ op: 'task.edit', task: { title: first.title }, title: first.title }], { actor: 'human', now: at, author: 'Corpus' });
    if (file.toString() !== once) return 'an edit to the same title changed bytes';
  }
  return null;
}
