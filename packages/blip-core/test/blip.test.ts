import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Blip, createBlip, detectAuthor } from '../dist/index.js';

const FULL = `---
name: RADAR
horizon: today
priority: 1
category: Product
status: active
next_action: Wire scan into the radar
created: 2026-05-25
repo: TerraByte-Dev/RADAR
---

# Tasks
<!-- checklist -->
- [x] Decide architecture
- [ ] Scaffold app

# Session log

## 2026-05-20 — Sam
- Initial sketch

# Notes
Whiteboard lives in the bedroom.
`;

describe('round-trip fidelity (no edits)', () => {
  it('reproduces a full document byte-for-byte', () => {
    expect(Blip.parse(FULL).toString()).toBe(FULL);
  });

  it('preserves a document with no frontmatter', () => {
    const s = `# Tasks\n- [ ] a\n\n# Notes\nhi\n`;
    expect(Blip.parse(s).toString()).toBe(s);
  });

  it('preserves an arbitrary user section verbatim', () => {
    const s = `---\nhorizon: week\n---\n\n# Ideas\n- a wild idea\n\n# Notes\nkeep me\n`;
    expect(Blip.parse(s).toString()).toBe(s);
  });

  it('preserves CRLF line endings', () => {
    const crlf = FULL.replace(/\n/g, '\r\n');
    expect(Blip.parse(crlf).toString()).toBe(crlf);
  });

  it('preserves a document without a trailing newline', () => {
    const s = `---\nhorizon: today\n---\n\n# Notes\nno trailing newline`;
    expect(Blip.parse(s).toString()).toBe(s);
  });
});

describe('non-destructive edits', () => {
  it('changes only the managed field, keeping unknown keys + body', () => {
    const out = Blip.parse(FULL).setHorizon('week').toString();
    expect(out).toContain('horizon: week');
    expect(out).not.toContain('horizon: today');
    expect(out).toContain('repo: TerraByte-Dev/RADAR'); // unknown key survives
    expect(out).toContain('# Notes\nWhiteboard lives in the bedroom.'); // notes untouched
    expect(out).toContain('## 2026-05-20 — Sam'); // session log untouched
  });

  it('surfaces unknown frontmatter keys read-only', () => {
    const model = Blip.parse(FULL).toReadModel();
    expect(model.unknown.repo).toBe('TerraByte-Dev/RADAR');
    expect(model.name).toBe('RADAR');
    expect(model.priority).toBe(1);
  });

  it('is idempotent after an edit', () => {
    const once = Blip.parse(FULL).setHorizon('week').toString();
    const twice = Blip.parse(once).setHorizon('week').toString();
    expect(twice).toBe(once);
  });

  it('creates frontmatter when none existed', () => {
    const s = `# Tasks\n- [ ] a\n\n# Notes\nhi\n`;
    const out = Blip.parse(s).setHorizon('today').toString();
    expect(out.startsWith('---\nhorizon: today\n---\n')).toBe(true);
    expect(out).toContain('# Notes\nhi');
  });
});

describe('tasks', () => {
  it('adds, toggles, and removes tasks', () => {
    const b = Blip.parse(FULL);
    b.addTask('Write tests');
    expect(b.tasks.map((t) => t.text)).toContain('Write tests');

    b.toggleTask('Scaffold app');
    expect(b.tasks.find((t) => t.text === 'Scaffold app')?.done).toBe(true);

    b.removeTask('Decide architecture');
    expect(b.tasks.find((t) => t.text === 'Decide architecture')).toBeUndefined();

    const out = b.toString();
    expect(out).toContain('- [ ] Write tests');
    expect(out).toContain('- [x] Scaffold app');
    expect(out).toContain('<!-- checklist -->'); // section comment preserved
  });

  it('reports a completion ratio via the read model', () => {
    const model = Blip.parse(FULL).toReadModel();
    const done = model.tasks.filter((t) => t.done).length;
    expect(done).toBe(1);
    expect(model.tasks.length).toBe(2);
  });
});

