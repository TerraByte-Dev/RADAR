import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Blip, applySync, parseSyncPayload } from '../dist/index.js';
import { readSessions, slugForPath, redact, formatSessions, isBlipWrite } from '../dist/sessions.js';
import { runStopHook } from '../dist/hook.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/**
 * Windows releases a file handle asynchronously, so a temp dir whose transcript we just read
 * can still be ENOTEMPTY the instant we delete it. Retry rather than flake.
 */
const cleanup = (p: string): void => rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

const DOC = `---
name: Sync
status: active
---

# Tasks
<!-- checklist -->
- [ ] alpha
- [ ] bravo
- [ ] charlie

# Notes
mine
`;

describe('applySync — reference stability', () => {
  it('resolves every ref against the pre-sync snapshot, whatever the ops do to each other', () => {
    const b = Blip.parse(DOC);
    // Position 1 and position 2 both refer to what `task list` showed *before* the sync,
    // even though checking 1 off and removing 2 would otherwise shift each other.
    applySync(b, { tasks: { done: [1], rm: [2], add: [{ text: 'delta', top: true }] } });
    expect(b.tasks).toEqual([
      { text: 'delta', done: false },
      { text: 'alpha', done: true },
      { text: 'charlie', done: false },
    ]);
  });

  it('matches by exact task text as well as position', () => {
    const b = Blip.parse(DOC);
    applySync(b, { tasks: { done: ['charlie'], edit: [{ ref: 'alpha', text: 'alpha prime' }] } });
    expect(b.tasks.map((t) => `${t.done ? 'x' : ' '}:${t.text}`)).toEqual([
      ' :alpha prime',
      ' :bravo',
      'x:charlie',
    ]);
  });

  it('keeps multiple `top` adds in the order they were listed', () => {
    const b = Blip.parse(DOC);
    applySync(b, { tasks: { add: [{ text: 'one', top: true }, { text: 'two', top: true }, 'tail'] } });
    expect(b.tasks.map((t) => t.text)).toEqual(['one', 'two', 'alpha', 'bravo', 'charlie', 'tail']);
  });

  it('attaches a due marker in the form the radar parses', () => {
    const b = Blip.parse(DOC);
    applySync(b, { tasks: { add: [{ text: 'ship', due: '2026-09-01' }] } });
    expect(b.tasks.at(-1)!.text).toBe('ship (due 2026-09-01)');
  });

  it('throws on an out-of-range ref instead of silently doing nothing', () => {
    expect(() => applySync(Blip.parse(DOC), { tasks: { done: [99] } })).toThrow(/no task matching 99/);
    expect(() => applySync(Blip.parse(DOC), { tasks: { done: ['nope'] } })).toThrow(/no task matching/);
  });

  it('throws when one payload targets the same task twice', () => {
    expect(() => applySync(Blip.parse(DOC), { tasks: { rm: [1, 'alpha'] } })).toThrow(/already removed/);
  });

  it('reports nothing changed for an empty payload', () => {
    expect(applySync(Blip.parse(DOC), {}).changed).toBe(false);
  });

  it('an empty session line list does not log a junk entry', () => {
    const b = Blip.parse(DOC);
    expect(applySync(b, { session: { lines: [] } }).changed).toBe(false);
    expect(b.toString()).toBe(DOC);
  });
});

describe('parseSyncPayload — the payload is LLM-authored, so treat it as untrusted', () => {
  it('rejects unknown keys at every level', () => {
    expect(() => parseSyncPayload({ taks: {} })).toThrow(/unknown key "taks"/);
    expect(() => parseSyncPayload({ tasks: { finished: [1] } })).toThrow(/unknown key "finished"/);
    expect(() => parseSyncPayload({ fields: { urgency: 1 } })).toThrow(/unknown key "urgency"/);
  });

  it('rejects bad enums, refs, and dates', () => {
    expect(() => parseSyncPayload({ fields: { status: 'onfire' } })).toThrow(/status/);
    expect(() => parseSyncPayload({ fields: { horizon: 'yesterday' } })).toThrow(/horizon/);
    expect(() => parseSyncPayload({ fields: { deadline: 'soon' } })).toThrow(/deadline/);
    expect(() => parseSyncPayload({ tasks: { done: [0] } })).toThrow(/1-based/);
    expect(() => parseSyncPayload({ tasks: { add: [{ text: 'x', due: 'friday' }] } })).toThrow(/ISO date/);
    expect(() => parseSyncPayload({ session: { lines: 'did stuff' } })).toThrow(/array of strings/);
  });

  it('accepts null to clear an optional field', () => {
    expect(parseSyncPayload({ fields: { deadline: null, operation: null } }).fields).toEqual({
      deadline: null,
      operation: null,
    });
  });
});

