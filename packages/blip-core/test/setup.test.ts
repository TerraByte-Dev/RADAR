import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySetup, describePlan, editSettings, ensure, hookProblems, planSetup, radarHook, setupStale, shimPath, shimText, SKILL_STAMP, unifiedDiff, type ShimTarget, type Targets } from '../src/setup.js';
import { BlipError } from '../src/core/schema.js';
import { CLI, cleanPath, git, isolate, run, tmp } from './helpers.js';
import { cpuMsSync } from './timing.js';

beforeEach(() => {
  isolate();
});

const SKILLS = fileURLToPath(new URL('../skills/', import.meta.url));
const CLAUDE_SKILL = readFileSync(join(SKILLS, 'claude', 'blip', 'SKILL.md'), 'utf8');

/** Throwaway targets under a temp folder whose name has a space in it. */
function targets(opts: { codex?: boolean } = {}): Targets {
  const root = join(tmp('radar-setup-'), 'a home');
  const t = { claudeDir: join(root, '.claude'), codexDir: join(root, '.codex'), dataDir: join(root, 'App Data', 'radar-blip'), skillsDir: SKILLS };
  mkdirSync(t.claudeDir, { recursive: true });
  if (opts.codex) mkdirSync(t.codexDir, { recursive: true });
  return t;
}
const settingsOf = (t: Targets): string => readFileSync(join(t.claudeDir, 'settings.json'), 'utf8');
const putSettings = (t: Targets, text: string): void => writeFileSync(join(t.claudeDir, 'settings.json'), text);

async function setup(t: Targets, opts: { remove?: boolean; shim?: ShimTarget } = {}): Promise<boolean> {
  const plan = await planSetup(t, opts);
  if (plan.changed) await applySetup(plan);
  return plan.changed;
}

/** Settings in the shape Claude Code writes: other tools' hooks, unknown keys, escapes and numbers JSON.parse would respell. */
const FOREIGN = `{
  "includeCoAuthoredBy": false,
  "permissions": {
    "allow": [
      "Bash(npm test:*)"
    ]
  },
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:/tools/before-compact.js",
            "timeout": 30
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "notify-send \\"done \\u00e9\\"",
            "timeout": 5.0
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "my-status-line"
  },
  "theme": "dark"
}
`;

/** The v2 install: one Stop entry, as the v2 README told people to add it. */
const V2 = `{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "other-tool session-end",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "radar-blip hook stop",
            "timeout": 15
          }
        ]
      }
    ]
  },
  "theme": "dark"
}
`;

describe('which hook commands are RADAR\'s', () => {
  it.each([
    ['radar-blip hook stop', 'stop'],
    ['  radar-blip hook session-start ', 'session-start'],
    ['"C:/Users/robin/AppData/Roaming/radar-blip/bin/radar-blip.cmd" hook session-end', 'session-end'],
    ['C:\\tools\\radar-blip.cmd hook stop', 'stop'],
    ['/home/robin/.local/bin/radar-blip hook stop', 'stop'],
    // Spellings of the v2 entry people wrote by hand (spec 5.4: every command that matches is taken out).
    ['radar-blip hook stop || true', 'stop'],
    ['npx radar-blip hook stop', 'stop'],
    ['radar-blip hook stop 2>/dev/null', 'stop'],
    ['radar-blip.CMD hook stop', 'stop'],
    ['RADAR-BLIP hook stop', 'stop'],
    ['node radar-blip hook stop', 'stop'],
    ['radar-blip hook stopper', 'stopper'],
  ])('%j is', (command, event) => expect(radarHook(command)).toBe(event));

  it.each(['my-radar-blip hook stop', 'radar-blip sync', 'radar-blip-v2 hook stop', 'radar-blip hooks stop'])('%j is not', (command) => {
    expect(radarHook(command)).toBeNull();
  });

  it.each(['radar-blip hook stop || true', 'npx radar-blip hook stop', 'radar-blip hook stop 2>/dev/null', 'radar-blip.CMD hook stop', 'RADAR-BLIP hook stop'])(
    'a Stop entry %j is replaced by setup, and doctor counts it until then',
    async (command) => {
      const t = targetsWith(`${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command, timeout: 15 }] }] } }, null, 2)}\n`);
      await setup(t);
      const after = JSON.parse(settingsOf(t)) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
      expect(after.hooks.Stop!.flatMap((g) => g.hooks.map((h) => h.command))).toEqual(['radar-blip hook stop']);
      expect(hookProblems(after)).toEqual([]);
      // Next to a right entry, it is a second Stop hook; alone, it is not the form setup writes.
      const right = { type: 'command', command: 'radar-blip hook stop', timeout: 10 };
      const old = { type: 'command', command, timeout: 10 };
      const others = { SessionStart: after.hooks.SessionStart, SessionEnd: after.hooks.SessionEnd };
      expect(hookProblems({ hooks: { ...others, Stop: [{ hooks: [old] }, { hooks: [right] }] } })).not.toEqual([]);
      expect(hookProblems({ hooks: { ...others, Stop: [{ hooks: [old] }] } })).not.toEqual([]);
    },
  );
});

