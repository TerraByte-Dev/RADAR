import { describe, it, expect } from 'vitest';
import type { BlipFile } from '../../src/core/doc.js';
import { rawEntries } from '../../src/core/log.js';
import { migrateFile, splitOptions, splitTitle } from '../../src/core/normalize.js';
import { measure } from '../../src/core/schema.js';
import { LINT, NOW, READONLY, V2, V3, fixture, parse, parseText } from './fixtures.js';

const migrate = (rel: string) => migrateFile(parse(rel));
const migrated = (rel: string): BlipFile => parseText(migrate(rel).text);

/** The frontmatter lines of a text, without the `---` delimiters. */
function fmLines(text: string): string[] {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n?---\r?\n/.exec(text);
  return m && m[1] ? m[1].split(/\r?\n/) : [];
}

/** Keys v2 understood and v3 renames or drops; every other top-level key must survive verbatim. */
const V2_KEYS = ['name', 'horizon', 'priority', 'category', 'status', 'next_action', 'deadline', 'radar_angle', 'operation', 'last_session', 'tags', 'links'];

describe('migration is idempotent', () => {
  it.each(V2)('%s: migrateFile on its own output changes zero bytes', (rel) => {
    const first = migrate(rel);
    expect(first.report.changed).toBe(true);
    const second = migrateFile(parseText(first.text));
    expect(second.text).toBe(first.text);
    expect(second.report).toMatchObject({ changed: false, skipped: 'already-v3', from: 3 });
  });

  it.each(V3)('%s: a v3 file is a no-op', (rel) => {
    const { text, report } = migrate(rel);
    expect(text).toBe(fixture(rel));
    expect(report).toMatchObject({ changed: false, skipped: 'already-v3' });
  });

  it.each(READONLY)('%s: a file that cannot be written safely comes back untouched', (rel) => {
    const { text, report } = migrate(rel);
    expect(text).toBe(fixture(rel));
    expect(report.changed).toBe(false);
    expect(report.skipped).toBe(rel.includes('broken') ? 'unwritable' : 'newer-schema');
  });

  it('never throws on any fixture, lint fixtures included', () => {
    for (const rel of LINT) {
      const once = migrate(rel).text;
      expect(migrateFile(parseText(once)).text, rel).toBe(once);
    }
  });
});

