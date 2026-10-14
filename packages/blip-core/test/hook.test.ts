import { describe, it, expect, beforeEach } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runHook } from '../src/agents/claude/hook.js';
import { presenceOf, readLiveMarkers, readMarker } from '../src/agents/claude/live.js';
import { computeActivity } from '../src/activity.js';
import { parseSyncPayload } from '../src/core/sync.js';
import { readProject, syncProject } from '../src/io.js';
import { projectId } from '../src/paths.js';
import { HOOK_TIMEOUT_S } from '../src/setup.js';
import { readState, writeState } from '../src/state.js';
import { fixture } from './core/fixtures.js';
import { CLI, bytesOf, git, gitAt, isolate, run, tmp } from './helpers.js';
import { FULL, cpuMs } from './timing.js';

let data: string;
beforeEach(() => {
  data = isolate();
});

const NOW = new Date();
const at = (min: number): Date => new Date(NOW.getTime() + min * 60_000);
const BLIP = (name: string): string => `---\nblip: 3\nname: ${name}\nnow: Getting started.\n---\n\n# Tasks\n\n- [ ] Draw the first screen\n\n# Session log\n`;
const OLD = new Date(NOW.getTime() - 40 * 24 * 3600_000);
const HOOK_TIMEOUT_MS = HOOK_TIMEOUT_S * 1000;

/** A git repository at `dir` holding BLIP.md and one commit, 40 days old. */
function repo(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'BLIP.md'), BLIP(name));
  writeFileSync(join(dir, 'readme.txt'), 'hello\n');
  gitAt(dir, OLD, 'add', '-A');
  gitAt(dir, OLD, 'commit', '-q', '-m', 'start');
  return dir;
}

/** A project folder without git. */
function folder(dir: string, text: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'BLIP.md'), text);
  utimesSync(join(dir, 'BLIP.md'), OLD, OLD);
  return dir;
}

/** Commit a new file in `dir`, dated `when`. */
function commit(dir: string, file: string, when: Date): void {
  writeFileSync(join(dir, file), `${file}\n`);
  gitAt(dir, when, 'add', '--', file);
  gitAt(dir, when, 'commit', '-q', '-m', `add ${file}`);
}

type Tool = { name: string; input: Record<string, unknown> };
const write = (path: string): Tool => ({ name: 'Write', input: { file_path: path, content: 'x' } });
const edit = (path: string): Tool => ({ name: 'Edit', input: { file_path: path, old_string: 'a', new_string: 'b' } });
const bash = (command: string): Tool => ({ name: 'Bash', input: { command } });

/** A transcript line holding tool calls, as Claude Code writes it. */
const line = (cwd: string, when: Date, tools: Tool[]): string =>
  `${JSON.stringify({ type: 'assistant', timestamp: when.toISOString(), cwd, sessionId: 's', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }, ...tools.map((t, i) => ({ type: 'tool_use', id: `t${i}`, ...t }))] } })}\n`;

let seq = 0;
function session(cwd: string): { id: string; transcript: string; input: (extra?: object) => string } {
  const id = `sess-${process.pid}-${seq++}`;
  const transcript = join(tmp('radar-transcript-'), `${id}.jsonl`);
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', timestamp: NOW.toISOString(), cwd, message: { role: 'user', content: 'go' } })}\n`);
  return { id, transcript, input: (extra = {}) => JSON.stringify({ session_id: id, transcript_path: transcript, cwd, hook_event_name: 'Stop', stop_hook_active: false, ...extra }) };
}

const nudge = (out: string): { decision: string; reason: string } => JSON.parse(out) as { decision: string; reason: string };

