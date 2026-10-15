import { describe, it, expect } from 'vitest';
import type { BlipFile } from '../../src/core/doc.js';
import { NOW, TODAY, V3, fixture, parse, parseText } from './fixtures.js';

/** title → the raw lines under it, for every task in the file. */
function ownership(file: BlipFile): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const b of [...file.openTasks(), ...file.doneTasks()]) out[b.title] = [...b.children];
  return out;
}

const find = (file: BlipFile, start: string) => [...file.openTasks(), ...file.doneTasks()].find((b) => b.title.startsWith(start))!;

/** Everything outside the first `# Tasks` section of children.md, which no task edit may touch. */
function outside(text: string): string {
  const start = text.indexOf('# Tasks');
  const end = text.indexOf('# Ideas');
  return text.slice(0, start) + text.slice(end);
}

describe('block ownership: children stay under their own title', () => {
  const original = fixture('v3/children.md');
  const before = ownership(parse('v3/children.md'));

  /** Run one edit, re-parse the result, and check every surviving task still owns exactly its own lines. */
  function check(run: (file: BlipFile) => void, expectOrder: { open: string[]; done: string[] }, gone: string[] = []): string {
    const file = parse('v3/children.md');
    run(file);
    const out = file.toString();
    const again = parseText(out);
    const after = ownership(again);
    for (const [title, children] of Object.entries(before)) {
      if (gone.some((g) => title.startsWith(g))) expect(after[title]).toBeUndefined();
      else expect(after[title], title).toEqual(children);
    }
    expect(again.openTasks().map((b) => b.title.slice(0, b.title.indexOf(':')))).toEqual(expectOrder.open);
    expect(again.doneTasks().map((b) => b.title.slice(0, b.title.indexOf(':')))).toEqual(expectOrder.done);
    expect(outside(out)).toBe(outside(original));
    // What was written is stable: reading it back and writing it again changes nothing.
    expect(again.toString()).toBe(out);
    return out;
  }

  it('add at top', () => {
    const out = check(
      (file) => {
        file.edit({ now: NOW }).addTask({ title: 'New: goes first', detail: ['new detail line', '- new bullet'] }, file.openTasks()[0]!);
      },
      { open: ['New', 'Alpha', 'Bravo', 'Charlie', 'Delta'], done: ['Echo', 'Foxtrot'] },
    );
    expect(out).toContain('- [ ] New: goes first\n  new detail line\n  - new bullet\n- [ ] Alpha: make the importer stream large files\n  alpha indented line\n');
  });

  it('add at the end', () => {
    const out = check(
      (file) => {
        file.edit({ now: NOW }).addTask({ title: 'New: goes last', due: '2026-12-24' });
      },
      { open: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'New'], done: ['Echo', 'Foxtrot'] },
    );
    expect(out).toContain('delta loose line\n- [ ] New: goes last (due 2026-12-24)\n\n## Done\n');
  });

  it('move to the top, to the end and into the middle', () => {
    check((file) => void file.edit({ now: NOW }).moveTask(find(file, 'Delta'), find(file, 'Alpha')), { open: ['Delta', 'Alpha', 'Bravo', 'Charlie'], done: ['Echo', 'Foxtrot'] });
    check((file) => void file.edit({ now: NOW }).moveTask(find(file, 'Alpha'), null), { open: ['Bravo', 'Charlie', 'Delta', 'Alpha'], done: ['Echo', 'Foxtrot'] });
    check((file) => void file.edit({ now: NOW }).moveTask(find(file, 'Bravo'), find(file, 'Delta')), { open: ['Alpha', 'Charlie', 'Bravo', 'Delta'], done: ['Echo', 'Foxtrot'] });
  });

  it('remove takes the whole block and hands it back', () => {
    let removed = '';
    const out = check(
      (file) => {
        removed = file.edit({ now: NOW }).removeTask(find(file, 'Bravo'));
      },
      { open: ['Alpha', 'Charlie', 'Delta'], done: ['Echo', 'Foxtrot'] },
      ['Bravo'],
    );
    expect(removed.split('\n')).toEqual(['- [ ] Bravo: add a progress bar', ...before['Bravo: add a progress bar']!]);
    expect(out).not.toContain('bravo');
    expect(out).toContain('alpha indented checkbox is detail, not a task\n- [ ] Charlie: write the help page\n');
  });

  it('complete moves the block to the top of Done, stamped, with its children', () => {
    const out = check(
      (file) => {
        expect(file.edit({ now: NOW }).completeTask(find(file, 'Delta'))).toBe(true);
      },
      { open: ['Alpha', 'Bravo', 'Charlie'], done: ['Delta', 'Echo', 'Foxtrot'] },
    );
    // The due tail is dropped when a task is completed.
    expect(out).toContain(`## Done\n\n- [x] Delta: time the importer on a slow disk (done ${TODAY})\n  delta indented line\ndelta loose line\n- [x] Echo: pick a file format (done 2026-09-30)\n`);
  });

  it('reopen returns the block to the end of the queue, unstamped, with its children', () => {
    const out = check(
      (file) => {
        expect(file.edit({ now: NOW }).reopenTask(find(file, 'Echo'))).toBe(true);
      },
      { open: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'], done: ['Foxtrot'] },
    );
    expect(out).toContain('delta loose line\n- [ ] Echo: pick a file format\n  echo indented line\necho loose line\n\n## Done\n\n- [x] Foxtrot: sketch the screen (done 2026-09-28)\n');
  });

  it('all five in one edit', () => {
    check(
      (file) => {
        const ed = file.edit({ now: NOW });
        ed.addTask({ title: 'New: first' }, find(file, 'Alpha'));
        ed.moveTask(find(file, 'Delta'), find(file, 'Bravo'));
        ed.removeTask(find(file, 'Charlie'));
        ed.completeTask(find(file, 'Alpha'));
        ed.reopenTask(find(file, 'Foxtrot'));
      },
      { open: ['New', 'Delta', 'Bravo', 'Foxtrot'], done: ['Alpha', 'Echo'] },
      ['Charlie'],
    );
  });
});