describe('a migrated file is a clean v3 file', () => {
  it.each(V2)('%s', (rel) => {
    const out = migrate(rel).text;
    const file = parseText(out);
    expect(file.schema).toBe(3);
    expect(file.writable).toBe(true);
    expect(fmLines(out)[0]).toBe('blip: 3');
    expect(file.toString()).toBe(out);
    const codes = file.doc().problems.map((p) => p.code);
    for (const code of ['schema-v2', 'yaml-invalid', 'done-in-queue', 'open-in-done']) expect(codes).not.toContain(code);
    // The engine's own layout is a fixed point: a real edit and its undo give back the same bytes.
    const ed = file.edit({ now: NOW });
    ed.removeTask(ed.addTask({ title: 'Temporary' }));
    expect(file.toString()).toBe(out);
  });

  it('keeps CRLF line endings and the BOM', () => {
    const crlf = migrate('v2/crlf.md').text;
    expect(crlf).toMatch(/\r\n/);
    expect(crlf.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(migrate('v2/bom.md').text.charCodeAt(0)).toBe(0xfeff);
  });
});

describe('lossless', () => {
  it.each(V2)('%s: every split is title + " " + detail[0] === the original text', (rel) => {
    const before = parse(rel);
    const { report } = migrate(rel);
    const after = migrated(rel);
    // Open tasks keep their order; a promoted next_action is the one extra, at the head.
    const originals = before.openTasks().map((b) => ({ title: b.title, due: b.due, children: b.children }));
    if (report.nextAction === 'promote') originals.unshift({ title: String(before.state.values.next_action), due: null, children: [] });
    const now = after.openTasks();
    expect(now).toHaveLength(originals.length);
    let split = 0;
    originals.forEach((orig, i) => {
      const b = now[i]!;
      expect(b.due).toBe(orig.due);
      if (b.title === orig.title) {
        expect(b.children).toEqual(orig.children);
        return;
      }
      split++;
      expect(b.children[0]!.startsWith('  ')).toBe(true);
      expect(`${b.title} ${b.children[0]!.slice(2)}`).toBe(orig.title);
      expect(measure(b.title)).toBeLessThanOrEqual(80);
      expect(b.children.slice(1)).toEqual(orig.children);
    });
    expect(split).toBe(report.tasks.split + report.tasks.cut);
  });

  it.each(V2)('%s: done tasks keep their text, their children and their order, and gain no date', (rel) => {
    const before = parse(rel).doneTasks();
    const after = migrated(rel).doneTasks();
    expect(after.map((b) => [b.title, b.due, b.doneOn, b.children])).toEqual(before.map((b) => [b.title, b.due, null, b.children]));
  });

  it.each(V2)('%s: every unknown frontmatter key is byte-identical, created included', (rel) => {
    const keep = fmLines(fixture(rel)).filter((l) => /^[A-Za-z_]+:/.test(l) && !V2_KEYS.includes(l.slice(0, l.indexOf(':'))));
    const out = fmLines(migrate(rel).text);
    expect(out.filter((l) => keep.includes(l))).toEqual(keep);
  });

  it('created is left in place', () => {
    for (const rel of ['v2/interleaved-done.md', 'v2/big-83kb.md', 'v2/caps-label-1200.md']) {
      const { text, report } = migrate(rel);
      expect(fmLines(text).filter((l) => l.startsWith('created:'))).toEqual(fmLines(fixture(rel)).filter((l) => l.startsWith('created:')));
      expect(report.kept.map((k) => k.key)).toEqual(['created']);
    }
  });

  it.each(V2)('%s: every section the engine does not manage is byte-identical', (rel) => {
    const before = parse(rel);
    const { text: out, report } = migrate(rel);
    let from = 0;
    for (const sec of before.state.sections) {
      if (sec.kind !== 'raw' || sec.heading === null) continue;
      // The empty v2 skeleton is removed on purpose: a Notes section holding the placeholder comment and nothing else.
      const skeleton = /^# Notes\r?\n(?:\s*\r?\n)?<!-- Human-only\.[^>]*-->\s*$/.test(sec.text);
      if (skeleton && report.removed.includes('empty # Notes section')) continue;
      const at = out.indexOf(sec.text, from);
      expect(at, sec.heading).toBeGreaterThanOrEqual(0);
      from = at + sec.text.length;
    }
  });

  it.each(V2)('%s: every log entry is byte-identical and only its position changed', (rel) => {
    const key = (file: BlipFile) => (file.logSection ? rawEntries(file.logSection).map((e) => e.lines.join('\n')) : []);
    const before = key(parse(rel));
    const after = key(migrated(rel));
    expect([...after].sort()).toEqual([...before].sort());
  });
});

describe('title split', () => {
  const after = migrated('v2/split-guards.md');
  const task = (start: string) => after.openTasks().find((b) => b.title.startsWith(start))!;

  it('does not split inside initials: J.R. Hartwell', () => {
    expect(task('Send the signed').title).toBe('Send the signed agreement to J.R. Hartwell.');
    expect(task('Send the signed').children).toEqual(['  Then file the copy in the cabinet and tell the print shop it is on the way']);
  });

  it('does not split inside a code span', () => {
    expect(task('Rename the flag').title).toBe('Rename the flag from `old.name. Value` to `new.name`.');
  });

  it('does not split inside a bold span', () => {
    expect(task('Rewrite the intro').title).toBe('Rewrite the intro so **the first sentence. Says what** the tool is for.');
  });

  it('does not split inside brackets', () => {
    expect(task('Call the supplier').title).toBe('Call the supplier (the one from March. Not the other one) about it.');
  });

  it('does not split after an abbreviation', () => {
    expect(task('Check the i.e.').title).toBe('Check the i.e. clause in section four and the e.g. list under it.');
  });

  it('two tasks that share a lead-in are each divided at their next break instead', () => {
    const pair = after.openTasks().filter((b) => b.title.startsWith('Build machine SSH keys:'));
    expect(pair.map((b) => [b.title, ...b.children])).toEqual([
      ['Build machine SSH keys: rotate the key and remove the old one from the account', '  settings page'],
      ['Build machine SSH keys: add the new laptop key and write down where the backup', '  of the old key is stored'],
    ]);
    expect(after.doc().problems.filter((p) => p.code === 'title-long')).toHaveLength(1);
    expect(after.doc().problems.map((p) => p.code)).not.toContain('title-duplicate');
  });

  it('splits at a semicolon, before a dash and before a bracket, keeping the separator on the right side', () => {
    expect([task('Email the venue').title, task('Email the venue').children[0]]).toEqual(['Email the venue about the room;', '  ask whether it has a projector and whether we can get in an hour early']);
    expect([task('Book the early').title, task('Book the early').children[0]]).toEqual(['Book the early train to the venue', '  - the one before nine, so there is time to walk from the station']);
    expect([task('Replace the cracked').title, task('Replace the cracked').children[0]]).toEqual([
      'Replace the cracked window pane in the shed',
      '  (the small one on the north side, not the big one by the door) before winter',
    ]);
  });

  it('cuts at the last space within the limit when there is no natural break, without an ellipsis', () => {
    const t = task('Sort the photographs');
    expect(t.title).toBe('Sort the photographs from the spring fair into folders by stall and by year and');
    expect(t.children).toEqual(['  send the best twenty to the newsletter editor']);
  });

  it('leaves a title with nowhere to cut', () => {
    expect(task('Supercali').children).toEqual([]);
    expect(measure(task('Supercali').title)).toBeGreaterThan(80);
  });

  it('re-attaches the due tail to the title and puts the new detail line above existing ones', () => {
    const t = task('Write up the retrospective');
    expect(t).toMatchObject({ title: 'Write up the retrospective for the spring release.', due: '2026-11-30' });
    expect(t.children).toEqual(['  Send it round to everyone who was on the project', '  an existing detail line stays below the new one']);
    expect(migrate('v2/split-guards.md').text).toContain('- [ ] Write up the retrospective for the spring release. (due 2026-11-30)\n  Send it round');
  });

  it('never splits a done task', () => {
    expect(after.doneTasks()[0]!.title).toMatch(/^A finished task is never split.*above it$/);
    expect(after.doneTasks()[0]!.children).toEqual([]);
  });

  it('counts what it did', () => {
    expect(migrate('v2/split-guards.md').report.tasks).toEqual({ open: 14, split: 9, cut: 3, leftLong: 1, leftLongWhy: { collision: 0, noBreak: 1, fence: 0 }, short: 1, movedToDone: 1 });
  });

  it('a label shorter than the minimum is carried to the next break (the 1,200-character task)', () => {
    const original = parse('v2/caps-label-1200.md').openTasks()[0]!.title;
    expect(original.length).toBeGreaterThan(1200);
    const first = migrated('v2/caps-label-1200.md').openTasks()[0]!;
    expect(first.title).toBe('TURN ON THE SCANNER - code is deployed and switched off');
    expect(first.children).toHaveLength(1);
    expect(`${first.title} ${first.children[0]!.slice(2)}`).toBe(original);
    const { report } = migrate('v2/caps-label-1200.md');
    expect(report.examples).toHaveLength(1);
    expect(report.still).toMatchObject({ 'title-label': 3, 'title-shouting': 1 });
  });

  it('splitTitle leaves a short text alone and never loses a character', () => {
    expect(splitTitle('Short enough')).toBeNull();
    const samples = [
      'Émigré café menu: translate the whole summer menu into English and print forty copies for the terrace tables',
      'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen',
      'A. B. C. D. E. F. G. H. I. J. K. L. M. N. O. P. Q. R. S. T. U. V. W. X. Y. Z. and then the rest of the alphabet again',
    ];
    for (const s of samples) {
      const r = splitTitle(s)!;
      expect(`${r.title} ${r.detail}`).toBe(s);
      expect(measure(r.title)).toBeLessThanOrEqual(80);
    }
  });

  it('splitOptions lists every break, earliest first, and the last space that fits after them', () => {
    const text = 'Order the paint for the fence - two tins of the green and one of the white; ask whether they still stock the old brushes';
    const options = splitOptions(text);
    expect(options.map((o) => [o.how, o.title])).toEqual([
      ['split', 'Order the paint for the fence'],
      ['split', 'Order the paint for the fence - two tins of the green and one of the white;'],
      ['cut', 'Order the paint for the fence - two tins of the green and one of the white; ask'],
    ]);
    for (const o of options) expect(`${o.title} ${o.detail}`).toBe(text);
    expect(splitTitle(text)).toEqual(options[0]);
    expect(splitOptions('Short enough')).toEqual([]);
  });
});

describe('titles that would be the same task after the split', () => {
  const { text, report } = migrate('v2/shared-lead-ins.md');
  const open = parseText(text).openTasks();
  const blocks = open.map((b) => [b.title, ...b.children]);

  it('tasks sharing a lead-in move on to their next break, all of them, until each title is its own', () => {
    expect(blocks.slice(0, 3)).toEqual([
      ['Agreed on 2026-05-02: the newsletter goes out monthly.', '  Tell the two editors and update the calendar on the wall'],
      ['Agreed on 2026-05-02: the stall moves to the north gate.', '  Ask the council for the new permit before the fair'],
      ['Agreed on 2026-05-02: the stall moves to the north gate and nobody has told the', '  volunteers yet so someone must ring round'],
    ]);
  });

  it('a long task whose first break is the title of a short one moves on too; the short one is not touched', () => {
    expect(blocks.slice(3, 5)).toEqual([
      ['Order the paint for the fence'],
      ['Order the paint for the fence - two tins of the green and one of the white;', '  ask whether they still stock the old brushes'],
    ]);
  });

  it('tasks with the same text all the way to the limit are left long, and only those', () => {
    const same = 'Waiting on the printer: the proofs for the autumn programme are late again and nobody at the shop answers the phone';
    expect(blocks.slice(5, 8)).toEqual([
      [same],
      [same],
      ['Waiting on the printer: the proofs for the spring programme are due on Friday', '  and the invoice has to be paid before then'],
    ]);
  });

  it('a break whose detail would open a code fence is passed over for the next one', () => {
    expect(blocks[8]).toEqual(['Paste the opening line into the readme: ``` starts the block and the rest of', '  this sentence only says why that matters']);
  });

  it('says why each title it left long was left', () => {
    expect(report.tasks).toEqual({ open: 9, split: 3, cut: 3, leftLong: 2, leftLongWhy: { collision: 2, noBreak: 0, fence: 0 }, short: 1, movedToDone: 0 });
    expect(parseText(text).doc().problems.filter((p) => p.code === 'title-long')).toHaveLength(2);
  });

  it('with three hundred tasks behind one lead-in, every one gets a title of its own', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `- [ ] Agreed on 2026-05-02: plot ${i + 1} is to be dug over before the frost and the compost spread on it straight afterwards`);
    const many = migrateFile(parseText(`---\nname: Sample\n---\n\n# Tasks\n${lines.join('\n')}\n\n# Session log\n`));
    expect(many.report.tasks).toMatchObject({ open: 300, split: 0, cut: 300, leftLong: 0 });
    expect(parseText(many.text).doc().problems.map((p) => p.code)).not.toContain('title-long');
  });

  const splitQueue = (...titles: string[]) => {
    const out = migrateFile(parseText(`---\nname: Sample\n---\n\n# Tasks\n${titles.map((t) => `- [ ] ${t}`).join('\n')}\n`));
    return { report: out.report, blocks: parseText(out.text).openTasks().map((b) => [b.title, ...b.children]) };
  };

  it('a task that runs out of breaks takes back its first title once the clash has moved on', () => {
    const a = `Agreed on 2026-05-02: ${'x'.repeat(70)}`;
    const b = 'Agreed on 2026-05-02: Ship the beta build. Then tell the testers which devices are covered this round';
    const { report, blocks } = splitQueue(a, b);
    expect(blocks).toEqual([
      ['Agreed on 2026-05-02:', `  ${'x'.repeat(70)}`],
      ['Agreed on 2026-05-02: Ship the beta build.', '  Then tell the testers which devices are covered this round'],
    ]);
    expect(report.tasks.leftLong).toBe(0);
  });

  it('three tasks: the one whose later breaks clash with a third takes back the shared lead-in', () => {
    const a = `Agreed with the board: the newsletter goes out monthly and the editors rotate ${'z'.repeat(20)}`;
    const b = `Agreed with the board: the stall moves; ${'Z'.repeat(60)}`;
    const e = 'Agreed with the board: the stall moves; then we tell the council and the volunteers and the fair office';
    const { report, blocks } = splitQueue(a, b, e);
    expect(blocks.map((x) => x[0])).toEqual([
      'Agreed with the board: the newsletter goes out monthly and the editors rotate',
      'Agreed with the board:',
      'Agreed with the board: the stall moves; then we tell the council and the',
    ]);
    expect(report.tasks.leftLong).toBe(0);
    blocks.forEach((x, i) => expect(`${x[0]} ${x[1]!.slice(2)}`).toBe([a, b, e][i]));
  });

  it.each(['due', 'done'])('a break is never placed right after a "(%s YYYY-MM-DD)" in the middle of the text', (word) => {
    const t = `Prep deck (${word} 2026-11-01) ${'y'.repeat(70)}`;
    const { blocks } = splitQueue(t);
    const after = parseText(migrateFile(parseText(`---\nname: Sample\n---\n\n# Tasks\n- [ ] ${t}\n`)).text).openTasks()[0]!;
    expect(after.due).toBeNull();
    expect(`${blocks[0]![0]} ${blocks[0]![1]!.slice(2)}`).toBe(t);
  });
});