describe('CLI: sync', () => {
  const run = (args: string[], cwd: string, input?: string): string =>
    execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', input: input ?? '' });

  it('applies a piped payload atomically and reports what it did', () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-sync-'));
    try {
      writeFileSync(join(dir, 'BLIP.md'), DOC, 'utf8');
      const out = run(['sync'], dir, JSON.stringify({
        tasks: { done: ['alpha'], add: [{ text: 'ship it', top: true }] },
        session: { lines: ['wired sync'], author: 'Tester' },
        fields: { status: 'blocked' },
      }));
      expect(out).toContain('Synced');
      const after = readFileSync(join(dir, 'BLIP.md'), 'utf8');
      expect(after).toContain('- [ ] ship it\n- [x] alpha');
      expect(after).toContain('status: blocked');
      expect(after).toContain('- wired sync');
      expect(after).toContain('# Notes\nmine'); // human section untouched
    } finally {
      cleanup(dir);
    }
  });

  it('--dry-run prints the plan and writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-sync-dry-'));
    try {
      writeFileSync(join(dir, 'BLIP.md'), DOC, 'utf8');
      const out = run(['sync', '--dry-run'], dir, JSON.stringify({ tasks: { done: [1] } }));
      expect(out).toContain('Would apply');
      expect(readFileSync(join(dir, 'BLIP.md'), 'utf8')).toBe(DOC);
    } finally {
      cleanup(dir);
    }
  });

  it('a bad ref fails the whole sync — the file is never partially written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-sync-bad-'));
    try {
      writeFileSync(join(dir, 'BLIP.md'), DOC, 'utf8');
      let err: { status?: number; stderr?: string } | undefined;
      try {
        run(['sync'], dir, JSON.stringify({ tasks: { done: [1], rm: [99] } }));
      } catch (e) {
        err = e as { status?: number; stderr?: string };
      }
      expect(err?.status).toBe(1);
      expect(readFileSync(join(dir, 'BLIP.md'), 'utf8')).toBe(DOC);
    } finally {
      cleanup(dir);
    }
  });

  it('retires next_action on any write, without the caller asking', () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-migrate-'));
    try {
      const legacy = `---\nname: Old\nnext_action: flip the repo public\n---\n\n# Tasks\n- [ ] later\n`;
      writeFileSync(join(dir, 'BLIP.md'), legacy, 'utf8');
      run(['task', 'add', 'another'], dir);
      const after = readFileSync(join(dir, 'BLIP.md'), 'utf8');
      expect(after).not.toContain('next_action');
      expect(Blip.parse(after).tasks.map((t) => t.text)).toEqual(['flip the repo public', 'later', 'another']);
    } finally {
      cleanup(dir);
    }
  });
});