describe('out-of-place tasks are read correctly and put right by the next edit', () => {
  it('an unticked box under Done reads as open; a ticked box in the queue reads as done', () => {
    const doc = parse('v3/out-of-place.md').doc();
    expect(doc.tasks.open.map((t) => t.title)).toEqual(['Port the blog to the new template', 'Add a contact form', 'Check the site on a phone']);
    expect(doc.tasks.open.map((t) => t.n)).toEqual([1, 2, 3]);
    expect(doc.tasks.done.map((t) => t.title)).toEqual(['Publish the new home page', 'Compress the hero image', 'Choose the typeface', 'Buy the domain']);
    expect(doc.problems.map((p) => [p.code, p.line])).toEqual([
      ['done-in-queue', 11],
      ['done-in-queue', 14],
      ['open-in-done', 19],
    ]);
  });

  it('the next edit moves both, with their children, and stamps the ticked ones', () => {
    const file = parse('v3/out-of-place.md');
    const ed = file.edit({ now: NOW });
    ed.addTask({ title: 'Write the about page' });
    expect(ed.corrections).toEqual({ doneInQueue: 2, openInDone: 1 });
    const out = file.toString();
    expect(out.slice(out.indexOf('# Tasks'), out.indexOf('# Session log'))).toBe(
      [
        '# Tasks',
        '',
        '- [ ] Port the blog to the new template',
        '  blog child line',
        '- [ ] Add a contact form',
        '- [ ] Check the site on a phone',
        '  phone child line',
        'phone loose line',
        '- [ ] Write the about page',
        '',
        '## Done',
        '',
        `- [x] Publish the new home page (done ${TODAY})`,
        '  home page child line',
        `- [x] Compress the hero image (done ${TODAY})`,
        '- [x] Choose the typeface (done 2026-09-20)',
        '- [x] Buy the domain (done 2026-09-12)',
        '  domain child line',
        '',
        '',
      ].join('\n'),
    );
    expect(parseText(out).doc().problems).toEqual([]);
  });

  it('a write that only touches the header or the log can ask for the same correction', () => {
    const file = parse('v3/out-of-place.md');
    const ed = file.edit({ now: NOW });
    ed.setField('status', 'paused');
    expect(ed.tidy()).toBe(true);
    expect(ed.corrections).toEqual({ doneInQueue: 2, openInDone: 1 });
    expect(parseText(file.toString()).doc().problems).toEqual([]);

    const clean = parse('v3/full.md');
    expect(clean.edit({ now: NOW }).tidy()).toBe(false);
    expect(clean.toString()).toBe(fixture('v3/full.md'));
    const bare = parse('v3/minimal.md');
    expect(bare.edit({ now: NOW }).tidy()).toBe(false);
    expect(bare.toString()).toBe(fixture('v3/minimal.md'));
  });

  it('an edit session that changes nothing leaves the bytes alone, out-of-place tasks included', () => {
    const file = parse('v3/out-of-place.md');
    const ed = file.edit({ now: NOW });
    expect(ed.setField('name', 'Quill Site')).toBe(false);
    expect(ed.completeTask(file.doneTasks()[0]!)).toBe(false);
    expect(ed.reopenTask(file.openTasks()[0]!)).toBe(false);
    expect(file.toString()).toBe(fixture('v3/out-of-place.md'));
  });
});