describe('hook stop: which project, and whether to nudge', () => {
  it('a session that touched no project stays silent and records none', async () => {
    const ws = tmp('radar-ws-');
    const s = session(ws);
    appendFileSync(s.transcript, line(ws, at(-5), [write(join(ws, 'a.txt')), write(join(ws, 'b.txt')), write(join(ws, 'c.txt')), bash('git commit -m x')]));
    expect(await runHook('stop', s.input(), { now: NOW })).toBe('');
    expect((await readMarker(s.id))!.projects).toEqual({});
  });

  it('one project, three edited files: one nudge with a runnable, quoted --path for a folder with spaces', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'my sample app'), 'Sample App');
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-5), ['a.ts', 'b.ts', 'c.ts'].map((f) => write(join(dir, 'src', f)))));
    const out = nudge(await runHook('stop', s.input(), { now: NOW }));
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('RADAR: Sample App has 3 edited files not in its log.');
    expect(out.reason).toContain(`radar-blip brief --path "${dir}"`);
    expect(out.reason).toContain(`radar-blip sync --agent Claude --path "${dir}" --file "<payloadPath>"`);
    expect(out.reason).toMatch(/ If nothing is worth logging, write \{\} to that payloadPath and run the same sync command\.$/);
    expect((await readState(projectId(dir))).lastNudgeAt).toBe(NOW.toISOString());
    expect(bytesOf(dir).toString()).toBe(BLIP('Sample App'));
  });

  it('two edited files and no commit is not enough', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-5), [write(join(dir, 'a.ts')), edit(join(dir, 'b.ts'))]));
    expect(await runHook('stop', s.input(), { now: NOW })).toBe('');
  });

  it('a workspace-root session touching three projects nudges the one with the most drift, and only that one', async () => {
    const ws = tmp('radar-ws-');
    const a = repo(join(ws, 'alpha'), 'Alpha');
    const b = repo(join(ws, 'beta'), 'Beta');
    const c = repo(join(ws, 'gamma'), 'Gamma');
    commit(c, 'g.txt', at(-3));
    const s = session(ws);
    appendFileSync(s.transcript, line(ws, at(-6), [...['1', '2', '3'].map((f) => write(join(a, f))), ...['1', '2', '3', '4', '5'].map((f) => edit(join(b, f)))]));
    appendFileSync(s.transcript, line(ws, at(-3), [write(join(c, 'g.txt')), bash(`cd "${c}" && git add -A && git commit -m "add g"`)]));
    const out = nudge(await runHook('stop', s.input(), { now: NOW }));
    expect(out.reason).toContain('RADAR: Beta has 5 edited files');
    expect((await readState(projectId(b))).lastNudgeAt).not.toBeNull();
    expect((await readState(projectId(a))).lastNudgeAt).toBeNull();
    expect((await readState(projectId(c))).lastNudgeAt).toBeNull();
    const marker = (await readMarker(s.id))!;
    expect(Object.keys(marker.projects).sort()).toEqual([a, b, c].sort());
    expect(marker.projects[c]).toMatchObject({ committed: true, files: [join(c, 'g.txt')] });
  });

  it('a commit counts once git has it: one commit nudges', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    commit(dir, 'x.txt', at(-2));
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-2), [bash('git add x.txt && git commit -m "add x"')]));
    expect(nudge(await runHook('stop', s.input(), { now: NOW })).reason).toContain('has 1 commit not in its log');
  });

  it('a session in a linked worktree nudges for the main checkout, whose tracked copy in the worktree is never touched', async () => {
    const base = tmp('radar-ws-');
    const main = repo(join(base, 'main'), 'Sample App');
    const wt = join(base, 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
    const copy = readFileSync(join(wt, 'BLIP.md'));
    commit(wt, 'w.txt', at(-2));
    const s = session(wt);
    appendFileSync(s.transcript, line(wt, at(-2), [write(join(wt, 'w.txt')), bash('git commit -am "add w"')]));
    const out = nudge(await runHook('stop', s.input(), { now: NOW }));
    // The commands name the worktree: the main checkout's BLIP.md is written, and brief reports the worktree's branch.
    expect(out.reason).toContain(`radar-blip brief --path "${wt}"`);
    expect(out.reason).toContain(`radar-blip sync --agent Claude --path "${wt}"`);
    expect(out.reason).toContain('1 commit, 1 edited file');
    expect(Object.keys((await readMarker(s.id))!.projects)).toEqual([main]);
    expect(readFileSync(join(wt, 'BLIP.md')).equals(copy)).toBe(true);
    const brief = JSON.parse(run(['brief', '--path', wt, '--json']).stdout) as { data: { dir: string; since: { branch: string } } };
    expect(brief.data).toMatchObject({ dir: main, since: { branch: 'feat' } });
  });

  it('a session started in a linked worktree gets the catch-up line with the worktree in --path', async () => {
    const base = tmp('radar-ws-');
    const main = repo(join(base, 'main'), 'Sample App');
    const wt = join(base, 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
    commit(wt, 'w.txt', at(-60));
    const start = JSON.parse(await runHook('session-start', session(wt).input(), { now: NOW })) as { hookSpecificOutput: { additionalContext: string } };
    expect(start.hookSpecificOutput.additionalContext).toContain(`1 commit is not in the log: run radar-blip brief --path "${wt}" and sync`);
  });

  it('a v2 file: tells the owner to migrate, never blocks, never writes the file', async () => {
    const dir = folder(join(tmp('radar-ws-'), 'old'), fixture('v2/legacy-enums.md'));
    const before = bytesOf(dir);
    const s = session(dir);
    for (const f of ['a', 'b', 'c']) writeFileSync(join(dir, f), f);
    appendFileSync(s.transcript, line(dir, at(-5), ['a', 'b', 'c'].map((f) => write(join(dir, f)))));
    const out = JSON.parse(await runHook('stop', s.input(), { now: NOW })) as Record<string, string>;
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toContain(`Run radar-blip migrate --path "${dir}" to start logging again.`);
    expect(bytesOf(dir).equals(before)).toBe(true);
    // Once per project: new work after the 20-minute floor does not repeat it.
    appendFileSync(s.transcript, line(dir, at(5), ['d', 'e', 'f'].map((f) => write(join(dir, f)))));
    expect(await runHook('stop', s.input(), { now: at(30) })).toBe('');
    const start = JSON.parse(await runHook('session-start', s.input(), { now: NOW })) as { hookSpecificOutput: { additionalContext: string } };
    expect(start.hookSpecificOutput.additionalContext).toContain('radar-blip migrate (do not run it yourself)');
    expect(bytesOf(dir).equals(before)).toBe(true);
  });

  it('no evidence: a read-only session in a repo with unlogged commits stays silent at Stop; SessionStart carries the catch-up', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'my app'), 'Sample App');
    commit(dir, 'yesterday.txt', at(-24 * 60));
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-1), [bash('git status'), { name: 'Read', input: { file_path: join(dir, 'readme.txt') } }]));
    expect(await runHook('stop', s.input(), { now: NOW })).toBe('');
    const start = JSON.parse(await runHook('session-start', s.input({ hook_event_name: 'SessionStart', source: 'startup' }), { now: NOW })) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(start.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(start.hookSpecificOutput.additionalContext).toBe(
      `RADAR — Sample App. Now: Getting started. Next: Draw the first screen. 1 commit is not in the log: run radar-blip brief --path "${dir}" and sync before starting new work.`,
    );
  });

  it('within the 20-minute floor it stays silent; after it, only new work nudges again', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-5), ['a', 'b', 'c'].map((f) => write(join(dir, f)))));
    expect(await runHook('stop', s.input(), { now: NOW })).not.toBe('');

    appendFileSync(s.transcript, line(dir, at(5), ['d', 'e', 'f'].map((f) => write(join(dir, f)))));
    expect(await runHook('stop', s.input(), { now: at(10) })).toBe('');
    // Past the floor, the three edits made after the nudge are new work.
    expect(nudge(await runHook('stop', s.input(), { now: at(21) })).reason).toContain('3 edited files');
    // Past the floor again, with nothing new: silent.
    expect(await runHook('stop', s.input(), { now: at(45) })).toBe('');
  });

  it('another session nudged this project a minute ago: silent', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    await writeState(projectId(dir), { lastNudgeAt: at(-1).toISOString() });
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(0), ['a', 'b', 'c', 'd'].map((f) => write(join(dir, f)))));
    expect(await runHook('stop', s.input(), { now: NOW })).toBe('');
  });

  it('a sync newer than the evidence resets the count', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-10), ['a', 'b'].map((f) => write(join(dir, f)))));
    expect(await runHook('stop', s.input(), { now: at(-9) })).toBe('');
    await writeState(projectId(dir), { lastSyncAt: at(-5).toISOString() });
    appendFileSync(s.transcript, line(dir, at(-2), [write(join(dir, 'c'))]));
    expect(await runHook('stop', s.input(), { now: NOW })).toBe('');
    expect((await readMarker(s.id))!.projects[dir]!.files).toEqual([join(dir, 'c')]);
  });

  it('sync, then commit the same files, then Stop: no nudge, and the project is not unlogged', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    for (const f of ['a', 'b', 'c']) writeFileSync(join(dir, f), f);
    appendFileSync(s.transcript, line(dir, new Date(Date.now() - 60_000), ['a', 'b', 'c'].map((f) => write(join(dir, f)))));
    await syncProject(dir, parseSyncPayload({ now: 'The first screen is drawn.', log: ['Drew the first screen'] }), { author: 'Robin', agent: 'Claude' });
    await new Promise((r) => setTimeout(r, 1100)); // a commit second after the sync
    git(dir, 'add', 'a', 'b', 'c');
    git(dir, 'commit', '-q', '-m', 'draw the first screen');
    appendFileSync(s.transcript, line(dir, new Date(), [bash('git add a b c && git commit -m "draw the first screen"')]));
    const now = new Date();
    expect(await runHook('stop', s.input(), { now })).toBe('');
    const doc = (await readProject(dir)).file.doc();
    const state = await readState(projectId(dir));
    expect((await computeActivity(dir, { lastLogAt: doc.lastLogAt, lastSyncAt: state.lastSyncAt, dirtyAtSync: state.dirtyAtSync, now })).unlogged).toBe(false);
  });

  it('in a linked worktree too: sync, then commit the same files, then Stop: no nudge', async () => {
    const base = tmp('radar-ws-');
    const main = repo(join(base, 'main'), 'Sample App');
    const wt = join(base, 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/reset', wt);
    const s = session(wt);
    writeFileSync(join(wt, 'reset.ts'), 'reset\n');
    appendFileSync(s.transcript, line(wt, new Date(Date.now() - 60_000), [write(join(wt, 'reset.ts'))]));
    const payload = join(tmp('radar-payload-'), 'p.json');
    writeFileSync(payload, JSON.stringify({ now: 'Password reset is drafted on feat/reset.', log: ['Drafted the password reset'] }));
    expect(run(['sync', '--agent', 'Claude', '--path', wt, '--file', payload]).code).toBe(0);
    await new Promise((r) => setTimeout(r, 1100)); // a commit second after the sync
    git(wt, 'add', 'reset.ts');
    git(wt, 'commit', '-q', '-m', 'draft the password reset');
    appendFileSync(s.transcript, line(wt, new Date(), [bash('git add reset.ts && git commit -m "draft the password reset"')]));
    expect(await runHook('stop', s.input(), { now: new Date() })).toBe('');
  });

  it('a project without git whose only writes were shell commands nudges', async () => {
    const dir = folder(join(tmp('radar-ws-'), 'admin folder'), BLIP('Admin'));
    for (const f of ['one.csv', 'two.csv', 'three.csv']) writeFileSync(join(dir, f), f);
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-2), [bash('python make_reports.py')]));
    expect(nudge(await runHook('stop', s.input(), { now: NOW })).reason).toContain('RADAR: Admin has 3 changed files not in its log.');
  });

  it('a project without git: a session that only read there is not blocked over the owner\'s own edits', async () => {
    const dir = folder(join(tmp('radar-ws-'), 'beta site'), BLIP('Beta Site'));
    for (const f of ['one.html', 'two.html', 'three.css']) writeFileSync(join(dir, f), f);
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-2), [{ name: 'Read', input: { file_path: join(dir, 'one.html') } }]));
    expect(await runHook('stop', s.input(), { now: NOW })).toBe('');
    // A shell command run there afterwards is evidence again.
    appendFileSync(s.transcript, line(dir, at(-1), [bash('python build.py')]));
    expect(nudge(await runHook('stop', s.input(), { now: NOW })).reason).toContain('RADAR: Beta Site has 3 changed files not in its log.');
  });

  it('a transcript for the sibling folder app-two never counts for app', async () => {
    const ws = tmp('radar-ws-');
    const app = repo(join(ws, 'app'), 'App');
    mkdirSync(join(ws, 'app-two'));
    const s = session(ws);
    appendFileSync(s.transcript, line(ws, at(-2), ['a', 'b', 'c', 'd'].map((f) => write(join(ws, 'app-two', f)))));
    appendFileSync(s.transcript, line(join(ws, 'app-two'), at(-2), [bash('git commit -m x')]));
    expect(await runHook('stop', s.input(), { now: NOW })).toBe('');
    expect((await readMarker(s.id))!.projects[app]).toBeUndefined();
  });

  it('stop_hook_active is silent and reads nothing', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-5), ['a', 'b', 'c'].map((f) => write(join(dir, f)))));
    expect(await runHook('stop', s.input({ stop_hook_active: true }), { now: NOW })).toBe('');
    expect(await readMarker(s.id)).toBeNull();
  });

  it('reads only the bytes added since the last Stop', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-5), [write(join(dir, 'a'))]));
    const reads: number[] = [];
    await runHook('stop', s.input(), { now: NOW, onRead: (n) => reads.push(n) });
    const added = line(dir, at(-4), [write(join(dir, 'b'))]);
    appendFileSync(s.transcript, added);
    const torn = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":';
    appendFileSync(s.transcript, torn); // a line still being written
    await runHook('stop', s.input(), { now: NOW, onRead: (n) => reads.push(n) });
    expect(reads[0]).toBe(readFileSync(s.transcript).length - Buffer.byteLength(added) - torn.length);
    expect(reads[1]).toBe(Buffer.byteLength(added) + torn.length);
    expect((await readMarker(s.id))!.scannedBytes).toBe(readFileSync(s.transcript).length - torn.length);
    expect((await readMarker(s.id))!.projects[dir]!.files).toEqual([join(dir, 'a'), join(dir, 'b')]);
  });
});

