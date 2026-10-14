import { describe, it, expect } from 'vitest';
import { applyEdit, type EditCtx, type EditOp } from '../../src/core/edit.js';
import { BlipError } from '../../src/core/schema.js';
import { NOW, READONLY, V2, fixture, parse, parseText } from './fixtures.js';

const agent: EditCtx = { actor: 'agent', now: NOW, author: 'Robin' };
const human: EditCtx = { actor: 'human', now: NOW, author: 'Robin' };

/** Run ops expecting a rejection; the file must come through untouched. */
function refused(rel: string, ops: EditOp[], ctx: EditCtx): BlipError {
  const file = parse(rel);
  let caught: unknown;
  try {
    applyEdit(file, ops, ctx);
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected a BlipError').toBeInstanceOf(BlipError);
  expect(file.toString()).toBe(fixture(rel));
  return caught as BlipError;
}

describe('applyEdit: actor rules (spec 4.5)', () => {
  it.each([
    ['due', '2026-12-01'],
    ['focus', true],
    ['tags', ['one']],
    ['links', ['https://example.com']],
    ['status', 'paused'],
    ['status', 'archived'],
  ] as const)('an agent cannot set %s to %j', (field, value) => {
    expect(refused('v3/full.md', [{ op: 'set', field, value }], agent).code).toBe('E_HUMAN_OWNED');
  });

  it.each([
    ['due', '2026-12-01', 'due: 2026-12-01'],
    ['focus', false, null],
    ['tags', ['One Two', 'three'], 'tags: [one-two, three]'],
    ['status', 'paused', 'status: paused'],
    ['status', 'archived', 'status: archived'],
    ['name', 'Lantern', 'name: Lantern'],
  ] as const)('the owner can set %s to %j', (field, value, line) => {
    const file = parse('v3/full.md');
    const res = applyEdit(file, [{ op: 'set', field, value }], human);
    expect(res.changed).toBe(true);
    if (line) expect(file.toString()).toContain(`\n${line}\n`);
    else expect(file.toString()).not.toContain('focus');
  });

  it('an agent sets now, and status active or blocked', () => {
    const file = parse('v3/full.md');
    const res = applyEdit(
      file,
      [
        { op: 'set', field: 'status', value: 'active' },
        { op: 'set', field: 'now', value: 'The conflict screen is designed and sync is on for the test group.' },
      ],
      agent,
    );
    expect(res.changed).toBe(true);
    expect(file.doc().status).toBe('active');
    expect(file.doc().now).toBe('The conflict screen is designed and sync is on for the test group.');
  });

  it('an agent names a project that has no name', () => {
    const file = parseText('---\nblip: 3\n---\n\n# Tasks\n');
    applyEdit(file, [{ op: 'set', field: 'name', value: 'Lantern Notes' }], agent);
    expect(file.doc()).toMatchObject({ name: 'Lantern Notes', nameSource: 'file' });
  });

  it('an agent renames a project whose name is a folder slug', () => {
    const file = parseText('---\nblip: 3\nname: lantern-notes\n---\n');
    applyEdit(file, [{ op: 'set', field: 'name', value: 'Lantern Notes' }], agent);
    expect(file.doc().name).toBe('Lantern Notes');
  });

  it('an agent cannot rename a project that has a real name; sending the same name is a skip', () => {
    expect(refused('v3/full.md', [{ op: 'set', field: 'name', value: 'Lantern Two' }], agent).code).toBe('E_HUMAN_OWNED');
    const file = parse('v3/full.md');
    const res = applyEdit(file, [{ op: 'set', field: 'name', value: 'Lantern Notes' }], agent);
    expect(res).toMatchObject({ changed: false, report: [{ kind: 'skipped' }] });
  });

  it('an agent cannot give a project a slug for a name; the owner can, with a warning', () => {
    const text = '---\nblip: 3\n---\n';
    const file = parseText(text);
    expect(() => applyEdit(file, [{ op: 'set', field: 'name', value: 'lantern-notes' }], agent)).toThrowError(expect.objectContaining({ code: 'E_NAME_STYLE' }));
    expect(file.toString()).toBe(text);
    const res = applyEdit(file, [{ op: 'set', field: 'name', value: 'lantern-notes' }], human);
    expect(res.report.some((r) => r.kind === 'warn' && r.code === 'name-slug')).toBe(true);
    expect(file.doc().name).toBe('lantern-notes');
  });
});

describe('applyEdit: writing rules', () => {
  it('rejects every broken rule in one go, each with its path and measured length', () => {
    const err = refused(
      'v3/full.md',
      [
        { op: 'task.add', title: 'x'.repeat(112) },
        { op: 'task.add', title: 'Fine title', detail: ['y'.repeat(161)], due: '2026-02-31' },
        { op: 'log.add', bullets: ['z'.repeat(231)] },
      ],
      agent,
    );
    expect(err.code).toBe('E_INVALID');
    expect(err.violations!.map((v) => [v.code, v.path])).toEqual([
      ['E_TITLE_LENGTH', 'ops[0].title'],
      ['E_DETAIL_SIZE', 'ops[1].detail[0]'],
      ['E_DATE', 'ops[1].due'],
      ['E_LOG_SIZE', 'ops[2].bullets[0]'],
    ]);
    expect(err.violations![0]!.message).toContain('112 chars (max 80)');
    expect(err.violations![1]!.message).toContain('161 chars (max 160)');
    expect(err.violations![3]!.message).toContain('231 chars (max 200)');
  });

  it.each([
    ['SHOUT ABOUT THE WHOLE RELEASE NOW', 'title-shouting'],
    ['EMAIL: evaluate the other provider', 'title-label'],
  ])('a style slip in a title is an error for an agent and a warning for the owner: %s', (title, code) => {
    expect(refused('v3/full.md', [{ op: 'task.add', title }], agent).code).toBe('E_TITLE_STYLE');
    const file = parse('v3/full.md');
    const res = applyEdit(file, [{ op: 'task.add', title }], human);
    expect(res.report.find((r) => r.kind === 'warn')?.code).toBe(code);
    expect(file.doc().tasks.open.at(-1)!.title).toBe(title);
  });

  it('length caps hold for the owner too', () => {
    expect(refused('v3/full.md', [{ op: 'task.add', title: 'x'.repeat(81) }], human).code).toBe('E_TITLE_LENGTH');
    expect(refused('v3/full.md', [{ op: 'set', field: 'now', value: 'n'.repeat(141) }], human).code).toBe('E_NOW_LENGTH');
  });

  it('set links: a URL or a { label, url } item reaches the read model; anything else is E_VALUE', () => {
    const file = parse('v3/full.md');
    const links = [{ label: 'Site', url: 'https://example.com' }, { label: null, url: 'mailto:robin@example.com' }, 'https://lantern.example.com/docs'];
    expect(applyEdit(file, [{ op: 'set', field: 'links', value: links }], human).changed).toBe(true);
    expect(file.doc().links).toEqual([
      { label: 'Site', url: 'https://example.com' },
      { label: null, url: 'mailto:robin@example.com' },
      { label: null, url: 'https://lantern.example.com/docs' },
    ]);
    expect(file.toString()).toContain('\nlinks:\n  - Site: https://example.com\n  - mailto:robin@example.com\n  - https://lantern.example.com/docs\n');

    const big = Array.from({ length: 200 }, (_, i) => Object.fromEntries(Array.from({ length: 200 }, (_, k) => [`k${k}`, `${i}`.repeat(300)])));
    for (const value of [
      'https://example.com',
      [42],
      [true, null],
      [['https://example.com']],
      [{ a: { b: 'c' } }],
      [{ Site: 'https://example.com' }],
      [{ label: 'Site', url: 'https://example.com', extra: 1 }],
      [{ label: 3, url: 'https://example.com' }],
      ['not a url'],
      ['ftp://files.example.com/x'],
      [`https://example.com/${'p'.repeat(2048)}`],
      [{ label: 'L'.repeat(81), url: 'https://example.com' }],
      [{ label: 'Two\nlines', url: 'https://example.com' }],
      Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`),
      big,
    ]) {
      const err = refused('v3/full.md', [{ op: 'set', field: 'links', value }], human);
      expect(err.violations?.[0]?.code, JSON.stringify(value).slice(0, 80)).toBe('E_VALUE');
    }
  });

  it('a closing full stop is dropped from a title without comment', () => {
    const file = parse('v3/full.md');
    applyEdit(file, [{ op: 'task.add', title: 'Rotate the staging keys.' }], agent);
    expect(file.doc().tasks.open.at(-1)!.title).toBe('Rotate the staging keys');
  });

  it('a vague Now line is written, with a warning', () => {
    const file = parse('v3/full.md');
    const res = applyEdit(file, [{ op: 'set', field: 'now', value: 'Working on the sync engine.' }], agent);
    expect(res.changed).toBe(true);
    expect(res.report.find((r) => r.kind === 'warn')?.code).toBe('now-style');
  });

  it('list markers and checkboxes are taken off log bullets, and blank ones dropped', () => {
    const file = parse('v3/full.md');
    applyEdit(file, [{ op: 'log.add', bullets: ['- Fixed the lockout', '', '- [x] Wrote the notes', '## Tidied the queue'] }], agent);
    expect(file.doc().log[0]!.bullets).toEqual(['Fixed the lockout', 'Wrote the notes', 'Tidied the queue']);
  });

  it('the log heading carries the author and the agent, timed by the engine', () => {
    const file = parse('v3/full.md');
    applyEdit(file, [{ op: 'log.add', bullets: ['Fixed the lockout'], agent: 'Claude' }], agent);
    expect(file.doc().log[0]).toMatchObject({ heading: '2026-10-13 14:05 — Robin + Claude', date: '2026-10-13', time: '14:05', author: 'Robin + Claude' });
  });

  it('a long author is clipped so the heading author stays within 40 characters', () => {
    const file = parse('v3/full.md');
    applyEdit(file, [{ op: 'log.add', bullets: ['Fixed the lockout'], agent: 'Claude' }], { ...agent, author: 'A'.repeat(80) });
    const author = file.doc().log[0]!.author!;
    expect(author.length).toBe(40);
    expect(author.endsWith(' + Claude')).toBe(true);
  });
});

describe('applyEdit: refs, skips and copies', () => {
  it('a ref resolves among open tasks first: done "Deploy" completes the open one', () => {
    const file = parseText('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Deploy\n\n## Done\n\n- [x] Deploy (done 2026-10-01)\n');
    const res = applyEdit(file, [{ op: 'task.done', task: { title: 'deploy.' } }], agent);
    expect(res.report).toEqual([{ kind: 'done', text: 'Deploy' }]);
    expect(file.doc().tasks.open).toEqual([]);
    expect(file.doc().tasks.done.map((t) => t.doneOn)).toEqual(['2026-10-13', '2026-10-01']);
  });

  it('a title no task has is E_TASK_GONE, listing the open tasks with numbers', () => {
    const err = refused('v3/full.md', [{ op: 'task.done', task: { title: 'Nothing like this' } }], agent);
    expect(err.code).toBe('E_TASK_GONE');
    expect(err.hint).toContain('1. Design the conflict screen so sync can be switched on');
    expect(err.hint).toContain('4. Robin: approve the wording in PR #21');
  });

  it('a title two open tasks share is E_REF_AMBIGUOUS', () => {
    const text = '---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Call the printer\n- [ ] Call the printer.\n';
    const file = parseText(text);
    expect(() => applyEdit(file, [{ op: 'task.done', task: { title: 'Call the printer' } }], agent)).toThrowError(expect.objectContaining({ code: 'E_REF_AMBIGUOUS' }));
    expect(file.toString()).toBe(text);
  });

  it('a failing op undoes the ops before it', () => {
    refused('v3/full.md', [{ op: 'task.add', title: 'Add this first' }, { op: 'task.done', task: { title: 'No such task' } }], agent);
  });

  it('retitling onto another open task is refused', () => {
    const err = refused('v3/full.md', [{ op: 'task.edit', task: { title: 'Write the release notes for 4.2' }, title: 'Renew the signing certificate' }], agent);
    expect(err.code).toBe('E_TITLE_DUPLICATE');
  });

  it('an edit to the same title keeps the full stop a migrated title ends with', () => {
    const text = '---\nblip: 3\nname: Sample\n---\n\n# Tasks\n\n- [ ] Agreed on the venue for the spring fair.\n  Then book the van and tell the stall holders\n';
    const file = parseText(text);
    const res = applyEdit(file, [{ op: 'task.edit', task: { title: 'Agreed on the venue for the spring fair.' }, title: 'Agreed on the venue for the spring fair.' }], agent);
    expect(res.changed).toBe(false);
    expect(res.report).toEqual([expect.objectContaining({ kind: 'skipped' })]);
    expect(file.toString()).toBe(text);
    // A real retitle still drops the full stop, as for any title written through the API.
    applyEdit(file, [{ op: 'task.edit', task: { title: 'Agreed on the venue for the spring fair' }, title: 'Agree on the venue for the spring fair.' }], agent);
    expect(file.toString()).toContain('- [ ] Agree on the venue for the spring fair\n  Then book');
  });

  it('remove hands back the whole block for the trash', () => {
    const file = parse('v3/full.md');
    const res = applyEdit(file, [{ op: 'task.remove', task: { title: 'Renew the signing certificate' } }], agent);
    expect(res.removed).toEqual([{ reason: 'removed', text: '- [ ] Renew the signing certificate (due 2026-10-31)\n  The current one expires on the first of November.' }]);
    expect(file.toString()).not.toContain('signing certificate');
  });

  it('an edit that replaces existing detail hands back the old block; one that adds detail to a bare task does not', () => {
    const file = parse('v3/full.md');
    const res = applyEdit(
      file,
      [
        { op: 'task.edit', task: { title: 'Renew the signing certificate' }, detail: ['Ordered; arrives Friday.'] },
        { op: 'task.edit', task: { title: 'Write the release notes for 4.2' }, detail: ['Start from the changelog.'] },
      ],
      agent,
    );
    expect(res.removed).toEqual([{ reason: 'detail replaced', text: '- [ ] Renew the signing certificate (due 2026-10-31)\n  The current one expires on the first of November.' }]);
    expect(file.toString()).toContain('- [ ] Renew the signing certificate (due 2026-10-31)\n  Ordered; arrives Friday.\n- [ ] Write the release notes for 4.2\n  Start from the changelog.\n');
  });

  it('the same ops applied twice leave the file as applying them once', () => {
    const ops: EditOp[] = [
      { op: 'task.done', task: { title: 'Write the release notes for 4.2' } },
      { op: 'task.reopen', task: { title: 'Move the backlog out of the old tracker' } },
      { op: 'task.edit', task: { title: 'Renew the signing certificate' }, due: null, detail: ['Ordered; arrives Friday.'] },
      { op: 'task.move', task: { title: 'Robin: approve the wording in PR #21' }, before: { title: 'Design the conflict screen so sync can be switched on' } },
      { op: 'task.add', title: 'Flip the sync flag for everyone', detail: ['After a clean day in the error log.'], before: { title: 'Robin: approve the wording in PR #21' } },
      { op: 'set', field: 'status', value: 'active' },
      { op: 'set', field: 'now', value: 'Release notes are written; the certificate is on order.' },
      { op: 'log.add', bullets: ['Wrote the release notes for 4.2', 'Ordered the new signing certificate'] },
    ];
    const file = parse('v3/full.md');
    expect(applyEdit(file, ops, agent).changed).toBe(true);
    const once = file.toString();
    const again = applyEdit(file, ops, { ...agent, now: new Date(NOW.getTime() + 86_400_000) });
    expect(again.changed).toBe(false);
    expect(again.report.every((r) => r.kind === 'skipped')).toBe(true);
    expect(again.report).toHaveLength(ops.length);
    expect(file.toString()).toBe(once);
  });

  it('no ops is no change', () => {
    const file = parse('v3/full.md');
    expect(applyEdit(file, [], agent)).toEqual({ changed: false, report: [], removed: [] });
  });

  it('any change also puts out-of-place tasks right, and says so', () => {
    const file = parse('v3/out-of-place.md');
    const res = applyEdit(file, [{ op: 'set', field: 'now', value: 'The blog is being ported to the new template.' }], agent);
    expect(res.report.filter((r) => r.kind === 'tidied')).toHaveLength(2);
    expect(file.doc().problems.map((p) => p.code)).not.toContain('done-in-queue');
    expect(file.doc().tasks.open.map((t) => t.title)).toEqual(['Port the blog to the new template', 'Add a contact form', 'Check the site on a phone']);
  });

  it('warns once when an add leaves more than 25 open tasks', () => {
    const tasks = Array.from({ length: 25 }, (_, i) => `- [ ] Task number ${i + 1}`).join('\n');
    const file = parseText(`---\nblip: 3\n---\n\n# Tasks\n\n${tasks}\n`);
    const res = applyEdit(file, [{ op: 'task.add', title: 'One more task' }, { op: 'task.add', title: 'And another task' }], agent);
    expect(res.report.filter((r) => r.code === 'queue-too-long')).toHaveLength(1);
    expect(file.doc().tasks.open).toHaveLength(27);
  });
});

describe('applyEdit: read-only files are never changed', () => {
  const cases: [string, string][] = [
    ...READONLY.map((rel): [string, string] => [rel, rel.includes('broken') ? 'E_UNWRITABLE' : 'E_NEWER_SCHEMA']),
    ...V2.map((rel): [string, string] => [rel, 'E_NEEDS_MIGRATE']),
  ];
  it.each(cases)('%s → %s', (rel, code) => {
    for (const ops of [[], [{ op: 'task.add', title: 'Anything at all' }], [{ op: 'log.add', bullets: ['x'] }]] as EditOp[][]) {
      expect(refused(rel, ops, human).code).toBe(code);
    }
  });
});
