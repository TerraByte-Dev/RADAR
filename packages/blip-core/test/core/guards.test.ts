import { describe, it, expect } from 'vitest';
import * as api from '../../src/index.js';
import { BlipEditor, type BlipFile } from '../../src/core/doc.js';
import { migrateFile } from '../../src/core/normalize.js';
import { BlipError } from '../../src/core/schema.js';
import type { TaskBlock } from '../../src/core/tasks.js';
import { NOW, READONLY, fixture, parse, parseText } from './fixtures.js';

const HEAD = '---\nblip: 3\nname: Sample\nnow: fine\n---\n\n';
const BASE = `${HEAD}# Tasks\n\n- [ ] Alpha task\n  keep me\n- [ ] Beta task\n\n## Done\n\n- [x] Gamma task (done 2026-10-01)\n\n# Session log\n\n## 2026-10-01 10:00 — Robin\n- First thing\n`;

const shape = (file: BlipFile) => {
  const doc = parseText(file.toString()).doc();
  return { open: doc.tasks.open.map((t) => t.title), done: doc.tasks.done.map((t) => t.title), log: doc.log.length };
};

function unwritable(fn: () => unknown): BlipError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BlipError);
    expect((err as BlipError).code).toBe('E_UNWRITABLE');
    return err as BlipError;
  }
  throw new Error('expected the edit to be refused');
}

describe('the read-only gate cannot be stepped round', () => {
  it('the package does not hand out the editor class', () => {
    expect('BlipEditor' in api).toBe(false);
  });

  it('constructing an editor directly on a v2 file is refused like file.edit()', () => {
    const file = parseText('---\nname: Sample\n---\n\n# Tasks\n\n- [ ] A\n');
    const before = file.toString();
    expect(() => new BlipEditor(file, NOW)).toThrow(expect.objectContaining({ code: 'E_NEEDS_MIGRATE' }));
    expect(file.toString()).toBe(before);
  });

  it.each(READONLY)('%s: the same for a file that cannot be written safely', (rel) => {
    const file = parse(rel);
    expect(() => new BlipEditor(file, NOW)).toThrow(BlipError);
    expect(file.toString()).toBe(fixture(rel));
  });
});

describe('an edit that throws changes nothing', () => {
  it('moveTask before a task that is not open', () => {
    const file = parseText(BASE);
    const ed = file.edit({ now: NOW });
    const [alpha] = file.openTasks();
    const [gamma] = file.doneTasks();
    expect(() => ed.moveTask(alpha!, gamma!)).toThrow();
    expect(file.toString()).toBe(BASE);
    ed.addTask({ title: 'Third task' });
    expect(file.toString()).toContain('- [ ] Alpha task\n  keep me\n- [ ] Beta task\n- [ ] Third task\n');
  });

  it('an earlier edit in the same session survives a later one that throws', () => {
    const file = parseText(BASE);
    const ed = file.edit({ now: NOW });
    ed.addTask({ title: 'Earlier edit' });
    const kept = file.toString();
    expect(() => ed.moveTask(file.openTasks()[0]!, file.doneTasks()[0]!)).toThrow();
    expect(file.toString()).toBe(kept);
    expect(shape(file).open).toEqual(['Alpha task', 'Beta task', 'Earlier edit']);
  });

  it('addTask before a task that is not open does not tidy the list on its way out', () => {
    const text = `${HEAD}# Tasks\n\n- [x] Ticked in the queue\n- [ ] Alpha task\n\n## Done\n\n- [ ] Unticked under done\n`;
    const file = parseText(text);
    const ed = file.edit({ now: NOW });
    expect(() => ed.addTask({ title: 'New' }, file.doneTasks()[0]!)).toThrow();
    expect(file.toString()).toBe(text);
    expect(ed.corrections).toEqual({ doneInQueue: 0, openInDone: 0 });
    expect(ed.tidy()).toBe(true);
    expect(ed.corrections).toEqual({ doneInQueue: 1, openInDone: 1 });
  });

  it('a task from another file creates no # Tasks section', () => {
    const foreign = parseText(BASE).openTasks()[0]!;
    const ticked = parseText(BASE).doneTasks()[0]!;
    const text = `${HEAD}# Notes\n\nNothing to do yet.\n`;
    const ops: ((ed: BlipEditor, b: TaskBlock) => unknown)[] = [
      (ed, b) => ed.removeTask(b),
      (ed, b) => ed.moveTask(b, null),
      (ed, b) => ed.editTask(b, { title: 'x' }),
      (ed, b) => ed.completeTask(b),
      (ed) => ed.reopenTask(ticked),
    ];
    for (const op of ops) {
      const file = parseText(text);
      expect(() => op(file.edit({ now: NOW }), foreign)).toThrow();
      expect(file.toString()).toBe(text);
    }
  });

  it('editTask that changes no value rewrites nothing', () => {
    const text = `${HEAD}# Tasks\n\n- [ ] Alpha task (due 2026-12-01)\n  keep me\n\n- [ ] Beta task\n`;
    const file = parseText(text);
    const ed = file.edit({ now: NOW });
    const [alpha] = file.openTasks();
    expect(ed.editTask(alpha!, {})).toBeNull();
    ed.editTask(alpha!, { title: 'Alpha task', due: '2026-12-01' });
    expect(file.toString()).toBe(text);
    ed.editTask(alpha!, { title: 'Alpha, renamed' });
    expect(file.toString()).toBe(`${HEAD}# Tasks\n\n- [ ] Alpha, renamed (due 2026-12-01)\n  keep me\n- [ ] Beta task\n`);
  });
});