describe('log sort', () => {
  const headings = (file: BlipFile) => rawEntries(file.logSection!).map((e) => e.lines.join('\n'));

  it('the ascending fixture comes out exactly reversed', () => {
    const before = headings(parse('v2/log-ascending-33.md'));
    expect(before).toHaveLength(33);
    expect(headings(migrated('v2/log-ascending-33.md'))).toEqual([...before].reverse());
    expect(migrate('v2/log-ascending-33.md').report.log).toEqual({ entries: 33, order: 'reversed' });
  });

  it('the mixed fixture keeps file order among equal dates, and undated entries stay attached', () => {
    expect(rawEntries(migrated('v2/log-mixed.md').logSection!).map((e) => e.lines[0])).toEqual([
      '## Before the log had dates',
      '## 2026-08-20 — Robin',
      '## 2026-08-20 — Robin',
      '## 2026-08-18 14:30 — Robin',
      '## 2026-08-15 (later) — tidy-up pass',
      '## 2026-08-15 — Robin + Claude',
      '## 2026-07-24/25 — Robin + Quill',
      '## A note with no date, attached to the entry above',
    ]);
    const text = migrate('v2/log-mixed.md').text;
    expect(text.indexOf('- First entry on the twentieth')).toBeLessThan(text.indexOf('- Second entry on the twentieth'));
    // Wrapped continuation lines travel with their entry, untouched.
    expect(text).toContain('- Re-read the wiring notes and found the swapped\n  pins on the humidity sensor, which explains the\n  readings from last week\n');
    expect(migrate('v2/log-mixed.md').report.log.order).toBe('sorted');
  });

  it('a second migrateFile changes nothing', () => {
    for (const rel of ['v2/log-ascending-33.md', 'v2/log-mixed.md']) {
      const once = migrate(rel).text;
      expect(migrateFile(parseText(once)).text).toBe(once);
    }
  });

  it('removes the v2 placeholder comment and leaves one blank line between entries', () => {
    const text = migrate('v2/interleaved-done.md').text;
    expect(text).not.toContain('<!--');
    expect(text).toContain('# Session log\n\n## 2026-10-01 — Robin + Claude\n- Ordered the relay board\n\n## 2026-09-28 — Robin + Claude\n- Soldered the prototype and flashed the first build\n');
  });
});

