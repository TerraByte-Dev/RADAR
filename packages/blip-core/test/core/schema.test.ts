import { describe, it, expect } from 'vitest';
import { fold } from '../../src/core/schema.js';
import { hasSecret, redact, secretLines } from '../../src/core/secrets.js';
import { parseTitleText } from '../../src/core/tasks.js';
import { NOW, parseText } from './fixtures.js';
import { cpuMsSync } from '../timing.js';

/** Every character some editor or tool treats as the end of a line. */
const BREAKS = ['\n', '\r\n', '\r', '\u0085', '\u2028', '\u2029', '\v', '\f'];

describe('fold', () => {
  it.each(BREAKS.map((b) => [[...b].map((c) => `U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(' '), b]))('folds %s to one space', (_name, br) => {
    expect(fold(`one${br}two`)).toBe('one two');
    expect(fold(`one \t${br}${br} \ttwo${br}`)).toBe('one two');
  });

  it('keeps spacing inside a line and trims the ends', () => {
    expect(fold('  a  b\tc  ')).toBe('a  b\tc');
    expect(fold(' \n \n ')).toBe('');
  });

  it('drops other control characters', () => {
    expect(fold('a\u0000b\u001bc\u007fd')).toBe('abcd');
  });
});

describe('payload text cannot forge a line, whatever an editor counts as a line break', () => {
  const BASE = '---\nblip: 3\nname: Sample\n---\n\n# Tasks\n\n- [ ] Alpha task\n\n# Session log\n\n## 2026-10-01 10:00 — Robin\n- First thing\n';

  it.each(BREAKS.map((b) => [[...b].map((c) => `U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(' '), b]))('%s in a title, a detail line, an author or a bullet', (_name, br) => {
    const file = parseText(BASE);
    const ed = file.edit({ now: NOW });
    ed.addTask({ title: `Real${br}- [x] Forged done`, detail: [`note${br}- [ ] Forged open`] });
    ed.addLogEntry({ author: `Robin${br}## 2030-01-01 00:00 — Forged`, bullets: [`a${br}## 2031-01-01 — Forged`] });
    const out = file.toString();
    expect(out).not.toMatch(/[\r\u0085\u2028\u2029\v\f]/);
    expect(out.split('\n').filter((l) => /^(?:## 20[3-9]|- \[[ x]\] Forged)/.test(l))).toEqual([]);
    const doc = parseText(out).doc();
    expect(doc.tasks.open.map((t) => t.title)).toEqual(['Alpha task', 'Real - [x] Forged done']);
    expect(doc.tasks.done).toEqual([]);
    expect(doc.log.map((e) => e.date)).toEqual(['2026-10-13', '2026-10-01']);
  });
});

describe('one very long run of spaces does not stall a read', () => {
  const spaces = ' '.repeat(80_000);
  // CPU time, which a busy machine does not stretch: a quadratic scan of 80,000 spaces is
  // seconds of it, a linear one milliseconds
  const timed = cpuMsSync;

  it('fold', () => {
    expect(timed(() => expect(fold(`a${spaces}b`)).toBe(`a${spaces}b`))).toBeLessThan(500);
  });

  it('a task title', () => {
    const text = `---\nblip: 3\nname: Sample\nnow: fine\n---\n\n# Tasks\n\n- [ ] a${spaces}b\n`;
    expect(timed(() => expect(parseText(text).doc().tasks.open).toHaveLength(1))).toBeLessThan(500);
  });

  it('a section heading', () => {
    const text = `---\nblip: 3\nname: Sample\nnow: fine\n---\n\n# a${spaces}b\n\n# Tasks\n\n- [ ] one\n`;
    expect(timed(() => expect(parseText(text).doc().tasks.open).toHaveLength(1))).toBeLessThan(500);
  });
});

describe('a long line of token-shaped pieces does not stall the secret check', () => {
  it('reads a 200 KB line of "-eyJ" in well under a second, and still sees a real token', () => {
    const line = '-eyJ'.repeat(50_000);
    const cpu = cpuMsSync(() => {
      expect(hasSecret(line)).toBe(false);
      expect(secretLines(`# Notes\n${line}\nplain\n`)).toEqual([]);
    });
    expect(cpu).toBeLessThan(500);

    const jwt = `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`;
    for (const text of [jwt, `Bearer ${jwt}`, `"${jwt}"`, `token=${jwt}`, `see (${jwt}) there`]) expect(hasSecret(text), text).toBe(true);
    expect(redact(`the header was ${jwt} yesterday`)).toBe('the header was «redacted» yesterday');
  });

  it('reads a 200 KB line of credential words with and without values in well under a second', () => {
    for (const piece of ['token: ', 'PASSWORD="', 'Authorization: Bearer ', '--token ', 'token=a ']) {
      const line = piece.repeat(Math.ceil(200_000 / piece.length));
      const cpu = cpuMsSync(() => {
        hasSecret(line);
        redact(line);
      });
      expect(cpu, piece).toBeLessThan(500);
    }
  });
});

describe('title tails', () => {
  it('reads the due and done tails and trims what is left', () => {
    expect(parseTitleText('Ship it   (due 2026-12-01)  (done 2026-11-30)  ')).toEqual({ title: 'Ship it', due: '2026-12-01', doneOn: '2026-11-30' });
    expect(parseTitleText('Ship it (DUE 2026-12-01)')).toEqual({ title: 'Ship it', due: '2026-12-01', doneOn: null });
  });

  it('a tail needs a space before it and a real date in it', () => {
    expect(parseTitleText('Ship it(due 2026-12-01)')).toEqual({ title: 'Ship it(due 2026-12-01)', due: null, doneOn: null });
    expect(parseTitleText('(done 2026-11-30)')).toEqual({ title: '(done 2026-11-30)', due: null, doneOn: null });
    expect(parseTitleText('Ship it (due 2026-02-30)')).toEqual({ title: 'Ship it (due 2026-02-30)', due: null, doneOn: null });
  });
});
