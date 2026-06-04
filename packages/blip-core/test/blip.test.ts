import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
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

## 2026-05-20 — Tate
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
    expect(out).toContain('## 2026-05-20 — Tate'); // session log untouched
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

describe('session log', () => {
  it('appends without rewriting prior entries and stamps last_session', () => {
    const out = Blip.parse(FULL)
      .appendSession({ date: '2026-05-25', author: 'Tate', lines: ['did X', 'did Y'] })
      .toString();
    expect(out).toContain('## 2026-05-20 — Tate'); // old entry kept
    expect(out).toContain('## 2026-05-25 — Tate'); // new entry added
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