describe('setup: settings.json', () => {
  it('empty settings: three entries; a second run changes nothing; --remove gives back the original bytes', async () => {
    const t = targets();
    putSettings(t, '{}\n');
    expect(await setup(t)).toBe(true);
    const after = JSON.parse(settingsOf(t)) as unknown;
    expect(hookProblems(after)).toEqual([]);
    expect(after).toEqual({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'radar-blip hook session-start', timeout: 10 }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'radar-blip hook stop', timeout: 10 }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: 'radar-blip hook session-end', timeout: 10 }] }],
      },
    });
    expect(settingsOf(t)).toBe(`${JSON.stringify(after, null, 2)}\n`);
    const again = await planSetup(t);
    expect(again.changed).toBe(false);
    expect(describePlan(again)).toEqual([]);
    expect(await setup(t, { remove: true })).toBe(true);
    expect(settingsOf(t)).toBe('{}\n');
  });

  it('no settings.json at all: setup creates one', async () => {
    const t = targets();
    expect(await setup(t)).toBe(true);
    expect(hookProblems(JSON.parse(settingsOf(t)))).toEqual([]);
    expect(existsSync(join(t.claudeDir, 'settings.json.radar-bak'))).toBe(false);
  });

  it('other tools\' hooks and unknown keys are untouched, byte for byte; --remove restores the original exactly', async () => {
    const t = targets();
    putSettings(t, FOREIGN);
    await setup(t);
    const after = settingsOf(t);
    // Everything that was there is still there, spelled as it was.
    expect(after).toContain('"command": "notify-send \\"done \\u00e9\\"",\n            "timeout": 5.0');
    expect(after.startsWith(FOREIGN.slice(0, FOREIGN.indexOf('    "Stop": [')))).toBe(true);
    expect(after).toContain('  "statusLine": {\n    "type": "command",\n    "command": "my-status-line"\n  },\n  "theme": "dark"\n}\n');
    // The foreign Stop group is kept, first, and RADAR's sits after it.
    const stop = (JSON.parse(after) as { hooks: { Stop: unknown[] } }).hooks.Stop;
    expect(stop).toHaveLength(2);
    expect(hookProblems(JSON.parse(after))).toEqual([]);
    expect(readFileSync(join(t.claudeDir, 'settings.json.radar-bak'), 'utf8')).toBe(FOREIGN);

    expect((await planSetup(t)).changed).toBe(false);
    await setup(t, { remove: true });
    expect(settingsOf(t)).toBe(FOREIGN);
  });

  it('the v2 entry is replaced, not duplicated, and the rest of the file is kept', async () => {
    const t = targets();
    putSettings(t, V2);
    await setup(t);
    const after = JSON.parse(settingsOf(t)) as { hooks: Record<string, { hooks: { command: string; timeout: number }[] }[]>; theme: string };
    expect(hookProblems(after)).toEqual([]);
    expect(after.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'radar-blip hook stop', timeout: 10 }] }]);
    expect(after.hooks.SessionEnd!.map((g) => g.hooks[0]!.command)).toEqual(['other-tool session-end', 'radar-blip hook session-end']);
    expect(Object.keys(after.hooks)).toEqual(['SessionEnd', 'Stop', 'SessionStart']);
    expect(after.theme).toBe('dark');
    // The diff shows the timeout change and the two new entries, nothing else.
    const diff = describePlan(await planSetup(targetsWith(V2)));
    expect(diff.filter((l) => /^[-+](?![-+])/.test(l))).toContain('-            "timeout": 15');
    expect(diff.filter((l) => l.startsWith('-') && !l.startsWith('---'))).toEqual(['-            "timeout": 15']);

    await setup(t, { remove: true });
    const removed = JSON.parse(settingsOf(t)) as { hooks: Record<string, unknown> };
    expect(removed.hooks).toEqual({ SessionEnd: [{ hooks: [{ type: 'command', command: 'other-tool session-end', timeout: 10 }] }] });
  });

  it('a RADAR entry under the wrong event, a duplicate, and one sharing a group with another tool are all put right', async () => {
    const t = targets();
    const messy = {
      hooks: {
        PostToolUse: [{ hooks: [{ type: 'command', command: 'radar-blip hook stop', timeout: 10 }] }],
        Stop: [
          { hooks: [{ type: 'command', command: 'radar-blip hook stop', timeout: 10 }, { type: 'command', command: 'other stop', timeout: 3 }] },
          { hooks: [{ type: 'command', command: '"C:/old/radar-blip.cmd" hook stop', timeout: 10 }] },
        ],
      },
    };
    putSettings(t, `${JSON.stringify(messy, null, 2)}\n`);
    await setup(t);
    const after = JSON.parse(settingsOf(t)) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(hookProblems(after)).toEqual([]);
    expect(after.hooks.PostToolUse).toBeUndefined();
    expect(after.hooks.Stop!.flatMap((g) => g.hooks.map((h) => h.command))).toEqual(['radar-blip hook stop', 'other stop']);
  });

  it('invalid JSON: E_SETTINGS_INVALID and nothing is written', async () => {
    const t = targets();
    putSettings(t, '{ "hooks": ');
    await expect(planSetup(t)).rejects.toMatchObject({ code: 'E_SETTINGS_INVALID' });
    expect(() => editSettings('[1]', 'radar-blip', false)).toThrow(BlipError);
    expect(() => editSettings('{"hooks": []}', 'radar-blip', false)).toThrow(/hooks/);
    expect(settingsOf(t)).toBe('{ "hooks": ');
    expect(readdirSync(t.claudeDir)).toEqual(['settings.json']);
  });

  it('a settings.json that is a symlink stays one: the file it points to is the one written', async (ctx) => {
    const t = targets();
    const dotfiles = join(tmp('radar-dotfiles-'), 'settings.json');
    writeFileSync(dotfiles, FOREIGN);
    try {
      symlinkSync(dotfiles, join(t.claudeDir, 'settings.json'), 'file');
    } catch {
      ctx.skip(); // symlinks need a privilege here
    }
    await setup(t);
    expect(lstatSync(join(t.claudeDir, 'settings.json')).isSymbolicLink()).toBe(true);
    expect(hookProblems(JSON.parse(readFileSync(dotfiles, 'utf8')))).toEqual([]);
    expect(readFileSync(join(t.claudeDir, 'settings.json.radar-bak'), 'utf8')).toBe(FOREIGN);
  });

  it('a 30,000-line settings.json is diffed in well under a second, showing only the RADAR lines', async () => {
    const allow = Array.from({ length: 30_000 }, (_, i) => `Bash(tool-${i}:*)`);
    const t = targetsWith(`${JSON.stringify({ permissions: { allow }, theme: 'dark' }, null, 2)}\n`);
    const plan = await planSetup(t);
    let lines: string[] = [];
    expect(cpuMsSync(() => (lines = describePlan(plan)))).toBeLessThan(1000);
    expect(lines.filter((l) => l.startsWith('-') && !l.startsWith('---'))).toEqual(['-  "theme": "dark"']);
    expect(lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length).toBeGreaterThan(20);
  });

  it('a changed line reads as its removal, then what replaces it', () => {
    const out = unifiedDiff('{\n  "a": 1\n}\n', '{\n  "a": 1,\n  "b": 2\n}\n', 'x');
    expect(out.filter((l) => /^[-+](?![-+])/.test(l))).toEqual(['-  "a": 1', '+  "a": 1,', '+  "b": 2']);
  });

  it('two unrelated long texts still diff, as one hunk', () => {
    const a = Array.from({ length: 5000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 5000 }, (_, i) => `b${i}`).join('\n');
    const out = unifiedDiff(a, b, 'x');
    expect(out.filter((l) => l.startsWith('@@'))).toEqual(['@@ -1,5000 +1,5000 @@']);
    expect(out).toHaveLength(2 + 1 + 10_000);
  });

  it('a read-only settings.json: E_SETTINGS_READONLY with a hint, and no backup or change', async () => {
    const t = targetsWith(FOREIGN);
    const path = join(t.claudeDir, 'settings.json');
    chmodSync(path, 0o444);
    try {
      const plan = await planSetup(t);
      await expect(applySetup(plan)).rejects.toMatchObject({ code: 'E_SETTINGS_READONLY', hint: expect.stringContaining('read-only') });
      expect(readFileSync(path, 'utf8')).toBe(FOREIGN);
      expect(existsSync(`${path}.radar-bak`)).toBe(false);
    } finally {
      chmodSync(path, 0o644);
    }
  });

  it('CRLF settings stay CRLF', () => {
    const out = editSettings('{\r\n  "theme": "dark"\r\n}\r\n', 'radar-blip', false);
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(editSettings(out, 'radar-blip', true)).toBe('{\r\n  "theme": "dark"\r\n}\r\n');
  });
});

