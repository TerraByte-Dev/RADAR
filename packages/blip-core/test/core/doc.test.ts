import { describe, it, expect } from 'vitest';
import { BlipError } from '../../src/core/schema.js';
import { LINT, NOW, READONLY, V2, V3, fixture, parse, parseText } from './fixtures.js';

describe('round trip', () => {
  it.each(V3)('%s: parseBlip(x).toString() === x', (rel) => {
    const text = fixture(rel);
    const file = parse(rel);
    expect(file.toString()).toBe(text);
    expect(file.schema).toBe(3);
    expect(file.writable).toBe(true);
  });

  it.each([...V2, ...READONLY, ...LINT])('%s: a file the engine cannot write is still reproduced byte for byte', (rel) => {
    expect(parse(rel).toString()).toBe(fixture(rel));
  });

  it('the line-ending and BOM fixtures really hold what their names say', () => {
    expect(fixture('v3/crlf.md')).toMatch(/\r\n/);
    expect(fixture('v3/crlf.md').replace(/\r\n/g, '')).not.toMatch(/\n/);
    expect(fixture('v3/bom.md').charCodeAt(0)).toBe(0xfeff);
    expect(fixture('v3/no-trailing-newline.md').endsWith('\n')).toBe(false);
    expect(Buffer.byteLength(fixture('v2/big-83kb.md'))).toBeGreaterThan(83 * 1024 - 1024);
  });

  it.each(['', '\n', '---', '---\n', '# Tasks', '- [ ] loose', '\uFEFF', '---\n: :\n---\n', '```\n# Tasks\n- [ ] in a fence that never closes'])(
    'never throws and loses nothing on odd input %j',
    (text) => {
      const file = parseText(text);
      expect(file.toString()).toBe(text);
      expect(() => file.doc()).not.toThrow();
    },
  );
});

describe('read model of a v3 file', () => {
  const doc = parse('v3/full.md').doc();

  it('reads the managed fields', () => {
    expect(doc).toMatchObject({
      schema: 3,
      name: 'Lantern Notes',
      nameSource: 'file',
      now: 'Sync is merged but switched off until the conflict screen is designed.',
      status: 'blocked',
      focus: true,
      due: '2026-11-18',
      tags: ['product', 'mobile'],
      writable: true,
      problems: [],
    });
  });

  it('keeps only web and mail links, with their labels', () => {
    expect(doc.links).toEqual([
      { label: 'Repo', url: 'https://example.com/lantern/notes' },
      { label: null, url: 'https://lantern.example.com' },
    ]);
  });

  it('reads tasks as title, detail, due and done stamp', () => {
    expect(doc.tasks.open.map((t) => [t.n, t.title, t.due])).toEqual([
      [1, 'Design the conflict screen so sync can be switched on', null],
      [2, 'Renew the signing certificate', '2026-10-31'],
      [3, 'Write the release notes for 4.2', null],
      [4, 'Robin: approve the wording in PR #21', null],
    ]);
    expect(doc.tasks.open[0]!.detail).toEqual([
      'Sync is merged behind the `sync_v2` flag.',
      'Two sketches are in design/conflicts.md.',
      '- Then flip the flag for the test group',
      '- Watch the error log for a day',
    ]);
    expect(doc.next).toEqual(doc.tasks.open[0]);
    expect(doc.tasks.done.map((t) => [t.n, t.done, t.title, t.doneOn])).toEqual([
      [null, true, 'Merge the sync engine behind a flag', '2026-10-11'],
      [null, true, 'Move the backlog out of the old tracker', '2026-10-06'],
    ]);
    expect(doc.tasks.open[0]!.key).toMatch(/^[0-9a-f]{8}$/);
  });

  it('reads the log in file order with parsed headings', () => {
    expect(doc.log.map((e) => [e.heading, e.date, e.time, e.author, e.bullets.length])).toEqual([
      ['2026-10-11 16:48 — Robin + Claude', '2026-10-11', '16:48', 'Robin + Claude', 3],
      ['2026-10-06 09:12 — Robin + Claude', '2026-10-06', '09:12', 'Robin + Claude', 2],
    ]);
    expect(doc.lastLogAt).toBe(new Date(2026, 9, 11, 16, 48).toISOString());
  });

  it('falls back to the folder name without ever inventing one', () => {
    const bare = parse('v3/minimal.md').doc();
    expect(bare.name).toBe('sample-folder');
    expect(bare.nameSource).toBe('folder');
    expect(bare.now).toBeNull();
    expect(bare.status).toBe('active');
    expect(bare.focus).toBe(false);
    expect(bare.next).toBeNull();
    expect(bare.lastLogAt).toBeNull();
  });

  it('reads an unknown status as active and a non-date due as none', () => {
    const d = parseText('---\nblip: 3\nstatus: on-fire\ndue: next week\nfocus: yes please\n---\n').doc();
    expect(d.status).toBe('active');
    expect(d.due).toBeNull();
    expect(d.focus).toBe(false);
  });

  it('gives equal titles in one list distinct keys', () => {
    const d = parseText('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Call back\n- [ ] call  back.\n- [ ] Call back\n').doc();
    const [a, b, c] = d.tasks.open.map((t) => t.key);
    expect(b).toBe(`${a}~2`);
    expect(c).toBe(`${a}~3`);
  });
});