describe('sessions — reading what actually happened', () => {
  it('slugs a cwd the way Claude Code names its transcript folder', () => {
    // The input has to be absolute *for the host platform* — `slugForPath` resolves first, so a
    // Windows path fed to a Linux runner would be resolved against its cwd and slug differently.
    // Both expectations are verified against real ~/.claude/projects directory names.
    if (process.platform === 'win32') {
      expect(slugForPath('C:\\Users\\t\\Dev\\My App')).toBe('C--Users-t-Dev-My-App');
    } else {
      expect(slugForPath('/home/t/Dev/My App')).toBe('-home-t-Dev-My-App');
    }
  });

  it('recognizes a blip write in every form the skills teach', () => {
    for (const cmd of [
      'radar-blip sync',
      'npx -y radar-blip sync',
      'npx --yes radar-blip handoff --line "x"',
      'npm run blip -- sync',
      'radar-blip sync --dry-run',
      'cat payload.json | radar-blip sync --path "C:\\a b"',
    ]) {
      expect(isBlipWrite(cmd), cmd).toBe(true);
    }
    for (const cmd of ['radar-blip show --json', 'radar-blip sessions', 'npm test', 'git commit -m sync']) {
      expect(isBlipWrite(cmd), cmd).toBe(false);
    }
  });

  it('redacts token-shaped values', () => {
    expect(redact('curl -H "Authorization: Bearer sk-abcdefghijklmnopqrstuvwx"')).not.toContain('abcdefghij');
    expect(redact('export GH=ghp_0123456789abcdefghijABCDEFGHIJ')).toContain('«redacted»');
  });

  it('digests a transcript into prompts, files, commits, and consequential commands', async () => {
    const home = mkdtempSync(join(tmpdir(), 'radar-home-'));
    const proj = mkdtempSync(join(tmpdir(), 'radar-proj-'));
    try {
      const dir = join(home, '.claude', 'projects', slugForPath(proj));
      mkdirSync(dir, { recursive: true });
      const entry = (o: object): string => JSON.stringify(o) + '\n';
      writeFileSync(
        join(dir, 'abc123.jsonl'),
        entry({ type: 'user', timestamp: '2026-06-01T10:00:00.000Z', cwd: proj, gitBranch: 'feat/x', message: { content: 'add the parser' } }) +
          entry({ type: 'user', timestamp: '2026-06-01T10:00:01.000Z', isMeta: true, message: { content: 'ignore me' } }) +
          entry({
            type: 'assistant',
            timestamp: '2026-06-01T10:01:00.000Z',
            message: {
              content: [
                { type: 'text', text: 'ok' },
                { type: 'tool_use', name: 'Edit', input: { file_path: join(proj, 'src', 'a.ts') } },
                { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
                { type: 'tool_use', name: 'Bash', input: { command: 'cd /x && npm test' } },
                { type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "feat: parser"' } },
              ],
            },
          }) +
          '{ not json\n' + // a torn line must not kill the digest
          entry({ type: 'assistant', timestamp: '2026-05-01T09:00:00.000Z', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'old.ts' } }] } }),
        'utf8',
      );

      const [d] = await readSessions(proj, { home, since: '2026-06-01T00:00:00.000Z' });
      expect(d!.sessionId).toBe('abc123');
      expect(d!.gitBranch).toBe('feat/x');
      expect(d!.prompts).toEqual(['add the parser']); // isMeta wrapper dropped
      expect(d!.filesTouched).toEqual(['src/a.ts']); // relative to the project
      expect(d!.commits).toEqual(['feat: parser']);
      expect(d!.commands).toContain('npm test'); // `cd …&&` preamble stripped
      expect(d!.commands.some((c) => c.includes('ls -la'))).toBe(false); // exploration filtered out
      expect(d!.skippedBefore).toBe(1); // the May entry predates --since
      expect(formatSessions([d!])).toContain('wrote: src/a.ts');
    } finally {
      cleanup(home);
      cleanup(proj);
    }
  });

  it('falls back to a parent-folder session, scoped to the work that landed in this project', async () => {
    // The common real-world shape: one agent opened at a workspace root, working across repos.
    const home = mkdtempSync(join(tmpdir(), 'radar-anc-home-'));
    const workspace = mkdtempSync(join(tmpdir(), 'radar-anc-ws-'));
    const proj = join(workspace, 'MyProject');
    mkdirSync(proj);
    try {
      const dir = join(home, '.claude', 'projects', slugForPath(workspace));
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ws.jsonl'),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-06-01T10:00:00.000Z',
          cwd: workspace,
          message: {
            content: [
              { type: 'tool_use', name: 'Write', input: { file_path: join(proj, 'src/mine.ts') } },
              { type: 'tool_use', name: 'Write', input: { file_path: join(workspace, 'OtherProject/theirs.ts') } },
            ],
          },
        }) + '\n',
        'utf8',
      );

      const [d] = await readSessions(proj, { home });
      expect(d!.scope).toBe('ancestor');
      expect(d!.filesTouched).toEqual(['src/mine.ts']); // the sibling project's file is dropped
      expect(d!.filesOutside).toBe(1); // counted, never named
      // Labelled honestly: named when the session really ran elsewhere…
      expect(formatSessions([d!], proj)).toContain(`filed under a parent folder, ${workspace}`)
      // …and not named when `cwd` happens to sit inside the project (an agent that cd'd in).
      expect(formatSessions([{ ...d!, cwd: proj }], proj)).toContain('filed under a parent folder —');

      // A parent session that never touched this project is not this project's session.
      const bystander = join(workspace, 'Untouched');
      mkdirSync(bystander);
      expect(await readSessions(bystander, { home })).toEqual([]);
    } finally {
      cleanup(home);
      cleanup(workspace);
    }
  });

  it('prefers the project’s own sessions over any parent’s', async () => {
    const home = mkdtempSync(join(tmpdir(), 'radar-pref-home-'));
    const workspace = mkdtempSync(join(tmpdir(), 'radar-pref-ws-'));
    const proj = join(workspace, 'Proj');
    mkdirSync(proj);
    try {
      const entry = (cwd: string, file: string, ts: string): string =>
        JSON.stringify({
          type: 'assistant',
          timestamp: ts,
          cwd,
          message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: join(proj, file) } }] },
        }) + '\n';
      for (const [d, body] of [
        [slugForPath(proj), entry(proj, 'own.ts', '2026-06-01T10:00:00.000Z')],
        [slugForPath(workspace), entry(workspace, 'via-parent.ts', '2026-06-02T10:00:00.000Z')],
      ] as const) {
        mkdirSync(join(home, '.claude', 'projects', d), { recursive: true });
        writeFileSync(join(home, '.claude', 'projects', d, 's.jsonl'), body, 'utf8');
      }
      const found = await readSessions(proj, { home });
      expect(found).toHaveLength(1);
      expect(found[0]!.scope).toBe('project');
      expect(found[0]!.filesTouched).toEqual(['own.ts']);
    } finally {
      cleanup(home);
      cleanup(workspace);
    }
  });

  it('returns nothing (rather than throwing) when there is no history', async () => {
    const home = mkdtempSync(join(tmpdir(), 'radar-nohome-'));
    try {
      expect(await readSessions(process.cwd(), { home })).toEqual([]);
    } finally {
      cleanup(home);
    }
  });
});

