import { describe, it, expect } from 'vitest';
import { migrateFile } from '../../src/core/normalize.js';
import { NOW, fixture, parse, parseText } from './fixtures.js';

/** Everything from the first unknown key to the closing `---`, exactly as it is in the fixture. */
function unknownRegion(text: string): string {
  const from = text.indexOf('created:');
  return text.slice(from, text.indexOf('\n---\n', from) + 1);
}

describe('unknown frontmatter keys are kept exactly as written', () => {
  const region = unknownRegion(fixture('v3/unknown-keys.md'));

  it('the fixtures hold the awkward cases', () => {
    for (const piece of ['big: 12345678901234567890', 'id: 007', 'plus: +5', 'hex: 0x1F', 'fl: [ a,  b ]', '\n- node\n', '\n    depth: 1\n', "'single'   # trailing", 'long: >\n  folded text\n  here', 'plain: first line\n  second line', '\n# a comment']) {
      expect(region).toContain(piece);
    }
    expect(unknownRegion(fixture('v2/unknown-keys.md'))).toBe(region);
  });

  it('through migrateFile, byte for byte', () => {
    const { text } = migrateFile(parse('v2/unknown-keys.md'));
    expect(text).toContain(`\n${region}---\n`);
    expect(text.startsWith('---\nblip: 3\nname: Garden Shed\nstatus: archived\ndue: 2026-11-20\ntags: [home]\ncreated:   2026-06-04\n')).toBe(true);
  });

  it.each([
    ['now', 'Waiting on the roofing felt.'],
    ['status', 'blocked'],
    ['focus', true],
    ['due', '2026-12-01'],
    ['tags', ['home', 'garden']],
    ['links', ['https://example.com/shed']],
    ['name', null],
  ] as const)('through setField(%s), byte for byte', (key, value) => {
    const file = parse('v3/unknown-keys.md');
    expect(file.edit({ now: NOW }).setField(key, value)).toBe(true);
    const out = file.toString();
    expect(out).toContain(`\n${region}---\n`);
    expect(out.slice(out.indexOf('\n---\n'))).toBe(fixture('v3/unknown-keys.md').slice(fixture('v3/unknown-keys.md').indexOf('\n---\n')));
    expect(parseText(out).doc().problems.map((p) => p.code)).not.toContain('yaml-invalid');
  });

  it('a managed key that did not change keeps its own spelling too', () => {
    const file = parseText('---\nblip: 3\nname:   "Sample"   # the display name\nnow: old\nticket: 00123\n---\n');
    file.edit({ now: NOW }).setField('now', 'new');
    expect(file.toString()).toBe('---\nblip: 3\nname:   "Sample"   # the display name\nnow: new\nticket: 00123\n---\n');
  });

  it('a comment above a removed key stays in the file', () => {
    const { text } = migrateFile(parseText('---\nname: Sample\n# set by the old app\nhorizon: now\nticket: 00123\n---\n'));
    expect(text).toBe('---\nblip: 3\nname: Sample\n# set by the old app\nticket: 00123\n---\n');
  });

  it('CRLF frontmatter keeps its unknown keys and its line endings', () => {
    const file = parseText('---\r\nblip: 3\r\nname: Sample\r\nticket: 00123\r\nlist:\r\n- a\r\n---\r\n');
    file.edit({ now: NOW }).setField('now', 'Waiting on parts.');
    expect(file.toString()).toBe('---\r\nblip: 3\r\nname: Sample\r\nnow: Waiting on parts.\r\nticket: 00123\r\nlist:\r\n- a\r\n---\r\n');
  });
});

describe('a header write that would leave broken YAML is refused', () => {
  it('removing a key whose anchor another key points at', () => {
    const text = '---\nblip: 3\nname: &n Sample\nalso: *n\n---\n';
    const file = parseText(text);
    const ed = file.edit({ now: NOW });
    expect(() => ed.setField('name', null)).toThrow(expect.objectContaining({ code: 'E_UNWRITABLE' }));
    expect(file.toString()).toBe(text);
    expect(ed.setField('now', 'fine')).toBe(true);
    expect(file.toString()).toBe('---\nblip: 3\nname: &n Sample\nnow: fine\nalso: *n\n---\n');
  });

  it('migrate skips such a file untouched', () => {
    const text = '---\nname: Sample\nhorizon: &h now\nwhen: *h\n---\n\n# Tasks\n- [ ] one\n';
    expect(migrateFile(parseText(text))).toMatchObject({ text, report: { changed: false, skipped: 'unwritable' } });
  });
});