describe('task edits', () => {
  it('a move to where the task already is changes nothing', () => {
    const file = parse('v3/full.md');
    const [first, second] = file.openTasks();
    const ed = file.edit({ now: NOW });
    expect(ed.moveTask(first!, second!)).toBe(false);
    expect(ed.moveTask(file.openTasks()[3]!, null)).toBe(false);
    expect(file.toString()).toBe(fixture('v3/full.md'));
  });

  it('adding then removing a task returns every fixture to its settled bytes', () => {
    for (const rel of V3) {
      const settled = parse(rel);
      settled.edit({ now: NOW }).removeTask(settled.edit({ now: NOW }).addTask({ title: 'Temporary' }));
      const once = settled.toString();
      const again = parseText(once);
      again.edit({ now: NOW }).removeTask(again.edit({ now: NOW }).addTask({ title: 'Temporary' }));
      expect(again.toString(), rel).toBe(once);
    }
  });

  it('a write tightens blank lines between tasks; a blank line inside a task stays', () => {
    const file = parseText('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] One\n  first paragraph\n\n  second paragraph\n\n- [ ] Two\n\n\n- [ ] Three\n');
    expect(file.toString()).toContain('- [ ] Two\n\n\n- [ ] Three\n');
    file.edit({ now: NOW }).addTask({ title: 'Four' });
    expect(file.toString()).toBe('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] One\n  first paragraph\n\n  second paragraph\n- [ ] Two\n- [ ] Three\n- [ ] Four\n');
  });

  it('creates # Tasks immediately before the log when the file has none', () => {
    const file = parseText('---\nblip: 3\n---\n\n# Plan\n\nSome prose.\n\n# Session log\n\n## 2026-10-01 09:00 — Robin\n- Started\n');
    file.edit({ now: NOW }).addTask({ title: 'First task' });
    expect(file.toString()).toBe('---\nblip: 3\n---\n\n# Plan\n\nSome prose.\n\n# Tasks\n\n- [ ] First task\n\n# Session log\n\n## 2026-10-01 09:00 — Robin\n- Started\n');
  });

  it('creates # Tasks at the end of the file when there is no log', () => {
    const file = parse('v3/minimal.md');
    file.edit({ now: NOW }).addTask({ title: 'First task' });
    expect(file.toString()).toBe('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] First task\n');

    const tight = parseText('---\nblip: 3\n---\n# Notes\nno newline at the end');
    tight.edit({ now: NOW }).addTask({ title: 'First task' });
    expect(tight.toString()).toBe('---\nblip: 3\n---\n# Notes\nno newline at the end\n\n# Tasks\n\n- [ ] First task\n');
  });

  it('creates ## Done the first time a task is completed', () => {
    const file = parseText('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Only task (due 2026-11-01)\n  with detail\n');
    file.edit({ now: NOW }).completeTask(file.openTasks()[0]!);
    expect(file.toString()).toBe(`---\nblip: 3\n---\n\n# Tasks\n\n## Done\n\n- [x] Only task (done ${TODAY})\n  with detail\n`);
  });

  it('a title or detail line can never forge a heading or a second task', () => {
    const file = parse('v3/minimal.md');
    file.edit({ now: NOW }).addTask({ title: 'Real task\n- [ ] forged task\n# Session log', detail: ['line one\n## Done\n- [x] forged'] });
    const doc = parseText(file.toString()).doc();
    expect(doc.tasks.open).toHaveLength(1);
    expect(doc.tasks.done).toHaveLength(0);
    expect(doc.log).toHaveLength(0);
    expect(doc.tasks.open[0]!.title).toBe('Real task - [ ] forged task # Session log');
  });

  it('editing replaces title, due and detail, and hands back the block whose detail it replaced', () => {
    const file = parse('v3/full.md');
    const ed = file.edit({ now: NOW });
    const cert = file.openTasks()[1]!;
    const old = ed.editTask(cert, { title: 'Renew the certificate', due: null, detail: ['New detail'] });
    expect(old).toBe('- [ ] Renew the signing certificate (due 2026-10-31)\n  The current one expires on the first of November.');
    expect(ed.editTask(file.openTasks()[2]!, { due: '2026-12-01' })).toBeNull();
    const out = file.toString();
    expect(out).toContain('- [ ] Renew the certificate\n  New detail\n- [ ] Write the release notes for 4.2 (due 2026-12-01)\n');
  });

  it('keeps CRLF line endings and the BOM through a task edit', () => {
    const crlf = parse('v3/crlf.md');
    crlf.edit({ now: NOW }).addTask({ title: 'Added on Windows', detail: ['with detail'] }, crlf.openTasks()[0]!);
    const out = crlf.toString();
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(out).toContain('# Tasks\r\n\r\n- [ ] Added on Windows\r\n  with detail\r\n- [ ] Enter the winter timetable\r\n');
    expect(out.endsWith('Windows line endings all the way down.\r\n')).toBe(true);

    const bom = parse('v3/bom.md');
    bom.edit({ now: NOW }).completeTask(bom.openTasks()[0]!);
    expect(bom.toString().charCodeAt(0)).toBe(0xfeff);
    expect(parseText(bom.toString()).doc().tasks.done).toHaveLength(2);
  });
});