describe('an edit that the file could not be read back from is refused', () => {
  it.each(['```', '~~~', '```js', '   ~~~~ notes'])('a detail line that opens a code fence and never closes it: %s', (fence) => {
    const file = parseText(BASE);
    const ed = file.edit({ now: NOW });
    unwritable(() => ed.addTask({ title: 'Injected', detail: [fence] }, file.openTasks()[0]!));
    expect(file.toString()).toBe(BASE);
    const alpha = file.openTasks()[0]!;
    unwritable(() => ed.editTask(alpha, { detail: ['see below', fence, 'x'] }));
    expect(alpha.children).toEqual(['  keep me']);
    expect(file.toString()).toBe(BASE);
    expect(shape(file)).toEqual({ open: ['Alpha task', 'Beta task'], done: ['Gamma task'], log: 1 });
  });

  it('a closed code fence in the detail is fine', () => {
    const file = parseText(BASE);
    file.edit({ now: NOW }).addTask({ title: 'With code', detail: ['```', '- [ ] not a task', '## Done', '```', 'after'] }, file.openTasks()[0]!);
    expect(shape(file)).toEqual({ open: ['With code', 'Alpha task', 'Beta task'], done: ['Gamma task'], log: 1 });
    expect(parseText(file.toString()).openTasks()[0]!.children).toEqual(['  ```', '  - [ ] not a task', '  ## Done', '  ```', '  after']);
  });

  it('an unclosed fence earlier in the file: a new # Tasks or # Session log would land inside it', () => {
    const text = `${HEAD}# Notes\n\n\`\`\`\nnever closed\n\n# Tasks\n\n- [ ] one\n`;
    const file = parseText(text);
    expect(file.doc().tasks.open).toEqual([]);
    const ed = file.edit({ now: NOW });
    const err = unwritable(() => ed.addTask({ title: 'Brand new task' }));
    expect(err.hint).toContain('line 9');
    unwritable(() => ed.addLogEntry({ author: 'Robin', bullets: ['one'] }));
    expect(file.toString()).toBe(text);
    expect(ed.setField('now', 'still fine')).toBe(true);
  });

  it('an unclosed fence in the last task: nothing can be added after it', () => {
    const text = `${HEAD}# Tasks\n\n- [ ] Alpha task\n- [ ] Beta task\n  ~~~\n  never closed\n`;
    const file = parseText(text);
    const ed = file.edit({ now: NOW });
    expect(unwritable(() => ed.addTask({ title: 'After the fence' })).hint).toContain('line 11');
    unwritable(() => ed.addLogEntry({ author: 'Robin', bullets: ['one'] }));
    unwritable(() => ed.moveTask(file.openTasks()[1]!, file.openTasks()[0]!));
    expect(file.toString()).toBe(text);
    // Ahead of the fence is fine: the file still reads back as the model says.
    ed.addTask({ title: 'Before the fence' }, file.openTasks()[1]!);
    expect(shape(file).open).toEqual(['Alpha task', 'Before the fence', 'Beta task']);
  });

  it('a task carrying a second "## Done" line cannot be moved above the real one', () => {
    const text = `${HEAD}# Tasks\n\n- [ ] Alpha\n\n## Done\n\n- [x] Beta (done 2026-10-01)\n## Done\nkept note under beta\n- [x] Gamma (done 2026-10-01)\n`;
    const file = parseText(text);
    const beta = file.doneTasks()[0]!;
    expect(beta.children).toEqual(['## Done', 'kept note under beta']);
    const ed = file.edit({ now: NOW });
    unwritable(() => ed.reopenTask(beta));
    expect(beta.checked).toBe(true);
    expect(beta.doneOn).toBe('2026-10-01');
    expect(file.toString()).toBe(text);
    ed.completeTask(file.openTasks()[0]!);
    expect(parseText(file.toString()).doneTasks().map((b) => [b.title, b.children])).toEqual([
      ['Alpha', []],
      ['Beta', ['## Done', 'kept note under beta']],
      ['Gamma', []],
    ]);
  });
});