describe('next_action', () => {
  it('one matching a done task is skipped', () => {
    const { text, report } = migrate('v2/next-action-done.md');
    expect(report.nextAction).toBe('skip');
    expect(text).not.toContain('next_action');
    expect(migrated('v2/next-action-done.md').openTasks().map((b) => b.title)).toEqual(['Add the 2027 data']);
    expect(migrated('v2/next-action-done.md').doneTasks().map((b) => b.title)).toEqual(['publish the Tide Tables']);
  });

  it('one matching nothing becomes task 1; a file with no # Tasks gains one before # Session log', () => {
    const { text, report } = migrate('v2/next-action-new-no-tasks.md');
    expect(report.nextAction).toBe('promote');
    expect(text).not.toContain('next_action');
    const tasksAt = text.indexOf('\n# Tasks\n');
    expect(tasksAt).toBeGreaterThan(0);
    expect(tasksAt).toBeLessThan(text.indexOf('\n# Session log\n'));
    expect(text.indexOf('\n# Session log\n')).toBeLessThan(text.indexOf('\n# Reading list\n'));
    const first = migrated('v2/next-action-new-no-tasks.md').openTasks()[0]!;
    // Promoted as the full text, then split like any other long task.
    expect(`${first.title} ${first.children[0]!.slice(2)}`).toBe(
      'Read the three papers on tidal modelling and write a one page summary for the group, including which of the methods could run on the old laptop - the long one first, then the two short ones (they overlap a lot)',
    );
  });

  it('goes ahead of the existing queue', () => {
    expect(migrated('v2/crlf.md').openTasks().map((b) => b.title)).toEqual(['Print the December rota', 'Draft the rota']);
  });

  it('with no managed sections at all, # Tasks is created at the end and the foreign checklist is reported, not imported', () => {
    const { text, report } = migrate('v2/foreign-section.md');
    expect(report.foreign).toEqual([{ heading: 'BLIP — Orchard', items: 5 }]);
    expect(text.endsWith('- 2026-07-19: reviewed chapters one and two\n\n# Tasks\n\n- [ ] Finish the review of chapter three\n')).toBe(true);
    expect(migrated('v2/foreign-section.md').doc().tasks).toMatchObject({ open: [{ title: 'Finish the review of chapter three' }], done: [] });
  });
});