describe('frontmatter edits', () => {
  it('two consecutive no-op writes are byte-identical', () => {
    const file = parse('v3/full.md');
    const ed = file.edit({ now: NOW });
    for (let i = 0; i < 2; i++) {
      expect(ed.setField('now', 'Sync is merged but switched off until the conflict screen is designed.')).toBe(false);
      expect(ed.setField('status', 'blocked')).toBe(false);
      expect(ed.setField('focus', true)).toBe(false);
      expect(ed.setField('tags', ['Product', 'mobile'])).toBe(false);
      expect(file.toString()).toBe(fixture('v3/full.md'));
    }
  });

  it('re-serialises in canonical key order and keeps unknown keys, in their order, after the managed ones', () => {
    const file = parseText('---\nzeta: 1\nname: Order Test\nblip: 3\ncreated: 2026-01-01\nalpha: "kept: verbatim"\n---\n\n# Tasks\n');
    const ed = file.edit({ now: NOW });
    ed.setField('tags', ['Client Work', 'web', 'WEB']);
    ed.setField('now', 'Waiting on: the client');
    ed.setField('due', '2026-12-01');
    ed.setField('focus', true);
    ed.setField('status', 'paused');
    expect(file.toString()).toBe(
      '---\nblip: 3\nname: Order Test\nnow: "Waiting on: the client"\nstatus: paused\nfocus: true\ndue: 2026-12-01\ntags: [client-work, web]\nzeta: 1\ncreated: 2026-01-01\nalpha: "kept: verbatim"\n---\n\n# Tasks\n',
    );
    const doc = parseText(file.toString()).doc();
    expect(doc).toMatchObject({ now: 'Waiting on: the client', status: 'paused', focus: true, due: '2026-12-01', tags: ['client-work', 'web'] });
  });

  it('focus is never written as false, and null removes a key', () => {
    const file = parse('v3/full.md');
    const ed = file.edit({ now: NOW });
    expect(ed.setField('focus', false)).toBe(true);
    expect(ed.setField('due', null)).toBe(true);
    expect(ed.setField('tags', [])).toBe(true);
    const out = file.toString();
    expect(out).not.toMatch(/^focus:/m);
    expect(out).not.toMatch(/^due:/m);
    expect(out).not.toMatch(/^tags:/m);
    expect(out).toContain('created: 2026-03-02\nowner_note: "kept: exactly as written"\n---\n');
    // The body is untouched by a frontmatter edit.
    expect(out.slice(out.indexOf('\n# Tasks'))).toBe(fixture('v3/full.md').slice(fixture('v3/full.md').indexOf('\n# Tasks')));
  });

  it('keeps CRLF in re-serialised frontmatter', () => {
    const file = parse('v3/crlf.md');
    file.edit({ now: NOW }).setField('status', 'paused');
    const out = file.toString();
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(out.startsWith('---\r\nblip: 3\r\nname: Ferry Timetable\r\nnow: Summer times are in; winter times arrive in November.\r\nstatus: paused\r\ntags: [travel]\r\n---\r\n')).toBe(true);
  });
});