describe('hook input: never blocks, never fails', () => {
  const hostile = ['', 'garbage', 'null', '[]', '42', '{"session_id": 7}', '{"session_id": "../../etc/passwd"}', '{"session_id": "x", "transcript_path": "\\u0000", "cwd": 5}', '{"session_id":"a","transcript_path":"C:/nope/none.jsonl","cwd":"Z:/nowhere"}', `{"session_id": "${'a'.repeat(5000)}"}`];

  it.each(['session-start', 'stop', 'session-end', 'bogus'])('runHook %s returns nothing for empty, malformed and hostile input', async (event) => {
    for (const input of hostile.slice(0, 8)) expect(await runHook(event, input, { now: NOW })).toBe('');
    expect(existsSync(data) ? readdirSync(data).filter((n) => n !== 'live') : []).toEqual([]);
  });

  it.each([
    ['stop', ''],
    ['stop', '{not json'],
    ['session-start', '\u0000\u0001'],
    ['session-end', '{"session_id": "../x"}'],
    ['bogus', '{}'],
  ])('the CLI: hook %s with %j exits 0 and prints nothing', (event, input) => {
    const r = run(['hook', event], { input });
    expect(r).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('the CLI: hook with no event, or extra flags, still exits 0', () => {
    expect(run(['hook'], { input: '{}' }).code).toBe(0);
    expect(run(['hook', 'stop', '--prority'], { input: '{}' }).code).toBe(0);
  });

  it('the CLI: 2 MB of stdin exits 0 quietly', () => {
    expect(run(['hook', 'stop'], { input: 'x'.repeat(2 * 1024 * 1024) })).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});

describe('hook session-start and session-end', () => {
  it('a repeated session-start keeps scannedBytes and the projects found so far', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-5), [write(join(dir, 'a'))]));
    await runHook('session-start', s.input(), { now: NOW });
    await runHook('stop', s.input(), { now: NOW });
    const before = (await readMarker(s.id))!;
    expect(before.scannedBytes).toBeGreaterThan(0);
    await runHook('session-start', s.input({ source: 'compact' }), { now: NOW });
    expect(await readMarker(s.id)).toEqual(before);
  });

  it('prints the project line; nothing outside a project', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const out = JSON.parse(await runHook('session-start', session(dir).input(), { now: NOW })) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toBe('RADAR — Sample App. Now: Getting started. Next: Draw the first screen.');
    expect(await runHook('session-start', session(tmp('radar-ws-')).input(), { now: NOW })).toBe('');
  });

  it('says so when the installed skill or hooks are out of date', async () => {
    const claude = join(tmp('radar-claude-'), '.claude');
    mkdirSync(join(claude, 'skills', 'blip'), { recursive: true });
    writeFileSync(join(claude, 'skills', 'blip', 'SKILL.md'), 'the v2 skill');
    process.env.CLAUDE_CONFIG_DIR = claude;
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const out = JSON.parse(await runHook('session-start', session(dir).input(), { now: NOW })) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toMatch(/ RADAR setup is out of date: tell the owner to run radar-blip setup\.$/);
  });

  it('session-end deletes the marker', async () => {
    const s = session(tmp('radar-ws-'));
    await runHook('session-start', s.input(), { now: NOW });
    expect(await readMarker(s.id)).not.toBeNull();
    await runHook('session-end', s.input(), { now: NOW });
    expect(await readMarker(s.id)).toBeNull();
  });
});