describe('field mapping', () => {
  it('no name is written for a nameless file', () => {
    for (const rel of ['v2/next-action-new-no-tasks.md', 'v2/foreign-section.md', 'v2/empty-frontmatter.md', 'v2/no-frontmatter.md']) {
      const { text, report } = migrate(rel);
      expect(fmLines(text).some((l) => l.startsWith('name:')), rel).toBe(false);
      expect(report.still['name-missing'], rel).toBe(1);
      expect(parseText(text).doc().nameSource).toBe('folder');
    }
  });

  it('never invents a now line or focus', () => {
    for (const rel of V2) {
      const lines = fmLines(migrate(rel).text);
      expect(lines.some((l) => l.startsWith('now:') || l.startsWith('focus:')), rel).toBe(false);
    }
  });

  it('all tags survive: category first, existing tags, then operation', () => {
    expect(fmLines(migrate('v2/interleaved-done.md').text)).toContain('tags: [product, hardware, workshop, low-power]');
    expect(fmLines(migrate('v2/legacy-enums.md').text)).toContain('tags: [client-work, web, moss-vale]');
    const many = `---\ncategory: Zed\ntags: [${Array.from({ length: 12 }, (_, i) => `Tag ${i}`).join(', ')}]\n---\n`;
    expect(parseText(migrateFile(parseText(many)).text).doc().tags).toEqual(['zed', ...Array.from({ length: 12 }, (_, i) => `tag-${i}`)]);
  });

  it('an empty category leaves no tags key at all', () => {
    const { text, report } = migrate('v2/next-action-done.md');
    expect(fmLines(text).some((l) => l.startsWith('tags:') || l.startsWith('category:'))).toBe(false);
    expect(report.keys).toContain('category "" → (no tag)');
  });

  it('writes the frontmatter in canonical order and reports every key it renamed or dropped', () => {
    const { text, report } = migrate('v2/interleaved-done.md');
    expect(fmLines(text)).toEqual(['blip: 3', 'name: Kettle Firmware', 'status: active', 'due: 2026-09-08', 'tags: [product, hardware, workshop, low-power]', 'created: 2026-06-04', 'repo: example/kettle']);
    expect(report.keys).toEqual(['category "Product" → tag product', 'operation "Workshop" → tag workshop', 'deadline → due 2026-09-08']);
    expect(report.dropped).toEqual([
      { key: 'horizon', value: 'week' },
      { key: 'priority', value: '2' },
      { key: 'radar_angle', value: '255.82' },
      { key: 'last_session', value: '2026-10-01T12:48:00.000Z' },
    ]);
  });

  it('shipped becomes archived; an unknown status becomes active and is reported', () => {
    expect(fmLines(migrate('v2/next-action-done.md').text)).toContain('status: archived');
    const { text, report } = migrate('v2/next-action-new-no-tasks.md');
    expect(fmLines(text)).toContain('status: active');
    expect(report.keys).toContain('status someday-maybe → active');
  });

  it('a deadline that is not a real date is dropped and reported', () => {
    const { text, report } = migrate('v2/next-action-new-no-tasks.md');
    expect(fmLines(text).some((l) => l.startsWith('due:') || l.startsWith('deadline:'))).toBe(false);
    expect(report.dropped).toContainEqual({ key: 'deadline', value: 'next spring' });
  });

  it('horizon: this-week and priority: high are dropped with their values', () => {
    expect(migrate('v2/legacy-enums.md').report.dropped).toEqual([
      { key: 'horizon', value: 'this-week' },
      { key: 'priority', value: 'high' },
    ]);
  });

  it('a file with only last_session and next_action keeps nothing but blip: 3', () => {
    expect(fmLines(migrate('v2/foreign-section.md').text)).toEqual(['blip: 3']);
  });

  it('empty frontmatter is filled in, not duplicated; a file without any gains one', () => {
    expect(migrate('v2/empty-frontmatter.md').text).toBe('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Give this project a name\n\n# Session log\n');
    expect(migrate('v2/no-frontmatter.md').text).toBe('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Write the first line of the plan\n\n## Done\n\n- [x] Open the file\n\n# Scratch\nNothing here is managed.\n');
  });
});