describe('fenced code blocks cannot hijack sections', () => {
  // A fenced example of a BLIP.md inside # Notes — BEFORE the real sections.
  const NOTES_WITH_FENCE = `# Notes
What the engine writes, for reference:

\`\`\`markdown
# Tasks
- [ ] fake task in an example
\`\`\`

prose after the fence must survive

`;
  const FENCED_BEFORE = `---
name: Fenced
---

${NOTES_WITH_FENCE}# Tasks
<!-- checklist -->
- [ ] real task

# Session log

## 2026-06-01 — Sam
- did a thing
`;

  it('round-trips byte-for-byte with no edits', () => {
    expect(Blip.parse(FENCED_BEFORE).toString()).toBe(FENCED_BEFORE);
  });

  it('parses the real # Tasks, not the fenced example before it', () => {
    expect(Blip.parse(FENCED_BEFORE).tasks.map((t) => t.text)).toEqual(['real task']);
  });

  it('a task mutation preserves # Notes (fenced example included) byte-for-byte', () => {
    const out = Blip.parse(FENCED_BEFORE).toggleTask('real task').toString();
    expect(out).toBe(FENCED_BEFORE.replace('- [ ] real task', '- [x] real task'));
    expect(out).toContain(NOTES_WITH_FENCE); // notes untouched, fence intact
  });

  it('ignores a fenced fake # Tasks after the real sections too (~~~ fences)', () => {
    const doc = `---
name: After
---

# Tasks
- [ ] real

# Notes
Example session:

~~~
# Tasks
- [ ] fake
~~~

trailing prose stays
`;
    const b = Blip.parse(doc);
    expect(b.tasks.map((t) => t.text)).toEqual(['real']);
    const out = b.toggleTask('real').toString();
    expect(out).toBe(doc.replace('- [ ] real', '- [x] real'));
  });
});

describe('tasks section line preservation', () => {
  const TASKS_RICH = `---
name: Rich
---

# Tasks
<!-- checklist -->
- [ ] first
  - [ ] indented sub-task — body text, not a task
- [x] second
a prose note inside the tasks section

- [ ] third

# Notes
keep me
`;

  it('does not count indented sub-bullets as tasks (indices match what a human sees)', () => {
    const b = Blip.parse(TASKS_RICH);
    expect(b.tasks.map((t) => t.text)).toEqual(['first', 'second', 'third']);
    expect(b.tasks[1]!.text).toBe('second'); // ref by index agrees with the visible checklist
  });

  it('toggle rewrites only the matching checklist line', () => {
    const out = Blip.parse(TASKS_RICH).toggleTask('third').toString();
    expect(out).toBe(TASKS_RICH.replace('- [ ] third', '- [x] third'));
  });

  it('add appends after the last checklist line, leaving everything else verbatim', () => {
    const out = Blip.parse(TASKS_RICH).addTask('fourth').toString();
    expect(out).toBe(TASKS_RICH.replace('- [ ] third\n', '- [ ] third\n- [ ] fourth\n'));
  });

  it('rm drops only that checklist line', () => {
    const out = Blip.parse(TASKS_RICH).removeTask('second').toString();
    expect(out).toBe(TASKS_RICH.replace('- [x] second\n', ''));
    expect(Blip.parse(out).tasks.map((t) => t.text)).toEqual(['first', 'third']);
  });

  it('a combined toggle/add/rm preserves all non-task lines and keeps refs stable', () => {
    const b = Blip.parse(TASKS_RICH);
    b.toggleTask('first').removeTask('second').addTask('fourth');
    const out = b.toString();
    expect(out).toContain('  - [ ] indented sub-task — body text, not a task');
    expect(out).toContain('a prose note inside the tasks section');
    expect(out).toContain('<!-- checklist -->');
    expect(out).toContain('# Notes\nkeep me');
    expect(Blip.parse(out).tasks).toEqual([
      { done: true, text: 'first' },
      { done: false, text: 'third' },
      { done: false, text: 'fourth' },
    ]);
  });

  it('inserts after the heading + lead comment when the section has no checklist yet', () => {
    const doc = `# Tasks\n<!-- checklist -->\nsome prose\n\n# Notes\nhi\n`;
    const out = Blip.parse(doc).addTask('a').toString();
    expect(out).toBe(`# Tasks\n<!-- checklist -->\n- [ ] a\nsome prose\n\n# Notes\nhi\n`);
  });

  it('preserves CRLF when rewriting the tasks section', () => {
    const crlf = TASKS_RICH.replace(/\n/g, '\r\n');
    const out = Blip.parse(crlf).toggleTask('third').toString();
    expect(out).toBe(crlf.replace('- [ ] third', '- [x] third'));
    expect(out).not.toMatch(/[^\r]\n/); // no stray LF-only line endings
  });
});