function targetsWith(settings: string): Targets {
  const t = targets();
  putSettings(t, settings);
  return t;
}

describe('setup: skills', () => {
  it('installs the Claude skill, and the Codex prompt only where Codex is installed', async () => {
    const without = targets();
    await setup(without);
    expect(readFileSync(join(without.claudeDir, 'skills', 'blip', 'SKILL.md'), 'utf8')).toBe(CLAUDE_SKILL);
    expect(existsSync(without.codexDir)).toBe(false);

    const withCodex = targets({ codex: true });
    await setup(withCodex);
    expect(readFileSync(join(withCodex.codexDir, 'prompts', 'blip.md'), 'utf8')).toContain(SKILL_STAMP);
  });

  it('a modified skill is backed up, then replaced; an identical one is left alone', async () => {
    const t = targets();
    const path = join(t.claudeDir, 'skills', 'blip', 'SKILL.md');
    mkdirSync(join(t.claudeDir, 'skills', 'blip'), { recursive: true });
    writeFileSync(path, 'the v2 skill, edited by hand');
    const plan = await planSetup(t);
    expect(plan.skills).toEqual([{ target: path, action: 'replace', backup: expect.stringMatching(/SKILL\.md\.bak-\d{8}-\d{6}$/) }]);
    await applySetup(plan);
    expect(readFileSync(plan.skills[0]!.backup!, 'utf8')).toBe('the v2 skill, edited by hand');
    expect(readFileSync(path, 'utf8')).toBe(CLAUDE_SKILL);
    expect((await planSetup(t)).skills).toEqual([]);
  });

  it('--remove deletes only skill files RADAR installed', async () => {
    const t = targets({ codex: true });
    await setup(t);
    writeFileSync(join(t.codexDir, 'prompts', 'blip.md'), 'someone else\'s prompt');
    await setup(t, { remove: true });
    expect(existsSync(join(t.claudeDir, 'skills', 'blip'))).toBe(false);
    expect(readFileSync(join(t.codexDir, 'prompts', 'blip.md'), 'utf8')).toBe('someone else\'s prompt');
  });
});