describe('frontmatter that is empty, null or not closed', () => {
  it('empty frontmatter is recognised when a horizontal rule follows later in the body', () => {
    const text = '---\n---\n\n# Tasks\n\n- [ ] Water the plants\n- [ ] Call Robin\n\n# Notes\n\nabove the rule\n\n---\n\nbelow the rule\n';
    const file = parseText(text);
    expect(file.state.fmBlock).toBe('---\n---\n');
    expect(file.state.fmRaw).toBe('');
    expect(file.readOnly).toBe('E_NEEDS_MIGRATE');
    expect(file.doc().tasks.open.map((t) => t.title)).toEqual(['Water the plants', 'Call Robin']);
    const out = migrateFile(file).text;
    expect(out.startsWith('---\nblip: 3\n---\n\n# Tasks\n')).toBe(true);
    expect(out).toContain('above the rule\n\n---\n\nbelow the rule\n');
  });

  it.each(['null', '~', '# only a comment'])('frontmatter that is just "%s" migrates as empty frontmatter and never throws', (yaml) => {
    const file = parseText(`---\n${yaml}\n---\n\n# Tasks\n\n- [ ] one\n`);
    expect(file.readOnly).toBe('E_NEEDS_MIGRATE');
    const { text, report } = migrateFile(file);
    expect(report.changed).toBe(true);
    const again = parseText(text);
    expect(again.writable).toBe(true);
    expect(again.doc().tasks.open.map((t) => t.title)).toEqual(['one']);
    expect(migrateFile(again).text).toBe(text);
  });

  it('a header whose closing --- is missing is unreadable frontmatter, not a v2 file', () => {
    for (const text of ['---\nblip: 3\nname: Sample\nnow: fine\n\n# Tasks\n\n- [ ] A\n', '---\nname: x\n', '---\n']) {
      const file = parseText(text);
      expect(file.readOnly).toBe('E_UNWRITABLE');
      const problems = file.doc().problems;
      expect(problems.map((p) => p.code)).toEqual(['yaml-invalid']);
      expect(problems[0]).toMatchObject({ severity: 'error', line: 1 });
      expect(problems[0]!.message).toContain('closing ---');
      expect(() => file.edit({ now: NOW })).toThrow();
      expect(migrateFile(file)).toMatchObject({ text, report: { changed: false, skipped: 'unwritable' } });
    }
  });
});

describe('a v2 next_action that is not text', () => {
  it.each(['42', 'true', '2026'])('next_action: %s reads as task 1 and migrates to the same task 1', (value) => {
    const file = parseText(`---\nname: Sample\nnext_action: ${value}\n---\n\n# Tasks\n\n- [ ] one\n`);
    expect(file.doc().tasks.open.map((t) => t.title)).toEqual([value, 'one']);
    const { text, report } = migrateFile(file);
    expect(report.nextAction).toBe('promote');
    expect(parseText(text).openTasks().map((b) => b.title)).toEqual([value, 'one']);
  });

  it('a list or a map is not a task in either view, and the report says it was dropped', () => {
    const file = parseText('---\nname: Sample\nnext_action: [a, b]\n---\n\n# Tasks\n\n- [ ] one\n');
    expect(file.doc().tasks.open.map((t) => t.title)).toEqual(['one']);
    const { text, report } = migrateFile(file);
    expect(parseText(text).openTasks().map((b) => b.title)).toEqual(['one']);
    expect(report.nextAction).toBe('none');
    expect(report.dropped).toEqual([{ key: 'next_action', value: '["a","b"]' }]);
  });
});

describe('the migration report names an unknown status', () => {
  it.each([
    ['shipped', 'status shipped → archived'],
    ['someday', 'status someday → active'],
    ['7', 'status 7 → active'],
  ])('status: %s', (value, line) => {
    expect(migrateFile(parseText(`---\nname: Sample\nstatus: ${value}\n---\n`)).report.keys).toEqual([line]);
  });

  it('a known status in other casing is rewritten without a report line', () => {
    const { text, report } = migrateFile(parseText('---\nname: Sample\nstatus: Paused\n---\n'));
    expect(text).toBe('---\nblip: 3\nname: Sample\nstatus: paused\n---\n');
    expect(report.keys).toEqual([]);
  });
});