describe('frontmatter YAML error classification', () => {
  // Tab indentation + an unclosed flow bracket: toJS() recovers fields but the
  // document reports errors and would be mangled on re-serialization.
  const BAD_TAB = `---\nname: Tabbed\n\ttags: [a\n---\n\n# Tasks\n- [ ] keep\n\n# Notes\nhand-written\n`;
  const BAD_BRACKET = `---\nname: Bracket\ntags: [a, b\n---\n\n# Notes\nkeep\n`;

  it('parses without throwing and surfaces fmErrors', () => {
    for (const doc of [BAD_TAB, BAD_BRACKET]) {
      const b = Blip.parse(doc);
      expect(b.fmErrors.length).toBeGreaterThan(0);
    }
    expect(Blip.parse(FULL).fmErrors).toEqual([]); // clean files stay error-free
  });

  it('round-trips the broken frontmatter verbatim when unedited', () => {
    expect(Blip.parse(BAD_TAB).toString()).toBe(BAD_TAB);
    expect(Blip.parse(BAD_BRACKET).toString()).toBe(BAD_BRACKET);
  });

  it('refuses every mutation fast, with an actionable message', () => {
    const b = Blip.parse(BAD_TAB);
    const msg = /frontmatter has YAML errors — fix BLIP\.md by hand or re-init/;
    expect(() => b.setHorizon('today')).toThrow(msg);
    expect(() => b.addTask('x')).toThrow(msg);
    expect(() => b.toggleTask('keep')).toThrow(msg);
    expect(() => b.removeTask('keep')).toThrow(msg);
    expect(() => b.appendSession({ lines: ['x'] })).toThrow(msg);
    expect(b.toString()).toBe(BAD_TAB); // nothing was half-applied
  });
});

describe('input hygiene', () => {
  it('flattens newlines in task text so a task can never forge a heading', () => {
    const b = Blip.parse(FULL);
    b.addTask('evil\n# Tasks\n- [ ] forged');
    const out = b.toString();
    expect(out.split(/\r?\n/).filter((l) => l === '# Tasks')).toHaveLength(1);
    expect(Blip.parse(out).tasks.map((t) => t.text)).toContain('evil # Tasks - [ ] forged');
  });

  it('flattens newlines on editTask too', () => {
    const out = Blip.parse(FULL).editTask('Scaffold app', 'a\r\nb').toString();
    expect(Blip.parse(out).tasks.map((t) => t.text)).toContain('a b');
  });

  it('flattens newlines in session-log lines and author so a handoff can never forge a heading', () => {
    const out = Blip.parse(FULL)
      .appendSession({
        date: '2026-06-01',
        author: 'Eve\n# Tasks',
        lines: ['did X\n# Tasks\n- [ ] forged']
      })
      .toString();
    expect(out.split(/\r?\n/).filter((l) => l === '# Tasks')).toHaveLength(1);
    const reread = Blip.parse(out);
    expect(reread.tasks.map((t) => t.text)).not.toContain('forged');
    expect(out).toContain('- did X # Tasks - [ ] forged');
  });

  it('falls back to the detected user when the author is blank', () => {
    const out = Blip.parse(FULL)
      .appendSession({ date: '2026-06-01', author: '   ', lines: ['x'] })
      .toString();
    expect(out).toContain(`## 2026-06-01 — ${detectAuthor()}`);
    expect(out).not.toMatch(/— *$/m); // no dangling dash
  });

  it('rejects a session date that is not YYYY-MM-DD', () => {
    const b = Blip.parse(FULL);
    expect(() => b.appendSession({ date: 'June 5', lines: ['x'] })).toThrow(/YYYY-MM-DD/);
    expect(() => b.appendSession({ date: '2026-13-45', lines: ['x'] })).toThrow(/YYYY-MM-DD/);
    expect(() => b.appendSession({ date: ' 2026-06-01 ', lines: ['x'] })).not.toThrow(); // trimmed ok
  });

  it('coerces scalar name/category/next_action and wraps scalar tags', () => {
    const b = Blip.parse(`---\nname: 123\ncategory: 7\nnext_action: false\ntags: solo\n---\n`);
    expect(b.fields.name).toBe('123');
    expect(b.fields.category).toBe('7');
    expect(b.fields.next_action).toBe('false');
    expect(b.fields.tags).toEqual(['solo']);
  });

  it('filters non-string entries out of tags', () => {
    expect(Blip.parse(`---\ntags: [a, 2, b]\n---\n`).fields.tags).toEqual(['a', 'b']);
  });

  it('drops a garbage deadline on read, exactly as the schema promises', () => {
    expect(Blip.parse(`---\ndeadline: garbage\n---\n`).fields.deadline).toBeUndefined();
    expect(Blip.parse(`---\ndeadline: 2026-07-01\n---\n`).fields.deadline).toBe('2026-07-01');
  });
});