describe('tasks and sections', () => {
  it('ticked boxes move under ## Done in file order, each with its children', () => {
    const text = migrate('v2/interleaved-done.md').text;
    expect(text.slice(text.indexOf('# Tasks'), text.indexOf('# Session log'))).toBe(
      [
        '# Tasks',
        '',
        '- [ ] Measure standby current',
        '  - target is under 2 mA',
        '  - meter is on the shelf',
        '- [ ] Write the boil-dry cutoff',
        '- [ ] Print the case (due 2026-10-20)',
        '',
        '## Done',
        '',
        '- [x] Pick the microcontroller',
        '  - went with the one already in the drawer',
        '- [x] Order the relay board',
        '- [x] Solder the prototype',
        'loose note about the prototype',
        '',
        '',
      ].join('\n'),
    );
  });

  it('removes a # Notes section that holds only the v2 placeholder, and keeps a real one', () => {
    const skeleton = migrate('v2/interleaved-done.md');
    expect(skeleton.text).not.toContain('# Notes');
    expect(skeleton.report.removed).toEqual(['placeholder comment under # Tasks', 'placeholder comment under # Session log', 'empty # Notes section']);
    expect(skeleton.text.endsWith('- Soldered the prototype and flashed the first build\n')).toBe(true);
    expect(migrate('v2/next-action-done.md').text.endsWith('# Notes\nThe harbour office sends new data each January.\n')).toBe(true);
    expect(migrate('v2/big-83kb.md').text.endsWith('# Notes\nThe committee meets on the first Tuesday of the month.\n')).toBe(true);
  });

  it('the 95-task queue keeps all 95, in order', () => {
    const { report } = migrate('v2/queue-95.md');
    expect(report.tasks).toMatchObject({ open: 95, movedToDone: 5 });
    expect(report.tasks.split + report.tasks.cut + report.tasks.leftLong + report.tasks.short).toBe(95);
    expect(report.still['queue-too-long']).toBe(1);
    const numbers = migrated('v2/queue-95.md').openTasks().map((b) => Number(/plot (\d+)/.exec(`${b.title} ${b.children[0] ?? ''}`)![1]));
    expect(numbers).toEqual(Array.from({ length: 95 }, (_, i) => i + 1));
  });

  it('the 83 KB file migrates and reports its sizes', () => {
    const { report } = migrate('v2/big-83kb.md');
    expect(report.bytes.before).toBe(Buffer.byteLength(fixture('v2/big-83kb.md')));
    expect(report.bytes.after).toBe(Buffer.byteLength(migrate('v2/big-83kb.md').text));
    expect(report.tasks.open).toBe(300);
    expect(report.examples).toHaveLength(3);
  });
});