describe('live sessions', () => {
  it('marker and a fresh transcript: live; transcript 6 minutes old: not; a day-old marker is swept by session-start', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    await runHook('session-start', s.input(), { now: NOW });
    expect(presenceOf(dir, await readLiveMarkers(), NOW)).toMatchObject({ live: true, sessions: 1 });

    const six = at(-6);
    utimesSync(s.transcript, six, six);
    expect(presenceOf(dir, await readLiveMarkers(), NOW)).toMatchObject({ live: false, sessions: 0 });

    const day = at(-25 * 60);
    utimesSync(s.transcript, day, day);
    await runHook('session-start', session(tmp('radar-ws-')).input(), { now: NOW });
    expect(await readMarker(s.id)).toBeNull();
  });

  it('a workspace-root session is live for a project once a Stop has seen it edit there', async () => {
    const ws = tmp('radar-ws-');
    const dir = repo(join(ws, 'app'), 'Sample App');
    const s = session(ws);
    await runHook('session-start', s.input(), { now: NOW });
    expect(presenceOf(dir, await readLiveMarkers(), NOW).live).toBe(false);
    appendFileSync(s.transcript, line(ws, at(0), [write(join(dir, 'a'))]));
    await runHook('stop', s.input(), { now: NOW });
    expect(presenceOf(dir, await readLiveMarkers(), new Date()).live).toBe(true);
  });
});