describe('migration never writes a file that reads back differently', () => {
  it('a break whose detail would open a code fence is not used: the title is cut further on', () => {
    const long = 'Rework the importer so the nightly job stops failing: ~~~ is what the old parser emitted for every row it could not read';
    const file = parseText(`---\nname: Sample\n---\n\n# Tasks\n- [ ] ${long}\n- [ ] Second task\n- [ ] Third task\n\n# Session log\n\n## 2026-09-02 - Robin\n- Measured the roof\n`);
    const { text, report } = migrateFile(file);
    expect(report.tasks).toMatchObject({ open: 3, split: 0, cut: 1, leftLong: 0, short: 2 });
    const after = parseText(text).doc();
    expect(after.tasks.open.map((t) => t.title)).toEqual(['Rework the importer so the nightly job stops failing: ~~~ is what the old parser', 'Second task', 'Third task']);
    expect(after.tasks.open[0]!.detail).toEqual(['emitted for every row it could not read']);
    expect(after.log).toHaveLength(1);
  });

  it('a title whose every break would open a code fence is left long', () => {
    const long = `${'Reworktheimporter'.repeat(4)} ~~~${'x'.repeat(40)}`;
    const file = parseText(`---\nname: Sample\n---\n\n# Tasks\n- [ ] ${long}\n- [ ] Second task\n\n# Session log\n\n## 2026-09-02 - Robin\n- Measured the roof\n`);
    const { text, report } = migrateFile(file);
    expect(report.tasks).toMatchObject({ open: 2, split: 0, cut: 0, leftLong: 1, leftLongWhy: { collision: 0, noBreak: 0, fence: 1 }, short: 1 });
    const after = parseText(text).doc();
    expect(after.tasks.open.map((t) => t.title)).toEqual([long, 'Second task']);
    expect(after.log).toHaveLength(1);
  });

  it('a v2 file whose tidy-up would bury a section in an unclosed fence is skipped, untouched', () => {
    const text = '---\nname: Sample\n---\n\n# Tasks\n- [x] Finished already\n- [ ] Open task\n  ```\n  never closed\n';
    const { text: out, report } = migrateFile(parseText(text));
    expect(out).toBe(text);
    expect(report).toMatchObject({ changed: false, skipped: 'unwritable', keys: [], removed: [] });
  });
});