describe('log edits', () => {
  it('inserts a new entry directly under the heading and leaves every existing line alone', () => {
    const file = parse('v3/full.md');
    file.edit({ now: NOW }).addLogEntry({ author: 'Robin + Claude', bullets: ['Designed the conflict screen', 'Switched sync on for the test group'] });
    const original = fixture('v3/full.md');
    const at = original.indexOf('## 2026-10-11 16:48');
    expect(file.toString()).toBe(
      `${original.slice(0, at)}## ${TODAY} 14:05 — Robin + Claude\n- Designed the conflict screen\n- Switched sync on for the test group\n\n${original.slice(at)}`,
    );
  });

  it('keeps hand-written text between the heading and the first entry above the new entry', () => {
    const file = parse('v3/log-shapes.md');
    file.edit({ now: NOW }).addLogEntry({ author: 'Robin', bullets: ['Exported a WAV'] });
    const original = fixture('v3/log-shapes.md');
    const at = original.indexOf('## 2026-10-03 14:05');
    expect(file.toString()).toBe(`${original.slice(0, at)}## ${TODAY} 14:05 — Robin\n- Exported a WAV\n\n${original.slice(at)}`);
    expect(parseText(file.toString()).doc().log).toHaveLength(8);
  });

  it('creates # Session log at the end of the file when there is none', () => {
    const file = parse('v3/due-friday.md');
    file.edit({ now: NOW }).addLogEntry({ author: 'Robin', bullets: ['Ordered the seeds'] });
    expect(file.toString()).toBe(`${fixture('v3/due-friday.md')}\n# Session log\n\n## ${TODAY} 14:05 — Robin\n- Ordered the seeds\n`);
  });

  it('two entries may share a heading; nothing is merged', () => {
    const file = parse('v3/minimal.md');
    const ed = file.edit({ now: NOW });
    ed.addLogEntry({ author: 'Robin', bullets: ['First'] });
    ed.addLogEntry({ author: 'Robin', bullets: ['Second'] });
    const doc = parseText(file.toString()).doc();
    expect(doc.log.map((e) => e.bullets)).toEqual([['Second'], ['First']]);
    expect(doc.log[0]!.heading).toBe(doc.log[1]!.heading);
  });

  it('a bullet or an author can never forge a heading', () => {
    const file = parse('v3/minimal.md');
    file.edit({ now: NOW }).addLogEntry({ author: 'Robin\n## 2020-01-01 — forged', bullets: ['one\n## 2020-01-01 — forged\n# Tasks\n- [ ] forged'] });
    const doc = parseText(file.toString()).doc();
    expect(doc.log).toHaveLength(1);
    expect(doc.tasks.open).toHaveLength(0);
    expect(doc.log[0]!.date).toBe(TODAY);
  });
});