describe('setup: the shim', () => {
  const shim = (): ShimTarget => ({ cli: CLI, runtime: process.execPath });

  it('with a shim the hook commands are its quoted absolute path with forward slashes, and that command runs from cmd.exe and from Git Bash', async () => {
    const t = targets();
    await setup(t, { shim: shim() });
    const settings = JSON.parse(settingsOf(t)) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    const command = settings.hooks.SessionStart![0]!.hooks[0]!.command;
    expect(command).toBe(`"${shimPath(t).replace(/\\/g, '/')}" hook session-start`);
    expect(command).toContain(' ');
    expect(radarHook(command)).toBe('session-start');

    // The hook reply proves the CLI ran: a session starting in a project.
    const proj = join(tmp('radar-shim-'), 'my app');
    mkdirSync(proj);
    writeFileSync(join(proj, 'BLIP.md'), '---\nblip: 3\nname: Shim Test\n---\n\n# Tasks\n\n# Session log\n');
    const input = JSON.stringify({ session_id: 'shim-test', transcript_path: join(proj, 't.jsonl'), cwd: proj });
    const env = { ...process.env, PATH: cleanPath() };
    const expectReply = (out: string): void => expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain('RADAR — Shim Test.');
    if (process.platform === 'win32') {
      expectReply(execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], { input, env, encoding: 'utf8', windowsVerbatimArguments: true }));
      const bash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find((p) => existsSync(p));
      if (bash) expectReply(execFileSync(bash, ['-c', command], { input, env, encoding: 'utf8' }));
      else console.warn('Git Bash not found: the bash half of this test did not run');
    } else {
      expectReply(execFileSync('/bin/sh', ['-c', command], { input, env, encoding: 'utf8' }));
    }
  });

  it('the shim quotes its paths for the shell that reads it', () => {
    expect(shimText({ cli: 'C:\\a%b\\cli.mjs', runtime: 'C:\\n\\node.exe' }, 'win32')).toBe('@echo off\r\nsetlocal\r\n"C:\\n\\node.exe" "C:\\a%%b\\cli.mjs" %*\r\n');
    expect(shimText({ cli: 'C:\\cli.mjs', runtime: 'C:\\RADAR\\RADAR.exe', electron: true }, 'win32')).toBe('@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\RADAR\\RADAR.exe" "C:\\cli.mjs" %*\r\n');
    expect(shimText({ cli: "/a'b/$x/cli.mjs", runtime: '/opt/RADAR/radar', electron: true }, 'linux')).toBe(`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/opt/RADAR/radar' '/a'\\''b/$x/cli.mjs' "$@"\n`);
  });

  it('ensure() with nothing installed writes nothing', async () => {
    const t = targets();
    expect(await ensure(t, shim())).toBe(false);
    expect(readdirSync(t.claudeDir)).toEqual([]);
    expect(existsSync(t.dataDir)).toBe(false);
  });

  it('ensure() never puts back hooks or a skill the owner took out by hand', async () => {
    const t = targets();
    await setup(t);
    putSettings(t, '{\n  "theme": "dark"\n}\n');
    expect(await ensure(t, shim())).toBe(false);
    expect(settingsOf(t)).toBe('{\n  "theme": "dark"\n}\n');

    const u = targets();
    await setup(u);
    const skill = join(u.claudeDir, 'skills', 'blip', 'SKILL.md');
    writeFileSync(skill, 'my own /blip skill');
    const settings = JSON.parse(settingsOf(u)) as { hooks: Record<string, unknown> };
    settings.hooks.Stop = [{ hooks: [{ type: 'command', command: 'radar-blip hook stop', timeout: 15 }] }];
    putSettings(u, JSON.stringify(settings, null, 2));
    // The hooks are still RADAR's, so they are brought up to date; the skill is the owner's now.
    expect(await ensure(u, shim())).toBe(true);
    expect(hookProblems(JSON.parse(settingsOf(u)))).toEqual([]);
    expect(readFileSync(skill, 'utf8')).toBe('my own /blip skill');
  });

  it('ensure() on a v2-only machine writes nothing', async () => {
    const t = targetsWith(V2);
    expect(await ensure(t, shim())).toBe(false);
    expect(settingsOf(t)).toBe(V2);
  });

  it('ensure() with RADAR installed and a shim pointing at an old CLI: the shim and the skill are brought up to date without asking', async () => {
    const t = targets();
    await setup(t, { shim: { cli: 'C:/old/resources/cli/radar-blip.mjs', runtime: process.execPath } });
    const skill = join(t.claudeDir, 'skills', 'blip', 'SKILL.md');
    writeFileSync(skill, `${SKILL_STAMP}\nan older text`);
    const settings = settingsOf(t);
    expect(await ensure(t, shim())).toBe(true);
    expect(readFileSync(shimPath(t), 'utf8')).toContain(CLI);
    expect(readFileSync(skill, 'utf8')).toBe(CLAUDE_SKILL);
    expect(settingsOf(t)).toBe(settings);
    expect(await ensure(t, shim())).toBe(false);
  });
});