describe('Stop hook — nudge only when it earns it', () => {
  const run = async (input: object, home?: string): Promise<string | null> =>
    runStopHook(JSON.stringify(input), home);

  // The once-per-session marker lives in the OS temp dir and outlives the test run, so every
  // case needs its own session id or the second run of the suite would see a stale marker.
  let n = 0;
  const sid = (label: string): string => `test-${label}-${process.pid}-${n++}`;

  /** A project with a stale BLIP.md and a transcript showing real work since. */
  function scenario(commands: string[], files: string[]): { home: string; proj: string } {
    const home = mkdtempSync(join(tmpdir(), 'radar-hookhome-'));
    const proj = mkdtempSync(join(tmpdir(), 'radar-hookproj-'));
    writeFileSync(
      join(proj, 'BLIP.md'),
      `---\nname: Hooked\nlast_session: 2026-01-01T00:00:00.000Z\n---\n\n# Tasks\n- [ ] a\n`,
      'utf8',
    );
    const dir = join(home, '.claude', 'projects', slugForPath(proj));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 's1.jsonl'),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-01T10:00:00.000Z',
        message: {
          content: [
            ...files.map((f) => ({ type: 'tool_use', name: 'Write', input: { file_path: join(proj, f) } })),
            ...commands.map((c) => ({ type: 'tool_use', name: 'Bash', input: { command: c } })),
          ],
        },
      }) + '\n',
      'utf8',
    );
    return { home, proj };
  }

  it('asks for a sync when a tracked repo ends with unlogged work', async () => {
    const { home, proj } = scenario(['npm test'], ['src/a.ts']);
    try {
      const id = sid('nudge');
      const out = await run({ session_id: id, cwd: proj, stop_hook_active: false }, home);
      const parsed = JSON.parse(out!) as { decision: string; reason: string };
      expect(parsed.decision).toBe('block');
      expect(parsed.reason).toContain('/blip sync');
      expect(parsed.reason).toContain('1 file(s) changed');
      // …but only once per session, so it can never loop.
      expect(await run({ session_id: id, cwd: proj, stop_hook_active: false }, home)).toBeNull();
    } finally {
      cleanup(home);
      cleanup(proj);
    }
  });

  it('stays silent when the session already synced', async () => {
    const { home, proj } = scenario(['radar-blip sync'], ['src/a.ts']);
    try {
      expect(await run({ session_id: sid('synced'), cwd: proj, stop_hook_active: false }, home)).toBeNull();
    } finally {
      cleanup(home);
      cleanup(proj);
    }
  });

  it('stays silent for a read-only session, an untracked repo, a re-entry, and garbage input', async () => {
    const shallow = scenario([], []);
    try {
      expect(await run({ session_id: sid('quiet'), cwd: shallow.proj, stop_hook_active: false }, shallow.home)).toBeNull();
      expect(await run({ session_id: sid('reentry'), cwd: shallow.proj, stop_hook_active: true }, shallow.home)).toBeNull();
    } finally {
      cleanup(shallow.home);
      cleanup(shallow.proj);
    }
    const bare = mkdtempSync(join(tmpdir(), 'radar-untracked-'));
    try {
      expect(await run({ session_id: sid('untracked'), cwd: bare, stop_hook_active: false })).toBeNull();
    } finally {
      cleanup(bare);
    }
    // Unparseable input: stay out of the way rather than guess. (A payload with no `cwd` is a
    // different case — it legitimately falls back to the process's cwd, which the hook runs in.)
    expect(await runStopHook('not json at all')).toBeNull();
  });

  it('stays silent on a signal-lost blip rather than nagging about a file it cannot read', async () => {
    const { home, proj } = scenario(['npm test'], ['src/a.ts']);
    try {
      writeFileSync(join(proj, 'BLIP.md'), `---\nname: "unterminated\n---\n\n# Tasks\n`, 'utf8');
      expect(await run({ session_id: sid('broken'), cwd: proj, stop_hook_active: false }, home)).toBeNull();
    } finally {
      cleanup(home);
      cleanup(proj);
    }
  });
});
