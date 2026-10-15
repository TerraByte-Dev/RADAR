import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_STAMP } from '../src/setup.js';
import { projectId } from '../src/paths.js';
import { fixture } from './core/fixtures.js';
import { CLI, bigV3, bytesOf, cleanPath, git, isolate, project, run, spawn, textOf, tmp } from './helpers.js';
import { FULL } from './timing.js';

let data: string;
beforeEach(() => {
  data = isolate();
});

const json = (r: { stdout: string }): any => JSON.parse(r.stdout);
const USAGE = /^usage: radar-blip /m;

describe('CLI: --version', () => {
  it("prints the version in this package's manifest and nothing else", () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(run(['--version'])).toEqual({ code: 0, stdout: `${version}\n`, stderr: '' });
    expect(run(['-v']).stdout).toBe(`${version}\n`);
  });
});

describe('CLI: strict arguments', () => {
  it('add x --top=true tops', () => {
    const dir = project();
    const r = run(['add', 'Check the sync flag', '--top=true', '--path', dir]);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    expect(json(run(['show', '--json', '--path', dir])).data.next.title).toBe('Check the sync flag');
  });

  it('add x --top=false appends, and --top=maybe is refused', () => {
    const dir = project();
    expect(run(['add', 'Check the sync flag', '--top=false', '--path', dir]).code).toBe(0);
    expect(json(run(['show', '--json', '--path', dir])).data.tasks.open.at(-1).title).toBe('Check the sync flag');
    const before = bytesOf(dir);
    const bad = run(['add', 'Another task here', '--top=maybe', '--path', dir]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(USAGE);
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it.each([
    [['show', '--jsno']],
    [['sync', '--prority', '1']],
    [['sessions']],
    [['set', '--prority', '1']],
    [['task', 'add', 'x']],
    [['init', '--force']],
    [['add']],
    [['add', 'one', 'two']],
    [['done']],
    [['set', 'horizon', 'today']],
    [['set', 'focus', 'maybe']],
    [['show', 'extra']],
    [['add', 'A task', '--due']],
    [['sync']],
    [['sync', '--file', 'x.json', '-']],
    [['sync', '-', '--agent', 'AnAgentNameThatIsFarTooLong']],
    [['track', '--hide', '--show']],
    [[]],
  ])('%j exits 1 with usage and writes nothing', (args) => {
    const dir = project();
    const before = bytesOf(dir);
    const r = run(args, { cwd: dir, input: '{}' });
    expect(r.code).toBe(1);
    expect(r.stderr + r.stdout).toMatch(USAGE);
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it('the removed inline payload flag is a usage error in --json mode too', () => {
    const dir = project();
    const r = run(['sync', '--json', '{}'], { cwd: dir });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('');
    expect(json(r).error.code).toBe('E_USAGE');
    expect(textOf(dir)).toBe(fixture('v3/full.md'));
  });

  it('--json=true is --json, for the result and for an error; --json=false is not', () => {
    const dir = project();
    const ok = run(['show', '--path', dir, '--json=true']);
    expect(ok).toMatchObject({ code: 0, stderr: '' });
    expect(json(ok)).toMatchObject({ ok: true, data: { name: 'Lantern Notes' } });

    const bad = run(['show', '--path', tmp(), '--json=true']);
    expect(bad).toMatchObject({ code: 2, stderr: '' });
    expect(json(bad).error.code).toBe('E_NO_PROJECT');

    const usage = run(['show', '--path', dir, '--json=true', '--jsno']);
    expect(usage).toMatchObject({ code: 1, stderr: '' });
    expect(json(usage).error.code).toBe('E_USAGE');

    expect(run(['show', '--path', dir, '--json=false']).stdout).toMatch(/^Lantern Notes/);
  });

  it('--flag=value works for options that take a value', () => {
    const dir = project();
    expect(run(['add', 'Check the sync flag', '--due=2026-12-01', `--path=${dir}`]).code).toBe(0);
    expect(textOf(dir)).toContain('- [ ] Check the sync flag (due 2026-12-01)');
  });
});

describe('CLI: exit codes and error output', () => {
  it('exit 2 when there is no project here', () => {
    const r = run(['show'], { cwd: tmp() });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^radar-blip: E_NO_PROJECT: /);
    expect(r.stdout).toBe('');
  });

  it('--json puts the error on stdout and nothing on stderr', () => {
    const r = run(['show', '--json'], { cwd: tmp() });
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('');
    expect(json(r)).toMatchObject({ ok: false, error: { code: 'E_NO_PROJECT', violations: [] } });
  });

  it('any write to a v2 file is E_NEEDS_MIGRATE, exit 3, bytes unchanged; reading it works', () => {
    const dir = project(fixture('v2/legacy-enums.md'));
    const before = bytesOf(dir);
    for (const args of [['add', 'Check the sync flag'], ['done', '1'], ['set', 'focus', 'on'], ['sync', '-']]) {
      const r = run([...args, '--path', dir], { input: '{}' });
      expect(r.code, args.join(' ')).toBe(3);
      expect(r.stderr).toContain('radar-blip: E_NEEDS_MIGRATE: ');
      expect(r.stderr).toContain('hint: this file is in the v2 format — the owner runs "radar-blip migrate" once');
    }
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(json(run(['show', '--json', '--path', dir])).data).toMatchObject({ schema: 2, writable: false });
    expect(run(['show', '--path', dir]).code).toBe(0);
  });

  it('a v2 payload is E_PAYLOAD_V2 with the setup hint, exit 1', () => {
    const dir = project();
    const before = bytesOf(dir);
    const r = run(['sync', '-', '--path', dir], { input: JSON.stringify({ session: ['Did some work'], tasks: { done: [1] } }) });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('radar-blip: E_PAYLOAD_V2: ');
    expect(r.stderr).toContain('hint: the /blip skill on this machine is from v2 — run "radar-blip setup"');
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it('a payload that is not JSON is E_PAYLOAD_JSON, with the parser position', () => {
    const dir = project();
    const before = bytesOf(dir);
    const r = run(['sync', '-', '--json', '--path', dir], { input: '{ "now": "half a payload' });
    expect(r.code).toBe(1);
    expect(json(r).error.code).toBe('E_PAYLOAD_JSON');
    expect(json(r).error.message).toMatch(/position \d+/);
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it('a payload file that is not there is named as such, not reported as an internal error', () => {
    const dir = project();
    const before = bytesOf(dir);
    const missing = join(tmp(), 'nope.json');
    for (const file of [missing, dir]) {
      const r = run(['sync', '--file', file, '--path', dir]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('radar-blip: E_PAYLOAD_FILE: ');
      expect(r.stderr).toContain('--file');
      expect(r.stderr).not.toContain('E_INTERNAL');
    }
    expect(json(run(['sync', '--file', missing, '--path', dir, '--json'])).error).toMatchObject({ code: 'E_PAYLOAD_FILE', path: missing });
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it('a data folder that cannot be used is exit 3 and names RADAR_BLIP_HOME', () => {
    const dir = project();
    const before = bytesOf(dir);
    const notAFolder = join(tmp(), 'a-file');
    writeFileSync(notAFolder, 'x');
    process.env.RADAR_BLIP_HOME = notAFolder;
    const r = run(['add', 'Something to do', '--path', dir]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('radar-blip: E_DATA_DIR: ');
    expect(r.stderr).toContain('RADAR_BLIP_HOME');
    expect(r.stderr).toContain(notAFolder);
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it('several violations are printed one per line, and all of them arrive in --json', () => {
    const dir = project();
    const payload = JSON.stringify({ log: ['x'.repeat(231)], add: ['y'.repeat(112)] });
    const r = run(['sync', '-', '--path', dir], { input: payload });
    expect(r.code).toBe(1);
    expect(r.stderr.split('\n').slice(0, 4)).toEqual([
      'radar-blip: E_PAYLOAD_INVALID: 3 problems — nothing was written',
      '  log[0] is 231 chars (max 200)',
      '  now is required with "log": say where the project stands now, even if only to confirm it',
      '  add[0] is 112 chars (max 80) — keep the action in the title and move the rest into "detail"',
    ]);
    expect(json(run(['sync', '-', '--json', '--path', dir], { input: payload })).error.violations.map((v: { code: string }) => v.code)).toEqual(['E_LOG_SIZE', 'E_NOW_REQUIRED', 'E_TITLE_LENGTH']);
  });

  it('lint exits 4 on an error, 0 on warnings only, and never rewrites', () => {
    const broken = project(fixture('readonly/broken-yaml.md'));
    const before = bytesOf(broken);
    const r = run(['lint', '--path', broken]);
    expect(r.code).toBe(4);
    expect(r.stdout).toMatch(/error {2}yaml-invalid/);
    expect(bytesOf(broken).equals(before)).toBe(true);

    // Every task and log write below an unclosed fence is refused, so lint must not call the file fine.
    const fenced = run(['lint', '--path', project(fixture('lint/fence-unclosed.pos.md'))]);
    expect(fenced.code).toBe(4);
    expect(fenced.stdout).toMatch(/error {2}fence-unclosed/);

    const warned = project(fixture('v3/out-of-place.md'));
    const w = run(['lint', '--path', warned]);
    expect(w.code).toBe(0);
    expect(w.stdout).toContain('done-in-queue');
    expect(textOf(warned)).toBe(fixture('v3/out-of-place.md'));
    expect(run(['lint', '--path', project()]).stdout).toBe('No problems.\n');
  });

  it('lint --all covers every tracked project', () => {
    const a = project(undefined, 'a');
    const b = project(fixture('readonly/newer-schema.md'), 'b');
    run(['track', a]);
    run(['track', b]);
    const r = run(['lint', '--all', '--json']);
    expect(r.code).toBe(4);
    expect(json(r).data.files.map((f: { dir: string; problems: { code: string }[] }) => [f.dir, f.problems.map((p) => p.code)])).toEqual([
      [a, []],
      [b, ['schema-newer']],
    ]);
  });
});

describe('CLI: a registry that had to be recovered is never silent', () => {
  it('lint --all and migrate --all say which copy they used, in text and in --json', () => {
    const a = project(undefined, 'a');
    const b = project(undefined, 'b');
    run(['track', a]);
    run(['track', b]); // registry.json.prev now lists only a
    writeFileSync(join(data, 'registry.json'), '{ this is not json');
    const recovered = 'registry.json could not be read; the previous copy was used';

    const lint = run(['lint', '--all']);
    expect(lint.code).toBe(0);
    expect(lint.stdout.split('\n')[0]).toBe(`! registry: ${recovered}`);
    expect(lint.stdout).toContain(`${join(a, 'BLIP.md')}  ok`);
    expect(json(run(['lint', '--all', '--json'])).data.warning).toBe(recovered);

    const dry = run(['migrate', '--all', '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain(`! registry: ${recovered}\nregistered: 1 project\n`);
    expect(json(run(['migrate', '--all', '--dry-run', '--json'])).data.warning).toBe(recovered);

    unlinkSync(join(data, 'registry.json.prev'));
    const lost = run(['migrate', '--all', '--dry-run']);
    expect(lost.stdout).toContain('! registry: registry.json could not be read and there is no previous copy');
    expect(lost.stdout).toContain('registered: 0 projects');
    expect(lost.stdout).toContain(`the unreadable file is ${join(data, 'registry.json')}`);
    expect(run(['lint', '--all']).stdout).toContain('! registry: registry.json could not be read and there is no previous copy');
  });

  it('there is no warning line, and a null warning in --json, when the registry is fine', () => {
    const a = project(undefined, 'a');
    run(['track', a]);
    expect(run(['lint', '--all']).stdout).toBe(`${join(a, 'BLIP.md')}  ok\n`);
    expect(json(run(['lint', '--all', '--json'])).data.warning).toBeNull();
    expect(json(run(['migrate', '--all', '--dry-run', '--json'])).data.warning).toBeNull();
  });
});

describe('CLI: init, show, add, done, set', () => {
  it('init creates the file here and registers it; init over an existing file exits 0 and changes no byte', () => {
    const dir = tmp();
    const first = run(['init', '--name', 'Lantern Notes', '--task', 'Sketch the data model'], { cwd: dir });
    expect(first).toMatchObject({ code: 0, stdout: `Created ${join(dir, 'BLIP.md')}\n` });
    const before = bytesOf(dir);
    const again = run(['init', '--name', 'Another Name', '--now', 'x'], { cwd: dir });
    expect(again).toMatchObject({ code: 0, stdout: `Already tracked ${join(dir, 'BLIP.md')}\n` });
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(Object.values(JSON.parse(readFileSync(join(data, 'registry.json'), 'utf8')).projects)).toEqual([{ dir, hidden: false }]);
  });

  it('init over a v2 file or a broken one exits 0 and changes no byte', () => {
    for (const rel of ['v2/legacy-enums.md', 'readonly/broken-yaml.md']) {
      const dir = project(fixture(rel));
      const before = bytesOf(dir);
      expect(run(['init'], { cwd: dir }).code).toBe(0);
      expect(bytesOf(dir).equals(before)).toBe(true);
    }
  });

  it('init makes a nested project in the folder it is run in, not the one above', () => {
    const outer = project();
    const inner = join(outer, 'archive', 'inner');
    mkdirSync(inner, { recursive: true });
    expect(run(['init'], { cwd: inner }).code).toBe(0);
    expect(existsSync(join(inner, 'BLIP.md'))).toBe(true);
    expect(textOf(outer)).toBe(fixture('v3/full.md'));
  });

  it('show prints the project; show --json is the read model', () => {
    const dir = project();
    const text = run(['show'], { cwd: dir }).stdout;
    expect(text).toContain('Lantern Notes  ★  [blocked]');
    expect(text).toContain('  2. Renew the signing certificate  (due 2026-10-31)');
    const doc = json(run(['show', '--json'], { cwd: dir })).data;
    expect(Object.keys(doc)).toEqual(['schema', 'name', 'nameSource', 'now', 'status', 'focus', 'due', 'tags', 'links', 'tasks', 'next', 'log', 'lastLogAt', 'writable', 'problems']);
    expect(doc.tasks.open).toHaveLength(4);
  });

  it('commands resolve the project from a subfolder', () => {
    const dir = project();
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
    expect(run(['add', 'Check the sync flag'], { cwd: join(dir, 'src', 'deep') }).code).toBe(0);
    expect(textOf(dir)).toContain('- [ ] Check the sync flag');
  });

  it('add takes detail and a due date; done takes a number or part of a title', () => {
    const dir = project();
    expect(run(['add', 'Check the sync flag', '--detail', 'First line', '--detail=- a bullet', '--due', '2026-12-01', '--path', dir]).stdout).toBe('+ added    Check the sync flag\n');
    expect(textOf(dir)).toContain('- [ ] Check the sync flag (due 2026-12-01)\n  First line\n  - a bullet\n');
    expect(run(['done', '2', '--path', dir]).stdout).toBe('✔ done     Renew the signing certificate\n');
    expect(run(['done', 'release notes', '--path', dir]).stdout).toBe('✔ done     Write the release notes for 4.2\n');
    expect(run(['done', 'release notes', '--path', dir]).stdout).toContain('· skipped  already done');
    const gone = run(['done', '9', '--path', dir]);
    expect(gone.code).toBe(1);
    expect(gone.stderr).toContain('E_TASK_GONE');
    expect(run(['add', 'Bad date', '--due', '2026-02-31', '--path', dir]).stderr).toContain('E_DATE');
    // A value that starts with a dash has to be attached with "=": the parser says so instead of guessing.
    const dash = run(['add', 'Another task', '--detail', '- a bullet', '--path', dir]);
    expect(dash.code).toBe(1);
    expect(dash.stderr).toContain('--detail=-XYZ');
  });

  it('set changes each of its five fields', () => {
    const dir = project();
    const set = (field: string, value: string): number => run(['set', field, value, '--path', dir]).code;
    const doc = (): any => json(run(['show', '--json', '--path', dir])).data;

    expect(set('name', 'Lantern')).toBe(0);
    expect(doc().name).toBe('Lantern');
    for (const status of ['paused', 'archived', 'active', 'blocked']) {
      expect(set('status', status)).toBe(0);
      expect(doc().status).toBe(status);
    }
    expect(set('focus', 'off')).toBe(0);
    expect(doc().focus).toBe(false);
    expect(textOf(dir)).not.toContain('focus');
    expect(set('focus', 'on')).toBe(0);
    expect(doc().focus).toBe(true);
    expect(set('due', '2027-01-15')).toBe(0);
    expect(doc().due).toBe('2027-01-15');
    expect(set('due', 'none')).toBe(0);
    expect(doc().due).toBeNull();
    expect(set('tags', 'Client Work, ops')).toBe(0);
    expect(doc().tags).toEqual(['client-work', 'ops']);
    expect(set('tags', 'none')).toBe(0);
    expect(doc().tags).toEqual([]);
    expect(run(['set', 'tags', 'Big Tag, c++,  ,x', '--path', dir]).stdout).toBe('= set      tags: big-tag, c, x\n');
    expect(run(['set', 'tags', 'none', '--path', dir]).stdout).toBe('= set      tags: cleared\n');

    expect(set('due', 'friday')).toBe(1);
    expect(set('status', 'shipped')).toBe(1);
    // Everything else in the file is as it was.
    expect(textOf(dir).slice(textOf(dir).indexOf('# Tasks'))).toBe(fixture('v3/full.md').slice(fixture('v3/full.md').indexOf('# Tasks')));
    expect(textOf(dir)).toContain('owner_note: "kept: exactly as written"');
  });
});

describe('CLI: sync', () => {
  it('applies a payload from stdin and prints the report lines', () => {
    const dir = project();
    const payload = { now: 'Sync is on for the test group.', log: ['Designed the conflict screen'], done: ['Design the conflict screen so sync can be switched on'], add: [{ title: 'Watch the error log', top: true }], remove: ['Write the release notes for 4.2'] };
    const r = run(['sync', '-', '--agent', 'Claude', '--path', dir], { input: JSON.stringify(payload) });
    expect(r.code).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      '✔ done     Design the conflict screen so sync can be switched on',
      '✕ removed (copy kept) Write the release notes for 4.2',
      '+ added    Watch the error log (top)',
      '= set      now: Sync is on for the test group.',
      '▸ logged   1 line',
      '',
    ]);
    expect(textOf(dir)).toMatch(/## \d{4}-\d{2}-\d{2} \d{2}:\d{2} — .+ \+ Claude\n- Designed the conflict screen\n/);
  });

  it('a task moved to the top prints "↑ top"; a title that ends in "(top)" is printed whole', () => {
    const dir = project();
    expect(run(['add', 'Fix the header (top)', '--path', dir]).stdout).toBe('+ added    Fix the header (top)\n');
    const moved = run(['sync', '-', '--path', dir], { input: JSON.stringify({ move: [{ ref: 'Fix the header (top)', to: 2 }] }) });
    expect(moved.stdout).toBe('↕ moved    Fix the header (top)\n');
    const top = run(['sync', '-', '--path', dir], { input: JSON.stringify({ move: [{ ref: 'Fix the header (top)', to: 'top' }] }) });
    expect(top.stdout).toBe('↑ top      Fix the header (top)\n');
    expect(run(['add', 'Check the sync flag', '--top', '--path', dir]).stdout).toBe('+ added    Check the sync flag (top)\n');
  });

  it('an edit that replaces a task\'s detail says the old detail was kept; one that only retitles does not', () => {
    const dir = project();
    const r = run(['sync', '-', '--path', dir], { input: JSON.stringify({ edit: [{ ref: 'Renew the signing certificate', detail: ['Order it from the usual issuer'] }] }) });
    expect(r.stdout).toBe('✎ edited   Renew the signing certificate (old detail kept)\n');
    const t = run(['sync', '-', '--path', dir], { input: JSON.stringify({ edit: [{ ref: 'Write the release notes for 4.2', title: 'Write the 4.2 release notes' }] }) });
    expect(t.stdout).toBe('✎ edited   Write the 4.2 release notes\n');
  });

  it('{} writes nothing to BLIP.md, says so, and records lastSyncAt', () => {
    const dir = project();
    const before = bytesOf(dir);
    const r = run(['sync', '-', '--path', dir], { input: '{}' });
    expect(r).toMatchObject({ code: 0, stdout: '· acknowledged, nothing to log\n' });
    expect(bytesOf(dir).equals(before)).toBe(true);
    const state = JSON.parse(readFileSync(join(data, 'state', `${projectId(dir)}.json`), 'utf8'));
    expect(Date.now() - new Date(state.lastSyncAt).getTime()).toBeLessThan(60_000);
  });

  it('--dry-run reports and writes nothing', () => {
    const dir = project();
    const before = bytesOf(dir);
    const r = run(['sync', '-', '--dry-run', '--path', dir], { input: JSON.stringify({ add: ['Check the sync flag'] }) });
    expect(r.stdout).toBe('dry run — nothing was written\n+ added    Check the sync flag\n');
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(existsSync(join(data, 'state'))).toBe(false);
  });

  it('a payload file under <data>/tmp is deleted after a real sync, kept after a dry run or a rejection; other files are never deleted', () => {
    const dir = project();
    mkdirSync(join(data, 'tmp'), { recursive: true });
    const inTmp = join(data, 'tmp', 'payload.json');
    const elsewhere = join(tmp(), 'payload.json');
    writeFileSync(inTmp, JSON.stringify({ add: ['Check the sync flag'] }));
    writeFileSync(elsewhere, JSON.stringify({ add: ['Archive the old sketches'] }));

    expect(run(['sync', '--file', inTmp, '--dry-run', '--path', dir]).code).toBe(0);
    expect(existsSync(inTmp)).toBe(true);
    expect(run(['sync', '--file', inTmp, '--path', dir]).code).toBe(0);
    expect(existsSync(inTmp)).toBe(false);
    expect(run(['sync', '--file', elsewhere, '--path', dir]).code).toBe(0);
    expect(existsSync(elsewhere)).toBe(true);

    writeFileSync(inTmp, JSON.stringify({ add: ['x'] }));
    expect(run(['sync', '--file', inTmp, '--path', dir]).code).toBe(1);
    expect(existsSync(inTmp)).toBe(true);
  });

  it('warns only about what this payload wrote, then one summary line for the rest of the file', () => {
    const dir = project(fixture('v3/out-of-place.md').replace('- [ ] Port the blog to the new template', '- [ ] PORT THE WHOLE BLOG TO THE NEW TEMPLATE'));
    const r = run(['sync', '-', '--path', dir], { input: JSON.stringify({ now: 'Working on the blog.', log: ['Ported two posts'] }) });
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines.filter((l) => l.startsWith('! '))).toEqual(['! now-style: the Now line says little: say what state the project is in and what it is waiting on']);
    expect(lines.at(-1)).toBe('1 older warning in this file: radar-blip lint');
    expect(r.stdout).not.toContain('title-shouting');
  });

  it('a registry that cannot be written does not fail the sync, and the output says so', () => {
    expect(run(['track', project(undefined, 'other')]).code).toBe(0);
    // The copy to registry.json.prev cannot succeed while a folder sits at that path.
    mkdirSync(join(data, 'registry.json.prev'));
    const dir = project();
    const r = run(['sync', '-', '--path', dir], { input: JSON.stringify({ add: ['Check the sync flag'] }) });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/\nregistry: could not register this project \(.+\) — it will be retried on the next sync\n$/);
    expect(textOf(dir)).toContain('- [ ] Check the sync flag');
  });
});

// Two writers are enough for any lost update to show; more of them add hand-offs and a queue.
// The default run holds 2 × 15 and 4 × 5; RADAR_TEST_FULL runs 2, 4 and 8 × 15.
const CONCURRENT_SYNCS: [number, number][] = FULL ? [[2, 15], [4, 15], [8, 15]] : [[2, 15], [4, 5]];

describe('CLI: concurrent syncs never lose a write', () => {
  it.each(CONCURRENT_SYNCS)('%i processes × %i rounds on the 83 KB file: every add is present or its process exited non-zero', async (n, rounds) => {
    const dir = project(bigV3());
    expect(bytesOf(dir).length).toBeGreaterThan(80_000);
    const accepted: string[] = [];
    const refused: string[] = [];
    for (let round = 0; round < rounds; round++) {
      const titles = Array.from({ length: n }, (_, i) => `Round ${round} writer ${i} of ${n} adds this task`);
      const ran = await Promise.all(titles.map((title) => spawn(CLI, ['sync', '-', '--path', dir], JSON.stringify({ add: [title] }))));
      ran.forEach((r, i) => {
        if (r.code === 0) accepted.push(titles[i]!);
        else refused.push(`${r.code} ${r.stderr.split('\n')[0]}`);
      });
    }
    const open = new Set<string>(json(run(['show', '--json', '--path', dir])).data.tasks.open.map((t: { title: string }) => t.title));
    const lost = accepted.filter((t) => !open.has(t));
    expect(lost).toEqual([]);
    expect(accepted.length + refused.length).toBe(n * rounds);
    // A writer that gave up said so, and only because the file stayed busy past its wait: never
    // a crash, never a write it claimed and lost.
    for (const r of refused) expect(r).toMatch(/^3 radar-blip: E_BUSY: /);
    // With one other writer, or on an idle machine, the 5 s wait is ample and nobody gives up.
    // Several writers on a loaded machine can queue past it, which is the lock doing its job.
    if (n === 2 || FULL) expect(refused).toEqual([]);
    expect(readdirSync(dir)).toEqual(['BLIP.md']);
  }, 300_000);
});

describe('CLI: track', () => {
  it('tracks, hides, shows and removes; the BLIP.md is never touched', () => {
    const dir = project();
    const before = bytesOf(dir);
    const sub = join(dir, 'src');
    mkdirSync(sub);
    const entries = (): unknown[] => Object.values(JSON.parse(readFileSync(join(data, 'registry.json'), 'utf8')).projects);

    expect(run(['track', sub]).stdout).toBe(`+ now tracked: ${dir}\n`);
    expect(run(['track'], { cwd: dir }).stdout).toBe(`· already tracked: ${dir}\n`);
    expect(run(['track', '--hide', dir]).stdout).toBe(`hidden: ${dir}\n`);
    expect(entries()).toEqual([{ dir, hidden: true }]);
    expect(run(['track', '--hide', dir]).stdout).toBe(`already hidden: ${dir}\n`);
    expect(run(['track', '--show', dir]).stdout).toBe(`shown: ${dir}\n`);
    expect(entries()).toEqual([{ dir, hidden: false }]);
    expect(run(['track', '--remove', dir]).code).toBe(0);
    expect(entries()).toEqual([]);
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(run(['track', tmp()]).code).toBe(2);
  });

  it('--remove clears an entry whose folder is gone', () => {
    const gone = join(tmp(), 'no-longer-here');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'registry.json'), JSON.stringify({ version: 1, projects: { [process.platform === 'win32' ? gone.toLowerCase() : gone]: { dir: gone, hidden: true } } }));
    expect(run(['track', '--remove', gone]).stdout).toContain('no longer tracked');
    expect(JSON.parse(readFileSync(join(data, 'registry.json'), 'utf8')).projects).toEqual({});
  });

  it('--hide, --show and --remove on a tracked folder whose BLIP.md is gone act on that entry, not on the project above it', () => {
    const parent = project(undefined, 'parent');
    const child = join(parent, 'archive', 'sketches');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(child, 'BLIP.md'), '---\nblip: 3\n---\n');
    const entries = (): unknown[] => Object.values(JSON.parse(readFileSync(join(data, 'registry.json'), 'utf8')).projects);
    run(['track', parent]);
    run(['track', child]);
    run(['track', '--hide', parent]);
    expect(entries()).toEqual([{ dir: parent, hidden: true }, { dir: child, hidden: false }]);

    rmSync(child, { recursive: true });
    expect(run(['track', '--hide', child]).stdout).toBe(`hidden: ${child}\n`);
    expect(entries()).toEqual([{ dir: parent, hidden: true }, { dir: child, hidden: true }]);
    expect(run(['track', '--show', child]).stdout).toBe(`shown: ${child}\n`);
    const removed = run(['track', '--remove', child]);
    expect(removed).toMatchObject({ code: 0, stdout: `- no longer tracked: ${child} (its BLIP.md is untouched)\n` });
    // The parent is still there, and still hidden.
    expect(entries()).toEqual([{ dir: parent, hidden: true }]);

    // A folder that was never tracked itself still means the project it sits in.
    mkdirSync(join(parent, 'src'));
    expect(run(['track', '--show', join(parent, 'src')]).stdout).toBe(`shown: ${parent}\n`);
    expect(run(['track', '--remove', child]).stdout).toBe(`- no longer tracked: ${parent} (its BLIP.md is untouched)\n`);
    expect(entries()).toEqual([]);
  });

  it('--find registers every project under a folder', () => {
    const root = tmp();
    for (const parts of [['a'], ['a', 'nested', 'b'], ['group', 'c']]) {
      mkdirSync(join(root, ...parts), { recursive: true });
      writeFileSync(join(root, ...parts, 'BLIP.md'), '---\nblip: 3\n---\n');
    }
    mkdirSync(join(root, 'a', 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'a', 'node_modules', 'pkg', 'BLIP.md'), 'x');
    const r = json(run(['track', '--find', root, '--json']));
    expect(r.data.added.sort()).toEqual([join(root, 'a'), join(root, 'a', 'nested', 'b'), join(root, 'group', 'c')].sort());
    expect(json(run(['track', '--find', root, '--json'])).data.added).toEqual([]);
  });
});

describe('CLI: migrate', () => {
  /** A Claude config folder with the current skill and the three v3 hook entries. */
  function claudeConfig(opts: { skill?: string; hooks?: Record<string, string[]> } = {}): string {
    const dir = join(tmp(), '.claude');
    mkdirSync(join(dir, 'skills', 'blip'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'blip', 'SKILL.md'), opts.skill ?? `---\nname: blip\n---\n${SKILL_STAMP}\n# /blip\n`);
    const hooks = opts.hooks ?? { SessionStart: ['radar-blip hook session-start'], Stop: ['radar-blip hook stop'], SessionEnd: ['radar-blip hook session-end'] };
    const settings = { hooks: Object.fromEntries(Object.entries(hooks).map(([event, cmds]) => [event, cmds.map((command) => ({ hooks: [{ type: 'command', command, timeout: 10 }] }))])) };
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
    process.env.CLAUDE_CONFIG_DIR = dir;
    return dir;
  }

  it('--dry-run prints the report, changes no mtime and creates no backup', () => {
    const dir = project(fixture('v2/big-83kb.md'));
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(join(dir, 'BLIP.md'), old, old);
    const before = statSync(join(dir, 'BLIP.md')).mtimeMs;
    // The preflight is not run for a dry run: this config would fail it.
    claudeConfig({ skill: 'the v2 skill, no stamp' });

    const r = run(['migrate', '--dry-run', '--path', dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`${join(dir, 'BLIP.md')}   v2 → v3   84,506 → ~`);
    expect(r.stdout).toContain('git: not in a repo');
    expect(r.stdout).toContain('\n  keys     category "" → (no tag) · deadline → due 2026-09-08\n');
    expect(r.stdout).toContain('\n  removed  placeholder comment under # Tasks · placeholder comment under # Session log\n');
    expect(r.stdout).toMatch(/\n {2}dropped {2}horizon=today · priority=1 · radar_angle=255\.82 · last_session=/);
    expect(r.stdout).toMatch(/\n {2}kept {5}created=2026-06-04/);
    expect(r.stdout).toMatch(/\n {2}tasks {4}\d+ open: \d+ split · \d+ cut · \d+ left long · \d+ already short\n/);
    expect(r.stdout).toMatch(/\n {2}log {6}\d+ entries: /);
    expect(r.stdout).toContain('\n  still    now-missing · queue-too-long\n');
    expect(r.stdout).toMatch(/\n {2}example {2}"/);
    expect(r.stdout).toContain('registered: 0 projects\ndry run — nothing was written\n');

    expect(statSync(join(dir, 'BLIP.md')).mtimeMs).toBe(before);
    expect(textOf(dir)).toBe(fixture('v2/big-83kb.md'));
    expect(existsSync(data)).toBe(false);
  });

  it('--dry-run --json carries the same facts', () => {
    const dir = project(fixture('v2/legacy-enums.md'));
    const out = json(run(['migrate', '--dry-run', '--json', '--path', dir])).data;
    expect(out.totals).toMatchObject({ registered: 0, files: 1, wouldChange: 1, alreadyV3: 0, unwritable: 0, skippedForSecrets: 0 });
    expect(out.files[0]).toMatchObject({ dir, from: 2, changed: true, backup: null, git: 'not in a repo' });
  });

  it('migrates one file: backup and report first, then the v3 file; a second run is a no-op', () => {
    claudeConfig();
    const dir = project(fixture('v2/log-ascending-33.md'));
    const before = bytesOf(dir);
    const r = run(['migrate', '--path', dir]);
    expect(r.code).toBe(0);
    const folder = join(data, 'backups', projectId(dir));
    const [backup, report] = readdirSync(folder).sort();
    expect(readFileSync(join(folder, backup!)).equals(before)).toBe(true);
    expect(JSON.parse(readFileSync(join(folder, report!), 'utf8')).log.order).toBe('reversed');
    expect(r.stdout).toContain(`  backup   ${join(folder, backup!)}`);
    expect(json(run(['show', '--json', '--path', dir])).data).toMatchObject({ schema: 3, writable: true });

    const after = bytesOf(dir);
    const again = run(['migrate', '--path', dir]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('already v3');
    expect(bytesOf(dir).equals(after)).toBe(true);
    // The migrated file takes writes.
    expect(run(['add', 'Check the sync flag', '--path', dir]).code).toBe(0);
  });

  it('--all migrates every tracked project and reports the count', () => {
    claudeConfig();
    const a = project(fixture('v2/crlf.md'), 'a');
    const b = project(fixture('v2/legacy-enums.md'), 'b');
    const c = project(undefined, 'c');
    for (const dir of [a, b, c]) run(['track', dir]);
    const r = run(['migrate', '--all']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('changed: 2 · already v3: 1 · cannot be migrated: 0 · skipped for secrets: 0\nregistered: 3 projects\n');
    for (const dir of [a, b]) expect(json(run(['show', '--json', '--path', dir])).data.schema).toBe(3);
    expect(textOf(c)).toBe(fixture('v3/full.md'));
  });

  it('the preflight fails against a config directory holding the v2 skill: E_PREFLIGHT, exit 3, nothing changed', () => {
    const dir = project(fixture('v2/legacy-enums.md'));
    const before = bytesOf(dir);
    claudeConfig({ skill: fixtureV2Skill(), hooks: { Stop: ['radar-blip hook stop'] } });
    const r = run(['migrate', '--path', dir]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('radar-blip: E_PREFLIGHT: ');
    expect(r.stderr).toContain('the /blip skill at ');
    expect(r.stderr).toContain('settings.json has 0 "radar-blip hook session-start" entries under SessionStart');
    expect(r.stderr).toContain('hint: run "radar-blip setup", then try again');
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(existsSync(join(data, 'backups'))).toBe(false);
  });

  it('the preflight hint follows the failed check: a 2.x radar-blip on PATH is removed with npm, not fixed by setup', () => {
    const dir = project(fixture('v2/legacy-enums.md'));
    claudeConfig();
    const npm = tmp('radar-npm-');
    writeFileSync(join(npm, process.platform === 'win32' ? 'radar-blip.cmd' : 'radar-blip'), process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
    mkdirSync(join(npm, 'node_modules', 'radar-blip'), { recursive: true });
    writeFileSync(join(npm, 'node_modules', 'radar-blip', 'package.json'), JSON.stringify({ name: 'radar-blip', version: '2.0.1' }));
    const sep = process.platform === 'win32' ? ';' : ':';
    const env = { ...process.env, PATH: `${npm}${sep}${cleanPath()}` };
    for (const k of Object.keys(env)) if (k !== 'PATH' && k.toUpperCase() === 'PATH') delete env[k];
    const r = run(['migrate', '--path', dir], { env });
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('is radar-blip 2.0.1, older than 3.0.0');
    expect(r.stderr).toContain('hint: remove the 2.x radar-blip with "npm rm -g radar-blip", then try again');
    expect(r.stderr).not.toContain('radar-blip setup');
  });

  it('the report says where the file stands with git: tracked on its branch, ignored, or not tracked', () => {
    const dir = project(fixture('v2/legacy-enums.md'));
    const state = (): string => json(run(['migrate', '--dry-run', '--json', '--path', dir])).data.files[0].git;
    git(dir, 'init', '-q');
    expect(state()).toBe('not tracked');
    git(dir, 'add', 'BLIP.md');
    git(dir, 'commit', '-q', '-m', 'blip');
    expect(state()).toBe('tracked on main');
    git(dir, 'rm', '-q', '--cached', 'BLIP.md');
    writeFileSync(join(dir, '.gitignore'), 'BLIP.md\n');
    expect(state()).toBe('ignored');
  });

  it.each([
    ['a skill without the current stamp', { skillMissing: true }],
    ['a duplicated hook entry', { hooks: { SessionStart: ['radar-blip hook session-start'], Stop: ['radar-blip hook stop', '"C:/x/bin/radar-blip.cmd" hook stop'], SessionEnd: ['radar-blip hook session-end'] } }],
    ['an entry filed under the wrong event', { hooks: { SessionStart: ['radar-blip hook session-start'], Stop: ['radar-blip hook stop'], SessionEnd: ['radar-blip hook session-end'], PostToolUse: ['radar-blip hook stop'] } }],
    ['settings.json that is not JSON', { settings: '{ not json' }],
  ])('the preflight fails on %s', (_name, opts: { skillMissing?: boolean; hooks?: Record<string, string[]>; settings?: string }) => {
    const dir = project(fixture('v2/legacy-enums.md'));
    const before = bytesOf(dir);
    const config = claudeConfig(opts.hooks ? { hooks: opts.hooks } : {});
    if (opts.skillMissing) writeFileSync(join(config, 'skills', 'blip', 'SKILL.md'), 'no stamp here');
    if (opts.settings) writeFileSync(join(config, 'settings.json'), opts.settings);
    expect(run(['migrate', '--path', dir]).code).toBe(3);
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it('the preflight passes with the quoted absolute shim form of the hook commands', () => {
    const dir = project(fixture('v2/legacy-enums.md'));
    claudeConfig({ hooks: { SessionStart: ['"C:/Users/robin/radar-blip/bin/radar-blip.cmd" hook session-start'], Stop: ['"C:/Users/robin/radar-blip/bin/radar-blip.cmd" hook stop'], SessionEnd: ['"C:/Users/robin/radar-blip/bin/radar-blip.cmd" hook session-end'] } });
    expect(run(['migrate', '--path', dir]).code).toBe(0);
  });

  it('a file with a secret-shaped line is skipped without --allow-secret-shaped, and the run exits 3', () => {
    claudeConfig();
    const dir = project(fixture('lint/secret-shaped.pos.md').replace(/^blip: 3\r?\n/m, ''));
    const before = bytesOf(dir);

    const dry = run(['migrate', '--dry-run', '--path', dir]);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toMatch(/secrets {2}line 9 matches a token pattern — this file will be SKIPPED without --allow-secret-shaped/);
    expect(dry.stdout).not.toContain('not-a-real-value');

    const r = run(['migrate', '--path', dir]);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('skipped for secrets: 1');
    expect(bytesOf(dir).equals(before)).toBe(true);
    expect(existsSync(join(data, 'backups'))).toBe(false);

    expect(run(['migrate', '--allow-secret-shaped', '--path', dir]).code).toBe(0);
    expect(json(run(['show', '--json', '--path', dir])).data.schema).toBe(3);
  });

  it('no value from a secret-shaped line is ever printed: not as a dropped key, not in an example, not in --json', () => {
    claudeConfig();
    const dir = project(SECRET_V2);
    const outputs = [
      run(['migrate', '--dry-run', '--path', dir]),
      run(['migrate', '--dry-run', '--json', '--path', dir]),
      run(['migrate', '--path', dir]),
      run(['migrate', '--json', '--path', dir]),
    ];
    expect(outputs.map((r) => r.code)).toEqual([0, 0, 3, 3]);
    expect(outputs[0]!.stdout).toContain('secrets  lines 3, 8, 9 match a token pattern — this file will be SKIPPED without --allow-secret-shaped');
    expect(outputs[0]!.stdout).toContain('dropped  last_session=TOKEN=«redacted»');
    // The split examples that remain are the ones with nothing token-shaped in them.
    expect(outputs[0]!.stdout).toContain('example  "Write the long release notes for the spring version');
    expect(json(outputs[1]!).data.files[0].examples).toHaveLength(1);

    const allowed = run(['migrate', '--allow-secret-shaped', '--path', dir]);
    expect(allowed.code).toBe(0);
    const folder = join(data, 'backups', projectId(dir));
    const report = readFileSync(join(folder, readdirSync(folder).find((f) => f.endsWith('-report.json'))!), 'utf8');
    for (const text of [...outputs.map((r) => r.stdout + r.stderr), allowed.stdout, report]) {
      expect(text).not.toContain('fake-fake-fake');
      expect(text).not.toContain('not-a-real-value');
    }
  });

  it('--all goes on past a file it cannot migrate, prints what it did to the others, and exits 3', () => {
    claudeConfig();
    const [a, b, c] = ['a', 'b', 'c'].map((name) => project(fixture('v2/legacy-enums.md'), name)) as [string, string, string];
    for (const dir of [a, b, c]) run(['track', dir]);
    const before = bytesOf(b);
    // Another process holds b's lock and never lets go.
    writeFileSync(join(data, 'locks', `${projectId(b)}.lock`), JSON.stringify({ pid: 1, at: new Date().toISOString() }));

    const r = run(['migrate', '--all']);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain(`${join(b, 'BLIP.md')}   NOT MIGRATED — E_BUSY: `);
    for (const dir of [a, c]) {
      expect(r.stdout).toContain(`  backup   ${join(data, 'backups', projectId(dir))}`);
      expect(json(run(['show', '--json', '--path', dir])).data.schema).toBe(3);
    }
    expect(r.stdout).toContain('changed: 2 · already v3: 0 · cannot be migrated: 0 · skipped for secrets: 0 · failed: 1\nregistered: 3 projects\n');
    expect(bytesOf(b).equals(before)).toBe(true);

    const asJson = json(run(['migrate', '--all', '--json']));
    expect(asJson.data.failed).toEqual([{ dir: b, code: 'E_BUSY', message: expect.any(String) }]);
    expect(asJson.data.totals).toMatchObject({ alreadyV3: 2, failed: 1 });
  });

  it('an unwritable backup directory is E_BACKUP, exit 3, file unchanged', () => {
    claudeConfig();
    const dir = project(fixture('v2/legacy-enums.md'));
    const before = bytesOf(dir);
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'backups'), 'not a folder');
    const r = run(['migrate', '--path', dir]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('radar-blip: E_BACKUP: ');
    expect(bytesOf(dir).equals(before)).toBe(true);
  });
});

/**
 * A v2 file with token-shaped text in three places: a key that migration drops, a long
 * task whose split leaves the value in the title, and one whose split falls between the
 * label and the value, so neither half looks like a secret on its own.
 */
const SECRET_V2 = [
  '---',
  'status: active',
  'last_session: TOKEN=fake-fake-fake-123',
  '---',
  '',
  '# Tasks',
  '',
  '- [ ] Rotate the key TOKEN=not-a-real-value-12345 for the deploy box. Then update the runbook and tell the team it is done.',
  '- [ ] Store the staging deploy TOKEN: not-a-real-value-67890 in the vault and then update the runbook so the team knows',
  '- [ ] Write the long release notes for the spring version: cover the sync engine, the conflict screen and the new export',
  '',
  '# Session log',
  '',
  '## 2026-10-01',
  '- Rotated nothing yet',
  '',
].join('\n');

/** The opening of a v2-era skill file: no format stamp anywhere in it. */
function fixtureV2Skill(): string {
  return '---\nname: blip\ndescription: Sync or update the current project BLIP.md.\n---\n\n# /blip\n\nRun `radar-blip sync --json` with a `session` and `tasks` payload.\n';
}