describe('secrets', () => {
  it('reports token-shaped lines by number, never by value', () => {
    const { report } = migrate('lint/secret-shaped.pos.md');
    expect(report.secretLines).toEqual([10]);
    expect(JSON.stringify(report)).not.toContain('not-a-real-value');
    expect(migrate('lint/secret-shaped.neg.md').report.secretLines).toEqual([]);
  });

  it('a short password in a long task is reported, so migrate and its dry run leave the file alone', () => {
    const v2 = `---\nname: Sample\n---\n\n# Tasks\n\n- [ ] Reset the demo router before the client visit: the admin password: Spring1! is on the sticker ${'y'.repeat(30)}\n`;
    expect(migrateFile(parseText(v2)).report.secretLines).toEqual([7]);
  });
});

describe('v2 boilerplate is removed only when it is the whole of what is there', () => {
  const HEAD = '---\nname: Sample\n---\n\n';

  it.each([
    ['prose and a trailing comment', '<!-- Human-only. Tooling never rewrites this section. -->\n\nCall the plumber back on Tuesday.\nGate code is in the binder.\n<!-- keep -->\n'],
    ['prose between two comments', '\n<!-- Human-only. Agents never write here. -->\n\nSpare key is under the blue pot.\n\n<!-- end -->\n'],
    ['a second comment only', '<!-- Human-only. -->\n<!-- mine -->\n'],
  ])('a # Notes section that starts with the placeholder and holds %s survives whole', (_what, body) => {
    const notes = `# Notes\n${body}`;
    const { text, report } = migrateFile(parseText(`${HEAD}# Tasks\n\n- [ ] one\n\n${notes}`));
    expect(text.endsWith(notes)).toBe(true);
    expect(report.removed).not.toContain('empty # Notes section');
  });

  it('the bare placeholder is still removed', () => {
    const { text, report } = migrateFile(parseText(`${HEAD}# Notes\n\n<!-- Human-only. Tooling never\nrewrites this section. -->\n`));
    expect(text).toBe('---\nblip: 3\nname: Sample\n---\n\n');
    expect(report.removed).toEqual(['empty # Notes section']);
  });

  it('a line under # Tasks that starts with the placeholder and goes on is kept', () => {
    const line = '<!-- RADAR-owned checklist. --> Buy order: paint first <!-- then brushes -->';
    const { text, report } = migrateFile(parseText(`${HEAD}# Tasks\n${line}\n- [ ] one\n`));
    expect(text).toContain(`# Tasks\n\n${line}\n\n- [ ] one\n`);
    expect(report.removed).toEqual([]);
  });

  it('a line under # Session log that starts with the placeholder and goes on is kept', () => {
    const line = '<!-- Append-only. --> Kept by hand since March <!-- really -->';
    const { text, report } = migrateFile(parseText(`${HEAD}# Session log\n${line}\n\n## 2026-09-02 - Robin\n- Measured the roof\n`));
    expect(text).toContain(`# Session log\n\n${line}\n\n## 2026-09-02 - Robin\n`);
    expect(report.removed).toEqual([]);
  });

  it('the bare placeholders under # Tasks and # Session log are still removed', () => {
    const { text, report } = migrateFile(parseText(`${HEAD}# Tasks\n<!-- RADAR-owned checklist. Edit with the CLI. -->\n- [ ] one\n\n# Session log\n<!-- Append-only, newest last. -->\n\n## 2026-09-02 - Robin\n- Measured the roof\n`));
    expect(text).not.toContain('<!--');
    expect(report.removed).toEqual(['placeholder comment under # Tasks', 'placeholder comment under # Session log']);
  });
});
