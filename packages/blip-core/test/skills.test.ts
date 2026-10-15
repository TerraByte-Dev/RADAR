import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBlip } from '../src/core/doc.js';
import { applyEdit } from '../src/core/edit.js';
import { CAPS, FIELD_OWNERSHIP } from '../src/core/schema.js';
import { parseSyncPayload, syncToOps } from '../src/core/sync.js';
import { SKILL_STAMP } from '../src/setup.js';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../../skills/${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const FILES = { claude: read('claude/blip/SKILL.md'), codex: read('codex/blip.md') };

/** The sentence that hands fields to the owner: from "belong to the owner" / "owner decides" to the next full stop after it. */
const ownerSentence = (text: string): string => /(?:[^.]*belong to the owner|The owner decides)[^.]*\./i.exec(text.replace(/\s+/g, ' '))![0];

/** The words each file uses for a field. */
const WORDS: Record<string, RegExp> = {
  now: /\bnow\b/,
  tasks: /\b(done|add)\b/,
  log: /\blog\b/,
  status: /\bstatus\b/,
  name: /\bname\b/,
  due: /\bdue dates?\b/i,
  tags: /\btags\b/,
  focus: /\bfocus\b/,
  active: /\bactive\b/,
  blocked: /\bblocked\b/,
  paused: /\bpausing\b/,
  archived: /\barchiving\b/,
  links: /\blinks\b/,
};

describe('the skill files', () => {
  it('SKILL.md is at most 60 lines and its description at most 220 characters', () => {
    expect(FILES.claude.trimEnd().split('\n').length).toBeLessThanOrEqual(60);
    const description = /^description: (.*)$/m.exec(FILES.claude)![1]!;
    expect(Array.from(description).length).toBeLessThanOrEqual(220);
  });

  it.each(Object.entries(FILES))('%s carries the current stamp and no owner name', (_name, text) => {
    expect(text).toContain(SKILL_STAMP);
    expect(SKILL_STAMP).toBe(`<!-- radar-blip-skill v${CAPS.SKILL_FORMAT} -->`);
    expect(text).not.toMatch(/\bTate\b/);
  });

  it.each(Object.entries(FILES))('%s says what exit 2 means, and what to do when a folder was named', (_name, text) => {
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toMatch(/Exit (?:code )?2 means no BLIP\.md there: (?:do nothing|stop), but if a folder was named, check the path and tell the (?:owner|user)\./);
    expect(flat).toContain('Run `radar-blip init` only when asked.');
    expect(flat).not.toContain('not tracked');
  });

  it.each(Object.entries(FILES))('%s agrees with the field table (spec 4.5)', (name, text) => {
    const owner = ownerSentence(text);
    for (const row of FIELD_OWNERSHIP) {
      const word = WORDS[row.value ?? row.field]!;
      if (row.sync === false && row.setWhenAsked) expect(owner, `${row.value ?? row.field} is the owner's`).toMatch(word);
      else expect(owner, `${row.value ?? row.field} is not the owner's alone`).not.toMatch(word);
      // The Codex prompt does not restate the payload keys (E_PAYLOAD_KEY lists them); the skill does.
      if (name === 'claude' && row.sync !== false) expect(text, `${row.field} is in the payload`).toMatch(word);
      if (!row.sync && !row.setWhenAsked) expect(text).not.toMatch(word);
    }
    expect(text).toContain('radar-blip set');
  });
});

describe('the field table and the engine agree', () => {
  const file = (): ReturnType<typeof parseBlip> => parseBlip('---\nblip: 3\nname: Lantern Notes\n---\n\n# Tasks\n\n- [ ] Draw the first screen\n\n# Session log\n', { dirName: 'lantern-notes' });
  const VALUES: Record<string, unknown> = { now: 'The first screen is drawn.', due: '2026-12-01', tags: ['mobile'], focus: true, links: [{ label: null, url: 'https://example.com' }], name: 'Lantern' };

  it.each(FIELD_OWNERSHIP.filter((r) => !['tasks', 'log'].includes(r.field)).map((r) => [r.value ?? r.field, r] as const))('%s: an agent may set it only if the table says so; the owner always may', (_label, row) => {
    const value = row.field === 'status' ? row.value : VALUES[row.field];
    const op = { op: 'set' as const, field: row.field as 'now', value };
    const agent = (): unknown => applyEdit(file(), [op], { actor: 'agent', now: new Date(), author: 'Robin' });
    // A named project: an agent's `name` is refused, as the table says ("only while missing or a slug").
    if (row.sync === true) expect(agent).not.toThrow();
    else expect(agent).toThrow(expect.objectContaining({ code: 'E_HUMAN_OWNED' }));
    expect(() => applyEdit(file(), [op], { actor: 'human', now: new Date(), author: 'Robin' })).not.toThrow();
  });

  it('`due` in the table is the project\'s: the files say so, and a task\'s own due still goes through sync', () => {
    for (const text of Object.values(FILES)) expect(ownerSentence(text)).toMatch(/\bthe project's due date\b/i);
    const doc = file();
    const ops = syncToOps(doc.doc(), parseSyncPayload({ add: [{ title: 'Ship the beta to testers', due: '2026-11-01' }] }), 'r');
    const res = applyEdit(doc, ops, { actor: 'agent', now: new Date(), author: 'Robin' });
    expect(res.changed).toBe(true);
    expect(() => parseSyncPayload({ due: '2026-11-01' })).toThrow(expect.objectContaining({ code: 'E_PAYLOAD_KEY' }));
  });

  it('a payload cannot carry a field the agent does not write through sync', () => {
    for (const row of FIELD_OWNERSHIP.filter((r) => r.sync === false && r.field !== 'status')) {
      expect(() => parseSyncPayload({ [row.field]: VALUES[row.field] }), row.field).toThrow(expect.objectContaining({ code: 'E_PAYLOAD_KEY' }));
    }
  });
});