describe('what counts as a task', () => {
  const file = parse('v3/children.md');
  const doc = file.doc();

  it('only column-0 checkboxes in the first # Tasks section, outside code fences', () => {
    expect(doc.tasks.open.map((t) => t.title)).toEqual([
      'Alpha: make the importer stream large files',
      'Bravo: add a progress bar',
      'Charlie: write the help page',
      'Delta: time the importer on a slow disk',
    ]);
    expect(doc.tasks.done.map((t) => t.title)).toEqual(['Echo: pick a file format', 'Foxtrot: sketch the screen']);
  });

  it('every line under a title belongs to that task: indented, blank, loose, headings, fences', () => {
    expect(doc.tasks.open[0]!.detail).toEqual([
      'alpha indented line',
      '- alpha bullet',
      '  - alpha nested bullet',
      'alpha tab-indented line',
      '',
      'alpha line after a blank',
      'alpha loose line at column 0',
      '## Alpha heading that is not Done',
      '- [ ] alpha indented checkbox is detail, not a task',
    ]);
    expect(doc.tasks.open[1]!.detail).toContain('- [ ] bravo fenced checkbox');
    expect(doc.tasks.open[1]!.detail).toContain('## Done');
    expect(doc.tasks.open[3]!.detail).toEqual(['delta indented line', 'delta loose line']);
    expect(doc.tasks.done[0]!.detail).toEqual(['echo indented line', 'echo loose line']);
  });
});

describe('(due …) tails', () => {
  const doc = parse('v3/due-friday.md').doc();

  it('(due friday) yields due: null and due-not-iso, and the title text is unchanged', () => {
    expect(doc.tasks.open[0]).toMatchObject({ title: 'Order the seeds (due friday)', due: null });
    expect(doc.problems.filter((p) => p.code === 'due-not-iso').map((p) => p.line)).toEqual([9, 10]);
  });

  it('a date that is not on the calendar is title text too', () => {
    expect(doc.tasks.open[1]).toMatchObject({ title: 'Book the skip (due 2026-02-31)', due: null });
  });

  it('only a strict ISO tail is a due date', () => {
    expect(doc.tasks.open[2]).toMatchObject({ title: 'Lay the path', due: '2026-11-05' });
    expect(doc.tasks.done[0]).toMatchObject({ title: 'Dig the beds', due: '2026-09-01', doneOn: '2026-09-03' });
  });
});

describe('log views', () => {
  const doc = parse('v3/log-shapes.md').doc();
  const byHeading = (h: string) => doc.log.find((e) => e.heading === h)!;

  it('an entry runs from its heading to the next one; a heading inside a code fence is body text', () => {
    expect(doc.log.map((e) => e.heading)).toEqual([
      '2026-10-03 14:05 — Robin + Claude',
      '2026-08-15 (later) — tidy-up pass',
      '2026-07-24/25 — Robin + Quill',
      '2026-07-24 — Robin',
      '2026-07-24 — Robin',
      'Kickoff notes',
      '2026-06-30 · Robin',
    ]);
    expect(byHeading('Kickoff notes').lines).toContain('## 2026-01-01 this heading is inside a code fence');
    expect(byHeading('Kickoff notes').bullets).toEqual([]);
  });

  it('joins wrapped continuation lines into one bullet and leaves the raw lines alone', () => {
    const e = doc.log[0]!;
    expect(e.bullets).toEqual(['Fixed the level meter so it no longer clips at the top of the scale, and added a test for it', 'Renamed the export menu']);
    expect(e.lines).toEqual(['- Fixed the level meter so it no longer clips', '  at the top of the scale, and added a test', '  for it', '- Renamed the export menu']);
  });

  it('parses what it can from an odd heading and leaves the rest null', () => {
    expect(byHeading('2026-08-15 (later) — tidy-up pass')).toMatchObject({ date: '2026-08-15', time: null, author: 'tidy-up pass' });
    expect(byHeading('2026-07-24/25 — Robin + Quill')).toMatchObject({ date: '2026-07-24', time: null, author: 'Robin + Quill' });
    expect(byHeading('Kickoff notes')).toMatchObject({ date: null, time: null, author: null });
    expect(byHeading('2026-06-30 · Robin')).toMatchObject({ date: '2026-06-30', author: 'Robin', bullets: ['Star bullets are read too'] });
  });
});