describe('session log', () => {
  it('appends without rewriting prior entries and stamps last_session', () => {
    const out = Blip.parse(FULL)
      .appendSession({ date: '2026-05-25', author: 'Sam', lines: ['did X', 'did Y'] })
      .toString();
    expect(out).toContain('## 2026-05-20 — Sam'); // old entry kept
    expect(out).toContain('## 2026-05-25 — Sam'); // new entry added
    expect(out).toContain('- did X');
    expect(out.indexOf('## 2026-05-20')).toBeLessThan(out.indexOf('## 2026-05-25')); // chronological
    expect(out).toMatch(/last_session: /);
  });
});

describe('robustness', () => {
  it('does not throw on malformed frontmatter and preserves it verbatim', () => {
    const s = `---\nhorizon: today\n:::weird:::\n---\n# Notes\nkeep me\n`;
    expect(() => Blip.parse(s)).not.toThrow();
    expect(Blip.parse(s).toString()).toBe(s);
  });

  it('coerces invalid field values on read', () => {
    const b = Blip.parse(`---\nhorizon: bogus\npriority: 99\nstatus: nope\n---\n`);
    expect(b.fields.horizon).toBe('someday');
    expect(b.fields.priority).toBe(5);
    expect(b.fields.status).toBe('active');
  });
});

describe('createBlip', () => {
  it('produces a parseable scaffold with the requested fields', () => {
    const b = createBlip({ name: 'Foo', horizon: 'today', priority: 2, category: 'Client' });
    const m = b.toReadModel();
    expect(m).toMatchObject({ name: 'Foo', horizon: 'today', priority: 2, category: 'Client', status: 'active' });

    const round = Blip.parse(b.toString()).toReadModel();
    expect(round).toMatchObject({ name: 'Foo', horizon: 'today', priority: 2, category: 'Client' });
    expect(b.toString()).toContain('# Notes');
    expect(b.toString()).toMatch(/created: \d{4}-\d{2}-\d{2}/);
  });

  it('writes deadline + operation when provided', () => {
    const m = createBlip({ name: 'Bar', deadline: '2026-07-01', operation: 'TerraByte' }).toReadModel();
    expect(m.deadline).toBe('2026-07-01');
    expect(m.operation).toBe('TerraByte');
  });
});

describe('new radar fields (deadline / radar_angle / operation)', () => {
  const WITH_FIELDS = `---
name: RADAR
horizon: week
priority: 2
category: Product
status: active
deadline: 2026-07-01
radar_angle: 123.5
operation: TerraByte
repo: TerraByte-Dev/RADAR
---

# Notes
keep me
`;

  it('surfaces the new fields on the read model and excludes them from unknown', () => {
    const m = Blip.parse(WITH_FIELDS).toReadModel();
    expect(m.deadline).toBe('2026-07-01');
    expect(m.radar_angle).toBe(123.5);
    expect(m.operation).toBe('TerraByte');
    // Managed keys never leak into `unknown`; a real unknown key still does.
    expect(m.unknown).not.toHaveProperty('deadline');
    expect(m.unknown).not.toHaveProperty('radar_angle');
    expect(m.unknown).not.toHaveProperty('operation');
    expect(m.unknown.repo).toBe('TerraByte-Dev/RADAR');
  });

  it('round-trips a document carrying the new fields byte-for-byte', () => {
    expect(Blip.parse(WITH_FIELDS).toString()).toBe(WITH_FIELDS);
  });

  it('normalizes radar_angle into [0, 360) on read', () => {
    expect(Blip.parse(`---\nradar_angle: 400\n---\n`).fields.radar_angle).toBe(40);
    expect(Blip.parse(`---\nradar_angle: -10\n---\n`).fields.radar_angle).toBe(350);
    // A non-numeric angle is dropped rather than surfaced as NaN.
    expect(Blip.parse(`---\nradar_angle: nope\n---\n`).fields.radar_angle).toBeUndefined();
  });

  it('sets and clears the deadline and the radar angle via the engine', () => {
    const b = Blip.parse(WITH_FIELDS);
    b.setDeadline('2026-08-15').setRadarAngle(720); // 720 → 0
    expect(b.fields.deadline).toBe('2026-08-15');
    expect(b.fields.radar_angle).toBe(0);

    b.setDeadline(null).setRadarAngle(null);
    expect(b.fields.deadline).toBeUndefined();
    expect(b.fields.radar_angle).toBeUndefined();
    const out = b.toString();
    expect(out).not.toContain('deadline:');
    expect(out).not.toContain('radar_angle:');
    expect(out).toContain('# Notes\nkeep me'); // unmanaged section still intact
  });

  it('merges radar_angle (the app write path) without touching other keys', () => {
    const out = Blip.parse(WITH_FIELDS).merge({ radar_angle: 270 }).toString();
    expect(out).toContain('radar_angle: 270');
    expect(out).toContain('operation: TerraByte');
    expect(out).toContain('repo: TerraByte-Dev/RADAR');
  });
});