describe('setup-stale', () => {
  it('false without a Claude config; true for the v2 install; false once set up', async () => {
    const t = targets();
    expect(setupStale({ ...t, claudeDir: join(t.claudeDir, 'nope') })).toBe(false);
    putSettings(t, V2);
    expect(setupStale(t)).toBe(true);
    await setup(t);
    expect(setupStale(t)).toBe(false);
  });
});

describe('the setup command', () => {
  /** A fake home: the CLI finds ~/.claude, ~/.codex and its data folder from it, as on a real machine. */
  function home(): { env: NodeJS.ProcessEnv; root: string } {
    const root = join(tmp('radar-home-'), 'Robin Home');
    mkdirSync(join(root, '.claude'), { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: cleanPath(), HOME: root, USERPROFILE: root, APPDATA: join(root, 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'AppData', 'Local'), XDG_DATA_HOME: join(root, '.local', 'share') };
    for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'RADAR_BLIP_HOME']) delete env[k];
    return { env, root };
  }

  it('without a terminal and without --yes: prints the diff, writes nothing, exits 1; --dry-run exits 0; --yes applies; then "Already set up."', () => {
    const { env, root } = home();
    const settings = join(root, '.claude', 'settings.json');
    writeFileSync(settings, V2);
    const r = run(['setup'], { env });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('-            "timeout": 15');
    expect(r.stdout).toContain(`install  ${join(root, '.claude', 'skills', 'blip', 'SKILL.md')}`);
    expect(readFileSync(settings, 'utf8')).toBe(V2);
    expect(run(['setup', '--dry-run'], { env }).code).toBe(0);
    expect(readFileSync(settings, 'utf8')).toBe(V2);

    const yes = run(['setup', '--yes'], { env });
    expect(yes.code).toBe(0);
    expect(yes.stdout).toMatch(/^ok {4}hooks/m);
    expect(hookProblems(JSON.parse(readFileSync(settings, 'utf8')))).toEqual([]);
    expect(run(['setup'], { env }).stdout).toContain('Already set up.');

    const rm = run(['setup', '--remove', '--yes'], { env });
    expect(rm.code).toBe(0);
    expect(existsSync(join(root, '.claude', 'skills', 'blip', 'SKILL.md'))).toBe(false);
  });

  it('end to end in a temp HOME: setup --yes, then session-start, edits, stop → one nudge; sync, then stop → none', () => {
    const realSettings = join(homedir(), '.claude', 'settings.json');
    const realMtime = existsSync(realSettings) ? statSync(realSettings).mtimeMs : null;
    const { env, root } = home();
    const proj = join(root, 'work', 'my app');
    mkdirSync(proj, { recursive: true });
    git(proj, 'init', '-q');
    writeFileSync(join(proj, 'BLIP.md'), '---\nblip: 3\nname: Sample App\nnow: Getting started.\n---\n\n# Tasks\n\n- [ ] Draw the first screen\n\n# Session log\n');
    expect(run(['setup', '--yes'], { env, cwd: proj }).code).toBe(0);
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(root, process.platform === 'win32' ? 'AppData/Roaming' : process.platform === 'darwin' ? 'Library/Application Support' : '.local/share', 'radar-blip', 'registry.json'))).toBe(true);

    const transcript = join(root, 'session.jsonl');
    writeFileSync(transcript, '');
    const input = (event: string): string => JSON.stringify({ session_id: 'e2e-session', transcript_path: transcript, cwd: proj, hook_event_name: event, stop_hook_active: false });
    expect(JSON.parse(run(['hook', 'session-start'], { env, input: input('SessionStart') }).stdout).hookSpecificOutput.additionalContext).toContain('RADAR — Sample App.');
    const tools = ['a.ts', 'b.ts', 'c.ts'].map((f, i) => ({ type: 'tool_use', id: `t${i}`, name: 'Write', input: { file_path: join(proj, f), content: f } }));
    writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), cwd: proj, message: { content: tools } })}\n`);
    const stop = run(['hook', 'stop'], { env, input: input('Stop') });
    expect(stop.code).toBe(0);
    expect(JSON.parse(stop.stdout).decision).toBe('block');

    const payload = join(root, 'payload.json');
    writeFileSync(payload, JSON.stringify({ now: 'The first screen is drawn.', log: ['Drew the first screen in a.ts, b.ts and c.ts'] }));
    expect(run(['sync', '--agent', 'Claude', '--path', proj, '--file', payload], { env }).code).toBe(0);
    expect(run(['hook', 'stop'], { env, input: input('Stop') })).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(run(['hook', 'session-end'], { env, input: input('SessionEnd') }).code).toBe(0);

    // The real profile was never touched.
    if (realMtime !== null) expect(statSync(realSettings).mtimeMs).toBe(realMtime);
  });
});