describe('lastLogAt', () => {
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const text = `---\nblip: 3\n---\n\n# Session log\n\n## ${today} — Robin\n- Something today\n\n## 2026-01-05 — Robin\n- Something long ago\n`;

  it('a date-only entry dated today is not later than the supplied mtime', () => {
    const mtime = new Date(Date.now() - 60_000);
    const at = parseText(text, mtime).doc().lastLogAt!;
    expect(new Date(at).getTime()).toBeLessThanOrEqual(mtime.getTime());
    expect(new Date(at).getTime()).toBe(mtime.getTime());
  });

  it('without an mtime the clamp is the end of the day', () => {
    const at = new Date(parseText(text).doc().lastLogAt!);
    expect([at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([23, 59, 59]);
  });

  it('is the latest entry wherever it sits in the section', () => {
    const stray = '---\nblip: 3\n---\n\n# Session log\n\n## 2026-03-01 10:00 — Robin\n- newer by position\n\n## 2026-09-09 08:30 — an old tool\n- appended at the bottom\n';
    expect(parseText(stray).doc().lastLogAt).toBe(new Date(2026, 8, 9, 8, 30).toISOString());
  });
});

describe('frontmatter recognition', () => {
  it('---\\n---\\n is recognised as empty frontmatter', () => {
    const file = parseText('---\n---\n# Tasks\n- [ ] one\n');
    expect(file.state.fmBlock).toBe('---\n---\n');
    expect(file.state.fmRaw).toBe('');
    expect(file.state.fmError).toBeNull();
    expect(file.doc().tasks.open.map((t) => t.title)).toEqual(['one']);
  });

  it('a file with no frontmatter at all is a v2 file', () => {
    const file = parse('v2/no-frontmatter.md');
    expect(file.state.fmBlock).toBeNull();
    expect(file.schema).toBe(2);
  });
});

describe('tolerant read of v2 files', () => {
  it.each(V2)('%s parses as schema 2, read-only, without throwing', (rel) => {
    const file = parse(rel);
    const doc = file.doc();
    expect(doc.schema).toBe(2);
    expect(doc.writable).toBe(false);
    expect(file.readOnly).toBe('E_NEEDS_MIGRATE');
    expect(doc.problems.map((p) => p.code)).toContain('schema-v2');
  });

  it('category leads the tags, operation follows, existing tags are slugged and de-duplicated', () => {
    expect(parse('v2/interleaved-done.md').doc().tags).toEqual(['product', 'hardware', 'workshop', 'low-power']);
    expect(parse('v2/legacy-enums.md').doc().tags).toEqual(['client-work', 'web', 'moss-vale']);
    expect(parse('v2/next-action-done.md').doc().tags).toEqual([]);
  });

  it('deadline reads as due, truncated to its date; one that is not a date reads as none', () => {
    expect(parse('v2/interleaved-done.md').doc().due).toBe('2026-09-08');
    expect(parse('v2/big-83kb.md').doc().due).toBe('2026-09-08');
    const bad = parse('v2/next-action-new-no-tasks.md').doc();
    expect(bad.due).toBeNull();
    expect(bad.problems.map((p) => p.code)).toContain('due-not-iso');
  });

  it('shipped reads as archived and an unknown status as active', () => {
    expect(parse('v2/next-action-done.md').doc().status).toBe('archived');
    expect(parse('v2/next-action-new-no-tasks.md').doc().status).toBe('active');
    expect(parse('v2/log-mixed.md').doc().status).toBe('paused');
  });

  it('horizon and priority are ignored, whatever they hold', () => {
    const doc = parse('v2/legacy-enums.md').doc();
    expect(doc).not.toHaveProperty('horizon');
    expect(doc).not.toHaveProperty('priority');
    expect(doc.focus).toBe(false);
    expect(doc.now).toBeNull();
  });

  it('a missing name falls back to the folder', () => {
    expect(parse('v2/next-action-new-no-tasks.md').doc()).toMatchObject({ name: 'sample-folder', nameSource: 'folder' });
  });

  it('next_action is shown as open task 1 unless a task, open or done, already says it', () => {
    const fresh = parse('v2/next-action-new-no-tasks.md').doc();
    expect(fresh.tasks.open).toHaveLength(1);
    expect(fresh.next).toMatchObject({ n: 1 });
    expect(fresh.next!.title).toMatch(/^Read the three papers on tidal modelling/);
    // Read does not split titles.
    expect(fresh.next!.title.length).toBeGreaterThan(80);

    const matched = parse('v2/next-action-done.md').doc();
    expect(matched.tasks.open.map((t) => t.title)).toEqual(['Add the 2027 data']);
  });

  it('interleaved ticked boxes read as done, the rest as open, each with its own children', () => {
    const doc = parse('v2/interleaved-done.md').doc();
    expect(doc.tasks.open.map((t) => t.title)).toEqual(['Measure standby current', 'Write the boil-dry cutoff', 'Print the case']);
    expect(doc.tasks.done.map((t) => t.title)).toEqual(['Pick the microcontroller', 'Order the relay board', 'Solder the prototype']);
    expect(doc.tasks.done[2]!.detail).toEqual(['loose note about the prototype']);
    expect(doc.tasks.open[2]!.due).toBe('2026-10-20');
    // In a v2 file a ticked box in the queue is normal, not a problem.
    expect(doc.problems.map((p) => p.code)).not.toContain('done-in-queue');
  });

  it('presents the log newest first as a view, without touching the file', () => {
    const file = parse('v2/log-ascending-33.md');
    const dates = file.doc().log.map((e) => e.date!);
    expect(dates).toHaveLength(33);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(file.toString()).toBe(fixture('v2/log-ascending-33.md'));
  });
});

describe('read-only files: no edit API can change their bytes', () => {
  const cases: [string, string][] = [
    ['readonly/broken-yaml.md', 'E_UNWRITABLE'],
    ['readonly/newer-schema.md', 'E_NEWER_SCHEMA'],
    ...V2.map((rel): [string, string] => [rel, 'E_NEEDS_MIGRATE']),
  ];

  it.each(cases)('%s refuses every edit with %s', (rel, code) => {
    const file = parse(rel);
    expect(file.writable).toBe(false);
    expect(file.doc().writable).toBe(false);
    let thrown: unknown;
    try {
      file.edit({ now: NOW });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BlipError);
    expect((thrown as BlipError).code).toBe(code);
    expect((thrown as BlipError).hint).toBeTruthy();
    expect(file.toString()).toBe(fixture(rel));
  });

  it('the v2 refusal tells the owner what to run', () => {
    expect(() => parse('v2/crlf.md').edit({ now: NOW })).toThrow(/v2 format/);
    try {
      parse('v2/crlf.md').edit({ now: NOW });
    } catch (err) {
      expect((err as BlipError).hint).toBe('this file is in the v2 format — the owner runs "radar-blip migrate" once');
    }
  });

  it('broken YAML is still read as far as it can be, and reported with its line', () => {
    const doc = parse('readonly/broken-yaml.md').doc();
    expect(doc.tasks.open.map((t) => t.title)).toEqual(['This task can be read but the file cannot be written']);
    expect(doc.log).toHaveLength(1);
    const [problem] = doc.problems;
    expect(problem).toMatchObject({ code: 'yaml-invalid', severity: 'error' });
    expect(problem!.line).toBeGreaterThan(1);
  });

  it('a newer schema is read with the fields this version knows', () => {
    const doc = parse('readonly/newer-schema.md').doc();
    expect(doc).toMatchObject({ name: 'From The Future', writable: false });
    expect(doc.problems).toEqual([expect.objectContaining({ code: 'schema-newer', severity: 'error', line: 2 })]);
  });
});
