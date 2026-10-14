import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseBlip } from '../src/core/doc.js';
import { applyEdit } from '../src/core/edit.js';
import { BlipError } from '../src/core/schema.js';
import { parseSyncPayload, syncToOps } from '../src/core/sync.js';
import { readProject, syncProject, updateProject } from '../src/io.js';
import { projectId } from '../src/paths.js';
import { readState } from '../src/state.js';
import { NOW, READONLY, V2, fixture } from './core/fixtures.js';
import { bytesOf, isolate, project, textOf } from './helpers.js';
import { cpuMsSync } from './timing.js';

let data: string;
beforeEach(() => {
  data = isolate();
});

const sync = (dir: string, raw: unknown, opts: { dryRun?: boolean; agent?: string; now?: Date } = {}) =>
  syncProject(dir, parseSyncPayload(raw), { author: 'Robin', agent: 'Claude', now: NOW, ...opts });

/** Send a payload that must be rejected: the file's bytes do not change and nothing is recorded. */
async function rejected(raw: unknown, text?: string): Promise<BlipError> {
  const dir = project(text);
  const before = bytesOf(dir);
  let caught: unknown;
  try {
    await sync(dir, raw);
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected a rejection of ${JSON.stringify(raw)}`).toBeInstanceOf(BlipError);
  expect(bytesOf(dir).equals(before)).toBe(true);
  expect((await readState(projectId(dir))).lastSyncAt).toBeNull();
  expect(existsSync(join(data, 'trash'))).toBe(false);
  return caught as BlipError;
}

const NOW_LINE = 'Sync is on for the test group and the error log is clean.';
const TITLES = ['Design the conflict screen so sync can be switched on', 'Renew the signing certificate', 'Write the release notes for 4.2', 'Robin: approve the wording in PR #21'];

describe('sync: every rejection in the 3.5 table leaves the file unchanged', () => {
  const cases: [string, unknown, string?][] = [
    ['E_PAYLOAD_TYPE', []],
    ['E_PAYLOAD_TYPE', { log: 'one line', now: NOW_LINE }],
    ['E_PAYLOAD_TYPE', { done: [0] }],
    ['E_PAYLOAD_TYPE', { status: 'sleeping' }],
    ['E_PAYLOAD_TYPE', { done: ['2'] }],
    ['E_PAYLOAD_TYPE', { remove: [' 12 '] }],
    ['E_PAYLOAD_TYPE', { add: ['Fix the \ud800 thing'] }],
    ['E_PAYLOAD_TYPE', { now: 'Half a character \udc00 here' }],
    ['E_PAYLOAD_TYPE', { now: 'x'.repeat(4001) }],
    ['E_PAYLOAD_KEY', { agent: 'Claude' }],
    ['E_PAYLOAD_KEY', { add: [{ title: 'Check the sync flag', priority: 1 }] }],
    ['E_PAYLOAD_V2', { session: ['did things'], tasks: { done: [1] } }],
    ['E_PAYLOAD_V2', { fields: { horizon: 'today' } }],
    ['E_REV_REQUIRED', { done: [2] }],
    ['E_STALE_REFS', { rev: '0000000000000000', done: [2] }],
    ['E_NOW_REQUIRED', { log: ['Fixed the lockout'] }],
    ['E_NOW_LENGTH', { now: 'n'.repeat(141) }],
    ['E_NOW_LENGTH', { now: 'Line one.\nLine two.' }],
    ['E_NOW_STYLE', { now: 'TURN ON THE SYNC ENGINE FOR EVERYONE' }],
    ['E_NOW_STYLE', { now: 'STATUS: sync is on for the test group' }],
    ['E_NOW_STYLE', { now: '- sync is on for the test group' }],
    ['E_TITLE_LENGTH', { add: ['ab'] }],
    ['E_TITLE_LENGTH', { add: [{ title: 't'.repeat(81) }] }],
    ['E_TITLE_STYLE', { add: ['TURN ON THE SYNC ENGINE FOR EVERYONE'] }],
    ['E_TITLE_STYLE', { add: ['NOTE: the importer drops empty rows'] }],
    ['E_TITLE_STYLE', { add: ['- [ ] Check the sync flag'] }],
    ['E_TITLE_STYLE', { add: ['Check the sync flag (due friday)'] }],
    ['E_TITLE_STYLE', { add: ['Ship the build (done 2026-10-01)'] }],
    ['E_TITLE_STYLE', { add: ['Ship the build (done 2026-10-01).'] }],
    ['E_TITLE_STYLE', { edit: [{ ref: 'release notes', title: 'Write the release notes (DONE 2026-10-01)' }] }],
    ['E_TITLE_STYLE', { edit: [{ ref: 'release notes', title: 'Write the notes\nand ship them' }] }],
    ['E_DETAIL_SIZE', { add: [{ title: 'Check the sync flag', detail: Array.from({ length: 9 }, (_, i) => `line ${i}`) }] }],
    ['E_DETAIL_SIZE', { edit: [{ ref: 'release notes', detail: ['d'.repeat(161)] }] }],
    ['E_LOG_SIZE', { now: NOW_LINE, log: [] }],
    ['E_LOG_SIZE', { now: NOW_LINE, log: ['', '  '] }],
    ['E_LOG_SIZE', { now: NOW_LINE, log: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s) => `Did thing ${s}`) }],
    ['E_LOG_SIZE', { now: NOW_LINE, log: ['l'.repeat(201)] }],
    ['E_NAME_LENGTH', { name: 'X' }, '---\nblip: 3\n---\n'],
    ['E_NAME_LENGTH', { name: 'N'.repeat(33) }, '---\nblip: 3\n---\n'],
    ['E_NAME_STYLE', { name: 'lantern-notes' }, '---\nblip: 3\n---\n'],
    ['E_NAME_STYLE', { name: 'Lantern/Notes' }, '---\nblip: 3\n---\n'],
    ['E_DATE', { add: [{ title: 'Check the sync flag', due: '2026-02-31' }] }],
    ['E_DATE', { edit: [{ ref: 'release notes', due: 'friday' }] }],
    ['E_HUMAN_OWNED', { status: 'paused' }],
    ['E_HUMAN_OWNED', { status: 'archived' }],
    ['E_HUMAN_OWNED', { name: 'Lantern Two' }],
    ['E_SECRET', { now: NOW_LINE, log: ['Set TOKEN=abc123def456 in the deploy config'] }],
    ['E_SECRET', { add: [{ title: 'Rotate the deploy key', detail: ['old one: ghp_abcdefghijklmnopqrstuvwxyz0123'] }] }],
    ['E_SECRET', { now: NOW_LINE, log: ['Router admin password: Spring1! for the demo'] }],
    ['E_TASK_GONE', { done: ['nothing like this'] }],
    ['E_TASK_GONE', { rev: 'REV', remove: [9] }],
    ['E_TASK_GONE', { remove: ['release notes'] }],
    ['E_CONFLICT', { done: ['Write the release notes for 4.2'], add: ['Write the release notes for 4.2'] }],
    ['E_CONFLICT', { remove: ['Write the release notes for 4.2'], add: [{ title: 'write the release notes for 4.2.', top: true }] }],
    ['E_CONFLICT', { done: ['Merge the sync engine behind a flag'], add: ['Merge the sync engine behind a flag'] }],
    ['E_CONFLICT', { done: ['Write the release notes for 4.2'], reopen: ['Write the release notes for 4.2'] }],
    ['E_TASK_GONE', { done: ['the'] }],
    ['E_TASK_GONE', { reopen: ['backlog'] }],
    ['E_TASK_GONE', { edit: [{ ref: 'release notes', due: '2026-11-01' }] }],
    ['E_TASK_GONE', { move: [{ ref: 'release notes', to: 'top' }] }],
    ['E_REF_AMBIGUOUS', { done: ['Deploy'] }, '---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Deploy\n- [ ] Deploy\n'],
  ];
  it.each(cases)('%s ← %j', async (code, raw, text) => {
    // A payload that needs the real rev gets it, so the rejection is for the reason under test.
    const withRev = JSON.parse(JSON.stringify(raw).replace('"REV"', JSON.stringify((await readProject(project(text))).rev))) as unknown;
    expect((await rejected(withRev, text)).code).toBe(code);
  });

  it('never repeats the secret itself', async () => {
    const err = await rejected({ now: NOW_LINE, log: ['Set TOKEN=abc123def456 in the deploy config'] });
    expect(err.path).toBe('log[0]');
    expect(JSON.stringify([err.message, err.violations])).not.toContain('abc123def456');
  });

  it('a payload with three violations returns all three, each with its path and measured length', async () => {
    const err = await rejected({
      now: NOW_LINE,
      log: ['Fixed the lockout', 'Wrote the notes', 'b'.repeat(231)],
      add: [{ title: 'a'.repeat(112) }, { title: 'Fine', detail: ['ok', 'd'.repeat(170)] }],
    });
    expect(err.code).toBe('E_PAYLOAD_INVALID');
    expect(err.violations).toEqual([
      { code: 'E_LOG_SIZE', path: 'log[2]', message: 'log[2] is 231 chars (max 200)' },
      { code: 'E_TITLE_LENGTH', path: 'add[0].title', message: 'add[0].title is 112 chars (max 80) — keep the action in the title and move the rest into "detail"' },
      { code: 'E_DETAIL_SIZE', path: 'add[1].detail[1]', message: 'add[1].detail[1] is 170 chars (max 160)' },
    ]);
  });

  it('a v2 payload is refused with the setup hint', async () => {
    const err = await rejected({ session: ['Did some work'], tasks: { done: [1], add: ['x'] }, fields: { horizon: 'today' } });
    expect(err.code).toBe('E_PAYLOAD_V2');
    expect(err.hint).toBe('the /blip skill on this machine is from v2 — run "radar-blip setup"');
  });

  it.each(V2)('any write to a v2 file is E_NEEDS_MIGRATE: %s', async (rel) => {
    for (const raw of [{}, { add: ['Check the sync flag'] }, { now: NOW_LINE, log: ['Fixed the lockout'] }]) {
      const err = await rejected(raw, fixture(rel));
      expect(err.code).toBe('E_NEEDS_MIGRATE');
      expect(err.hint).toBe('this file is in the v2 format — the owner runs "radar-blip migrate" once');
    }
  });

  it.each(READONLY)('a file the engine cannot write is refused: %s', async (rel) => {
    expect((await rejected({ add: ['Check the sync flag'] }, fixture(rel))).code).toBe(rel.includes('broken') ? 'E_UNWRITABLE' : 'E_NEWER_SCHEMA');
  });
});

describe('sync: integer refs are tied to the brief they came from', () => {
  it('a number without rev is E_REV_REQUIRED', async () => {
    const err = await rejected({ done: [1], move: [{ ref: 2, to: 'top' }] });
    expect(err).toMatchObject({ code: 'E_REV_REQUIRED', path: 'rev' });
  });

  it('a rev from before another write is E_STALE_REFS, with the current list, and the file is unchanged', async () => {
    const dir = project();
    const { rev } = await readProject(dir);
    await updateProject(dir, [{ op: 'task.add', title: 'Slip in ahead of everything', before: { title: TITLES[0]! } }], { actor: 'human', now: NOW, author: 'Robin' });
    const before = bytesOf(dir);
    const err = await sync(dir, { rev, remove: [1] }).catch((e: unknown) => e as BlipError);
    expect(err).toMatchObject({ code: 'E_STALE_REFS' });
    expect((err as BlipError).hint).toContain('1. Slip in ahead of everything\n2. Design the conflict screen');
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it('with the current rev a number means the task the brief showed', async () => {
    const dir = project();
    const { rev } = await readProject(dir);
    const res = await sync(dir, { rev, done: [3], edit: [{ ref: 2, due: null }], move: [{ ref: 4, to: 'top' }], remove: [1] });
    expect(res.doc.tasks.open.map((t) => [t.title, t.due])).toEqual([
      [TITLES[3], null],
      [TITLES[1], null],
    ]);
    expect(res.doc.tasks.done[0]).toMatchObject({ title: TITLES[2], doneOn: '2026-10-13' });
  });
});

describe('sync: string refs', () => {
  const text = '---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Deploy the docs site\n- [ ] Deploy\n- [ ] Write the docs index\n';

  it('an exact title wins over a longer title that contains it', async () => {
    const dir = project(text);
    const res = await sync(dir, { done: ['deploy'] });
    expect(res.doc.tasks.open.map((t) => t.title)).toEqual(['Deploy the docs site', 'Write the docs index']);
  });

  it('a whole title resolves whatever its case and spacing, with or without its final full stop', async () => {
    const dir = project(text);
    const res = await sync(dir, { done: ['  deploy   THE docs site. '] });
    expect(res.doc.tasks.done.map((t) => t.title)).toEqual(['Deploy the docs site']);
  });

  it.each([
    ['done', { done: ['docs SITE'] }],
    ['reopen', { reopen: ['docs SITE'] }],
    ['edit', { edit: [{ ref: 'docs SITE', due: '2026-11-01' }] }],
    ['move', { move: [{ ref: 'docs SITE', to: 'bottom' }] }],
    ['remove', { remove: ['docs SITE'] }],
  ])('part of a title is E_TASK_GONE for %s, and the hint lists the tasks it is part of', async (_key, raw) => {
    const err = await rejected(raw, text);
    expect(err.code).toBe('E_TASK_GONE');
    expect(err.hint).toContain('name the task by its whole title, or by its number with "rev"');
    expect(err.hint).toContain('1. Deploy the docs site');
    expect(err.hint).not.toContain('Write the docs index');
  });

  it('part of two titles is E_TASK_GONE too, with both listed by number', async () => {
    const err = await rejected({ done: ['docs'] }, text);
    expect(err.code).toBe('E_TASK_GONE');
    expect(err.hint).toContain('1. Deploy the docs site\n3. Write the docs index');
    expect(err.hint).not.toContain('2. Deploy\n');
  });

  it('done "Deploy" with one done and one open "Deploy" completes the open one', async () => {
    const dir = project('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Deploy\n\n## Done\n\n- [x] Deploy (done 2026-10-01)\n');
    const res = await sync(dir, { done: ['Deploy'] });
    expect(res.report).toEqual([{ kind: 'done', text: 'Deploy' }]);
    expect(res.doc.tasks.open).toEqual([]);
    expect(res.doc.tasks.done.map((t) => t.doneOn)).toEqual(['2026-10-13', '2026-10-01']);

    // The same payload again finds two finished "Deploy" and no open one: a skip, not an error.
    const once = textOf(dir);
    const again = await sync(dir, { done: ['Deploy'] });
    expect(again).toMatchObject({ changed: false, report: [{ kind: 'skipped', text: 'already done: Deploy' }] });
    expect(textOf(dir)).toBe(once);
  });

  it('two open tasks with the same title are still E_REF_AMBIGUOUS', async () => {
    expect((await rejected({ done: ['Deploy'] }, '---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Deploy\n- [ ] Deploy\n')).code).toBe('E_REF_AMBIGUOUS');
  });

  it('"remove" takes the whole title: a replay never deletes another task that contains the words', async () => {
    const dir = project('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Deploy the docs\n- [ ] Keep me\n\n## Done\n\n- [x] Deploy the docs site (done 2026-10-01)\n');
    const first = await sync(dir, { remove: ['deploy the docs'] });
    expect(first.report).toEqual([{ kind: 'removed', text: 'Deploy the docs' }]);
    const once = bytesOf(dir);
    const err = await sync(dir, { remove: ['deploy the docs'] }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'E_TASK_GONE' });
    expect((err as BlipError).hint).toContain('(done) Deploy the docs site');
    expect(bytesOf(dir).equals(once)).toBe(true);
  });

  it('"remove" of one of two open tasks where one title contains the other is not replayed onto the longer one', async () => {
    const dir = project(text);
    await sync(dir, { remove: ['Deploy'] });
    const once = bytesOf(dir);
    await expect(sync(dir, { remove: ['Deploy'] })).rejects.toMatchObject({ code: 'E_TASK_GONE' });
    expect(bytesOf(dir).equals(once)).toBe(true);
  });

  it('a replayed "done" finds the task it already completed, never another that contains the words', async () => {
    const dir = project(text);
    await sync(dir, { done: ['Deploy'] });
    const once = textOf(dir);
    const again = await sync(dir, { done: ['Deploy'] });
    expect(again).toMatchObject({ changed: false, report: [{ kind: 'skipped' }] });
    expect(textOf(dir)).toBe(once);
  });
});

describe('sync: what a payload does', () => {
  it('applies every key in the fixed order and reports each line', async () => {
    const dir = project();
    const res = await sync(dir, {
      now: NOW_LINE,
      log: ['Designed the conflict screen', 'Switched sync on for the test group'],
      done: ['Design the conflict screen so sync can be switched on'],
      reopen: ['Move the backlog out of the old tracker'],
      edit: [{ ref: 'Renew the signing certificate', title: 'Install the new signing certificate', detail: ['It arrived on Friday.'], due: '2026-10-30' }],
      move: [{ ref: 'Robin: approve the wording in PR #21', to: 1 }],
      remove: ['write the release notes for 4.2'],
      add: [{ title: 'Watch the error log for a week', top: true }, { title: 'Plan the 4.3 release', top: true }, 'Archive the old sketches'],
      status: 'active',
    });
    expect(res.changed).toBe(true);
    expect(res.doc.tasks.open.map((t) => t.title)).toEqual([
      'Watch the error log for a week',
      'Plan the 4.3 release',
      'Robin: approve the wording in PR #21',
      'Install the new signing certificate',
      'Move the backlog out of the old tracker',
      'Archive the old sketches',
    ]);
    expect(res.doc.tasks.open[3]).toMatchObject({ detail: ['It arrived on Friday.'], due: '2026-10-30' });
    // The reopened task kept its own detail line.
    expect(res.doc.tasks.open[4]!.detail).toEqual(['The export lives in docs/backlog-2026.csv.']);
    expect(res.doc).toMatchObject({ status: 'active', now: NOW_LINE });
    expect(res.doc.log[0]).toMatchObject({ heading: '2026-10-13 14:05 — Robin + Claude', bullets: ['Designed the conflict screen', 'Switched sync on for the test group'] });
    expect(res.report.map((r) => r.kind)).toEqual(['done', 'reopened', 'edited', 'moved', 'removed', 'added', 'added', 'added', 'set', 'set', 'logged']);
    expect(textOf(dir)).toBe(res.doc ? (await readProject(dir)).file.toString() : '');
  });

  it('a title-ref payload applied twice equals applied once, byte for byte', async () => {
    const payload = {
      now: NOW_LINE,
      log: ['Designed the conflict screen', 'Switched sync on for the test group'],
      done: ['Design the conflict screen so sync can be switched on'],
      reopen: ['Move the backlog out of the old tracker'],
      edit: [{ ref: 'Renew the signing certificate', detail: ['It arrived on Friday.'], due: null }],
      move: [{ ref: 'Robin: approve the wording in PR #21', to: 'top' }, { ref: 'Write the release notes for 4.2', to: 'bottom' }],
      add: [{ title: 'Watch the error log for a week', top: true }, 'Archive the old sketches'],
      status: 'active',
    };
    const dir = project();
    expect((await sync(dir, payload)).changed).toBe(true);
    const once = bytesOf(dir);
    const again = await sync(dir, payload, { now: new Date(NOW.getTime() + 3 * 86_400_000) });
    expect(again.changed).toBe(false);
    expect(again.report.every((r) => r.kind === 'skipped')).toBe(true);
    expect(bytesOf(dir).equals(once)).toBe(true);
  });

  it('{} writes nothing to BLIP.md and records lastSyncAt', async () => {
    const dir = project();
    const before = bytesOf(dir);
    const res = await sync(dir, {});
    expect(res).toMatchObject({ changed: false, report: [], removed: [] });
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(await readState(projectId(dir))).toEqual({ lastSyncAt: NOW.toISOString(), lastNudgeAt: null, dirtyAtSync: {} });
  });

  it('a sync that changes the file records lastSyncAt too; a dry run records and writes nothing', async () => {
    const dir = project();
    const before = bytesOf(dir);
    const dry = await sync(dir, { add: ['Archive the old sketches'], remove: ['Write the release notes for 4.2'] }, { dryRun: true });
    expect(dry.changed).toBe(true);
    expect(dry.doc.tasks.open.at(-1)!.title).toBe('Archive the old sketches');
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(readdirSync(data)).toEqual(['locks']);
    expect(readdirSync(join(data, 'locks'))).toEqual([]);
    await sync(dir, { add: ['Archive the old sketches'] });
    expect((await readState(projectId(dir))).lastSyncAt).toBe(NOW.toISOString());
  });

  it('remove, and edit replacing existing detail, leave the old block in the trash file', async () => {
    const dir = project();
    await sync(dir, { remove: ['Renew the signing certificate'], edit: [{ ref: 'Design the conflict screen so sync can be switched on', detail: ['Both sketches were rejected.'] }] });
    const files = readdirSync(join(data, 'trash'));
    expect(files).toEqual([`${projectId(dir)}.md`]);
    expect(readFileSync(join(data, 'trash', files[0]!), 'utf8')).toBe(
      [
        '## 2026-10-13 14:05 — detail replaced — Robin',
        '- [ ] Design the conflict screen so sync can be switched on',
        '  Sync is merged behind the `sync_v2` flag.',
        '  Two sketches are in design/conflicts.md.',
        '  - Then flip the flag for the test group',
        '  - Watch the error log for a day',
        '',
        '## 2026-10-13 14:05 — removed — Robin',
        '- [ ] Renew the signing certificate (due 2026-10-31)',
        '  The current one expires on the first of November.',
        '',
        '',
      ].join('\n'),
    );
    // Nothing RADAR keeps lands in the project folder.
    expect(readdirSync(dir)).toEqual(['BLIP.md']);
  });

  it('an agent names a nameless or slug-named project through sync, and not a named one', async () => {
    const nameless = project('---\nblip: 3\n---\n');
    expect((await sync(nameless, { name: 'Lantern Notes' })).doc).toMatchObject({ name: 'Lantern Notes', nameSource: 'file' });
    const slug = project('---\nblip: 3\nname: lantern-notes\n---\n');
    expect((await sync(slug, { name: 'Lantern Notes' })).doc.name).toBe('Lantern Notes');
    expect((await rejected({ name: 'Lantern Two' })).code).toBe('E_HUMAN_OWNED');
  });
});

const queue = (...titles: string[]): string => `---\nblip: 3\n---\n\n# Tasks\n\n${titles.map((t) => `- [ ] ${t}\n`).join('')}`;
const openOf = async (dir: string): Promise<string[]> => (await readProject(dir)).file.doc().tasks.open.map((t) => t.title);

describe('sync: move', () => {
  it('counts a task the same payload "adds" when that task was already in the queue', async () => {
    const bottom = project(queue('Xray the pipes', 'Paint the fence', 'Aim the lights'));
    const res = await sync(bottom, { move: [{ ref: 'Xray the pipes', to: 'bottom' }], add: ['Paint the fence'] });
    expect(res.changed).toBe(true);
    expect(await openOf(bottom)).toEqual(['Paint the fence', 'Aim the lights', 'Xray the pipes']);

    const top = project(queue('Head task here', 'Aim the lights', 'Xray the pipes'));
    await sync(top, { move: [{ ref: 'Xray the pipes', to: 'top' }], add: ['Head task here'] });
    expect(await openOf(top)).toEqual(['Xray the pipes', 'Head task here', 'Aim the lights']);

    const nth = project(queue('One task', 'Two task', 'Three task', 'Four task'));
    await sync(nth, { move: [{ ref: 'Four task', to: 2 }], add: ['One task'] });
    expect(await openOf(nth)).toEqual(['One task', 'Four task', 'Two task', 'Three task']);
  });

  it('new tasks added to the top go above a task moved to the top, and new plain adds below one moved to the bottom', async () => {
    const dir = project(queue('Alpha task', 'Beta task', 'Gamma task'));
    const payload = { move: [{ ref: 'Gamma task', to: 'top' }, { ref: 'Alpha task', to: 'bottom' }], add: [{ title: 'New head', top: true }, 'New tail'] };
    await sync(dir, payload);
    expect(await openOf(dir)).toEqual(['New head', 'Gamma task', 'Beta task', 'Alpha task', 'New tail']);
    const once = bytesOf(dir);
    expect((await sync(dir, payload)).changed).toBe(false);
    expect(bytesOf(dir).equals(once)).toBe(true);
  });

  it('several moves give each task the position it was sent to, and applying them again changes nothing', async () => {
    const dir = project(queue('Aaa one', 'Bbb two', 'Ccc three', 'Ddd four'));
    const payload = { move: [{ ref: 'Aaa one', to: 3 }, { ref: 'Ddd four', to: 1 }] };
    await sync(dir, payload);
    expect(await openOf(dir)).toEqual(['Ddd four', 'Bbb two', 'Aaa one', 'Ccc three']);
    const once = bytesOf(dir);
    const again = await sync(dir, payload);
    expect(again.changed).toBe(false);
    expect(again.report.every((r) => r.kind === 'skipped')).toBe(true);
    expect(bytesOf(dir).equals(once)).toBe(true);
  });

  it('two moves to the same position, or past the end, land next to it', async () => {
    const dir = project(queue('Aaa one', 'Bbb two', 'Ccc three', 'Ddd four'));
    await sync(dir, { move: [{ ref: 'Ccc three', to: 1 }, { ref: 'Ddd four', to: 1 }, { ref: 'Aaa one', to: 9 }] });
    expect(await openOf(dir)).toEqual(['Ccc three', 'Ddd four', 'Bbb two', 'Aaa one']);
  });

  it('a task whose title ends in "(top)" is not mistaken for one moved to the top', async () => {
    const dir = project(queue('Alpha task', 'Beta task', 'Fix the header (top)'));
    const res = await sync(dir, { move: [{ ref: 'Fix the header (top)', to: 2 }] });
    expect(res.report).toEqual([{ kind: 'moved', text: 'Fix the header (top)' }]);
    const top = await sync(dir, { move: [{ ref: 'Beta task', to: 'top' }], add: [{ title: 'Gamma goes first', top: true }] });
    expect(top.report).toEqual([
      { kind: 'moved', text: 'Beta task', top: true },
      { kind: 'added', text: 'Gamma goes first', top: true },
    ]);
  });

  // A small seeded generator: the same payloads on every run.
  it('any exact-title payload of moves and adds, applied twice, equals applied once (400 seeded payloads)', () => {
    let seed = 20261013;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >>> 8) % n;
    };
    const pool = ['Aaa one', 'Bbb two', 'Ccc three', 'Ddd four', 'Eee five', 'Fff six'];
    const extra = ['New one', 'New two', 'New three'];
    const ctx = { actor: 'agent' as const, now: NOW, author: 'Robin' };
    const apply = (text: string, payload: unknown): string => {
      const file = parseBlip(text, { dirName: 'fuzz' });
      applyEdit(file, syncToOps(file.doc(), parseSyncPayload(payload), 'rev'), ctx);
      return file.toString();
    };
    for (let i = 0; i < 400; i++) {
      const titles = pool.slice(0, 2 + rnd(5));
      const move = Array.from({ length: rnd(4) }, () => ({ ref: titles[rnd(titles.length)]!, to: ['top', 'bottom', 1 + rnd(7)][rnd(3)] }));
      // Adds are new titles, titles already in the queue, and now and then the same title twice.
      const add = Array.from({ length: rnd(4) }, () => ({ title: rnd(3) ? extra[rnd(extra.length)]! : titles[rnd(titles.length)]!, top: rnd(2) === 1 }));
      const payload = { move, add };
      const once = apply(queue(...titles), payload);
      expect(apply(once, payload), JSON.stringify({ titles, payload })).toBe(once);
    }
  });
});