describe('author detection', () => {
  it('defaults the session-log author to the detected OS user', () => {
    const out = Blip.parse(FULL)
      .appendSession({ date: '2026-05-26', lines: ['did a thing'] })
      .toString();
    expect(out).toContain(`## 2026-05-26 — ${detectAuthor()}`);
  });

  it('lets an explicit author win over the detected default', () => {
    const out = Blip.parse(FULL)
      .appendSession({ date: '2026-05-26', author: 'Ada', lines: ['x'] })
      .toString();
    expect(out).toContain('## 2026-05-26 — Ada');
  });
});

describe('skills install (CLI)', () => {
  const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

  it('copies the bundled skills into a fresh HOME, byte-for-byte', () => {
    const home = mkdtempSync(join(tmpdir(), 'radar-skills-'));
    try {
      execFileSync(process.execPath, [CLI, 'skills', 'install'], {
        env: { ...process.env, HOME: home, USERPROFILE: home },
      });
      const claudeDest = join(home, '.claude', 'skills', 'blip', 'SKILL.md');
      const codexDest = join(home, '.codex', 'prompts', 'blip.md');
      expect(existsSync(claudeDest)).toBe(true);
      expect(existsSync(codexDest)).toBe(true);

      const srcClaude = readFileSync(
        fileURLToPath(new URL('../skills/claude/blip/SKILL.md', import.meta.url)),
        'utf8',
      );
      expect(readFileSync(claudeDest, 'utf8')).toBe(srcClaude);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('CLI: init + show round-trip with the new radar fields', () => {
  const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = (args: string[], dir: string): string =>
    execFileSync(process.execPath, [CLI, ...args, '--path', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  it('inits with deadline + operation and reads them back via show --json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-cli-'));
    try {
      run(['init', '--name', 'Demo', '--deadline', '2026-07-01', '--operation', 'TerraByte', '--priority', '1', '--category', 'Product'], dir);
      const json = JSON.parse(run(['show', '--json'], dir));
      expect(json).toMatchObject({
        name: 'Demo',
        deadline: '2026-07-01',
        operation: 'TerraByte',
        priority: 1,
        category: 'Product',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid deadline (non-zero exit)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-cli-'));
    try {
      expect(() => run(['init', '--deadline', 'someday'], dir)).toThrow();
      expect(existsSync(join(dir, 'BLIP.md'))).toBe(false); // nothing written on failure
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an empty --name on set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-cli-'));
    try {
      run(['init', '--name', 'Demo'], dir);
      let err: { stderr?: string } | undefined;
      try {
        run(['set', '--name', '   '], dir);
      } catch (e) {
        err = e as { stderr?: string };
      }
      expect(err).toBeTruthy();
      expect(String(err!.stderr)).toContain('--name must not be empty');
      expect(readFileSync(join(dir, 'BLIP.md'), 'utf8')).toContain('name: Demo'); // unchanged
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI: refuses to write through broken frontmatter', () => {
  const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = (args: string[], dir: string): string =>
    execFileSync(process.execPath, [CLI, ...args, '--path', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const BAD = `---\nname: Tabbed\n\ttags: [a\n---\n\n# Tasks\n- [ ] keep\n\n# Notes\nhand-written\n`;

  it('set / task add / handoff exit 1 with an actionable message and never touch the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-cli-bad-'));
    try {
      const file = join(dir, 'BLIP.md');
      writeFileSync(file, BAD, 'utf8');
      for (const args of [
        ['set', '--horizon', 'today'],
        ['task', 'add', 'new task'],
        ['handoff', '--line', 'did X'],
      ]) {
        let err: { status?: number; stderr?: string } | undefined;
        try {
          run(args, dir);
        } catch (e) {
          err = e as { status?: number; stderr?: string };
        }
        expect(err, args.join(' ')).toBeTruthy();
        expect(err!.status).toBe(1);
        expect(String(err!.stderr)).toContain('frontmatter has YAML errors — fix BLIP.md by hand or re-init');
        expect(String(err!.stderr)).not.toMatch(/^\s+at /m); // a message, not a stack trace
        expect(readFileSync(file, 'utf8')).toBe(BAD); // file untouched
      }
      // Reads still work: show surfaces what it can instead of crashing.
      expect(() => run(['show', '--json'], dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