describe('hook budget', () => {
  it('a Stop with one candidate project answers well inside its 10 s timeout, in process and as a process', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    for (let i = 0; i < 200; i++) appendFileSync(s.transcript, line(dir, at(-30 + i / 10), [write(join(dir, `f${i % 20}.ts`)), bash('npm test')]));
    let t = performance.now();
    const cpu = await cpuMs(async () => expect(await runHook('stop', s.input(), { now: NOW })).not.toBe(''));
    const inProcess = performance.now() - t;

    const s2 = session(dir);
    appendFileSync(s2.transcript, line(dir, at(-1), [write(join(dir, 'z.ts'))]));
    t = performance.now();
    const r = run(['hook', 'stop'], { input: s2.input() });
    const asProcess = performance.now() - t;
    expect(r.code).toBe(0);
    console.log(`hook stop: ${Math.round(inProcess)} ms in process (${Math.round(cpu)} ms CPU), ${Math.round(asProcess)} ms as a process`);
    // The hook's own work, which load does not stretch, and the contract: inside the 10 s
    // Claude Code gives it, however busy the machine. The idle-machine numbers: RADAR_TEST_FULL.
    expect(cpu).toBeLessThan(1500);
    expect(asProcess).toBeLessThan(HOOK_TIMEOUT_MS);
    if (FULL) {
      expect(inProcess).toBeLessThan(1500);
      expect(asProcess).toBeLessThan(3000);
    }
  });

  it('a first Stop over 1,500 edits of 300 files answers well under a second', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    let text = '';
    for (let i = 0; i < 1500; i++) text += line(dir, at(-30 + i / 100), [edit(join(dir, `d${i % 30}`, `f${i % 300}.ts`))]);
    appendFileSync(s.transcript, text);
    const t = performance.now();
    const cpu = await cpuMs(async () => expect(nudge(await runHook('stop', s.input(), { now: NOW })).reason).toContain('300 edited files'));
    const ms = performance.now() - t;
    // well under a second of the hook's own work on any machine; on an idle one, of wall time too
    expect(cpu).toBeLessThan(1000);
    expect(ms).toBeLessThan(HOOK_TIMEOUT_MS);
    if (FULL) expect(ms).toBeLessThan(1000);
  });

  it('a scan that runs out of time stops at a line boundary, saves how far it got, and the next Stop goes on from there', async () => {
    const dir = repo(join(tmp('radar-ws-'), 'app'), 'Sample App');
    const s = session(dir);
    const head = readFileSync(s.transcript).length;
    const first = line(dir, at(-5), [write(join(dir, 'a')), write(join(dir, 'b'))]);
    appendFileSync(s.transcript, first + line(dir, at(-4), [write(join(dir, 'c'))]));
    // No time at all: each Stop still reads one whole line with tool calls, so it always moves on.
    await runHook('stop', s.input(), { now: NOW, scanBudgetMs: 0 });
    let marker = (await readMarker(s.id))!;
    expect(marker.scannedBytes).toBe(head + Buffer.byteLength(first));
    expect(marker.projects[dir]!.files).toEqual([join(dir, 'a'), join(dir, 'b')]);
    await runHook('stop', s.input(), { now: NOW, scanBudgetMs: 0 });
    marker = (await readMarker(s.id))!;
    expect(marker.scannedBytes).toBe(readFileSync(s.transcript).length);
    expect(marker.projects[dir]!.files).toEqual([join(dir, 'a'), join(dir, 'b'), join(dir, 'c')]);
  });
});

describe('the CLI hook from a real process', () => {
  it('prints the Stop reply on stdout and exits 0', () => {
    const dir = repo(join(tmp('radar-ws-'), 'my app'), 'Sample App');
    const s = session(dir);
    appendFileSync(s.transcript, line(dir, at(-1), ['a', 'b', 'c'].map((f) => write(join(dir, f)))));
    const r = run(['hook', 'stop'], { input: s.input() });
    expect(r.code).toBe(0);
    expect(nudge(r.stdout.trim()).decision).toBe('block');
    expect(existsSync(CLI)).toBe(true);
  });
});