describe('sync: titles and duplicates', () => {
  it('a title is read back exactly as it was written', async () => {
    const dir = project(queue('Alpha task'));
    const titles = ['Ship (done) the build', 'Check what "done 2026-10-01" means in the log', 'Ask about the (done 2026-10-01) column'];
    const res = await sync(dir, { add: titles });
    expect(res.doc.tasks.open.map((t) => t.title)).toEqual(['Alpha task', ...titles]);
    expect(await openOf(dir)).toEqual(['Alpha task', ...titles]);
    expect((await sync(dir, { add: titles })).changed).toBe(false);
  });

  it('the owner cannot add a title ending in a done stamp either', async () => {
    const dir = project(queue('Alpha task'));
    const before = bytesOf(dir);
    const human = { actor: 'human' as const, now: NOW, author: 'Robin' };
    await expect(updateProject(dir, [{ op: 'task.add', title: 'Ship the thing (done 2026-10-01)' }], human)).rejects.toMatchObject({ code: 'E_TITLE_STYLE' });
    await expect(updateProject(dir, [{ op: 'task.edit', task: { title: 'Alpha task' }, title: 'Alpha task (done 2026-10-01)' }], human)).rejects.toMatchObject({ code: 'E_TITLE_STYLE' });
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it('reopen never makes a second open task with the same title', async () => {
    const dir = project('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Deploy\n- [ ] Other thing\n\n## Done\n\n- [x] Deploy (done 2026-01-01)\n');
    const before = bytesOf(dir);
    const res = await sync(dir, { reopen: ['Deploy'] });
    expect(res).toMatchObject({ changed: false, report: [{ kind: 'skipped', text: 'already open: Deploy' }] });
    expect(bytesOf(dir).equals(before)).toBe(true);
    // The open one can still be named.
    expect((await sync(dir, { done: ['Deploy'] })).report).toEqual([{ kind: 'done', text: 'Deploy' }]);
  });

  it('a skipped reopen does not count as a task in the queue when the same payload moves and adds', async () => {
    const dir = project('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Aaa one\n- [ ] Deploy\n- [ ] Bbb two\n\n## Done\n\n- [x] Deploy (done 2026-01-01)\n');
    const payload = { reopen: ['Deploy'], move: [{ ref: 'Aaa one', to: 'bottom' }], add: ['New three'] };
    await sync(dir, payload);
    expect(await openOf(dir)).toEqual(['Deploy', 'Bbb two', 'Aaa one', 'New three']);
    const once = bytesOf(dir);
    expect((await sync(dir, payload)).changed).toBe(false);
    expect(bytesOf(dir).equals(once)).toBe(true);
  });

  it('a finished task retitled onto an open one cannot be reopened into a duplicate', async () => {
    const dir = project('---\nblip: 3\n---\n\n# Tasks\n\n- [ ] Alpha task\n\n## Done\n\n- [x] Old task (done 2026-01-01)\n');
    await sync(dir, { edit: [{ ref: 'Old task', title: 'Alpha task' }] });
    await sync(dir, { reopen: ['Alpha task'] });
    expect(await openOf(dir)).toEqual(['Alpha task']);
  });

  it('a lone surrogate typed by the owner is stored as the replacement character, once', async () => {
    const dir = project(queue('Alpha task'));
    const human = { actor: 'human' as const, now: NOW, author: 'Robin' };
    const first = await updateProject(dir, [{ op: 'task.add', title: 'Fix the \ud800 thing' }], human);
    expect(first.doc.tasks.open.map((t) => t.title)).toEqual(['Alpha task', 'Fix the � thing']);
    expect((await updateProject(dir, [{ op: 'task.add', title: 'Fix the \ud800 thing' }], human)).changed).toBe(false);
    expect(await openOf(dir)).toEqual(['Alpha task', 'Fix the � thing']);
  });

  it('"set tags" reports what was stored, not what was typed', async () => {
    const dir = project(queue('Alpha task'));
    const res = await updateProject(dir, [{ op: 'set', field: 'tags', value: ['Big Tag', 'c++', 'x'] }], { actor: 'human', now: NOW, author: 'Robin' });
    expect(res.doc.tags).toEqual(['big-tag', 'c', 'x']);
    expect(res.report).toEqual([{ kind: 'set', text: 'tags: big-tag, c, x' }]);
  });
});

describe('sync: a huge string is refused quickly', () => {
  it.each([
    ['now', (s: string) => ({ now: s }), '-eyJ'],
    ['log[0]', (s: string) => ({ now: NOW_LINE, log: [s] }), '-eyJ'],
    ['add[0].detail[0]', (s: string) => ({ add: [{ title: 'Check the sync flag', detail: [s] }] }), '-eyJ'],
    ['add[0]', (s: string) => ({ add: [s] }), '(due '],
    ['add[0]', (s: string) => ({ add: [s] }), '(due' + ' '.repeat(50)],
  ] as const)('%s made of 1 MB of %j', (path, make, piece) => {
    let caught: unknown;
    const cpu = cpuMsSync(() => {
      try {
        parseSyncPayload(make(piece.repeat(Math.ceil(1_000_000 / piece.length))));
      } catch (err) {
        caught = err;
      }
    });
    expect(cpu).toBeLessThan(1500);
    expect(caught).toMatchObject({ code: 'E_PAYLOAD_TYPE', path });
  });
});
