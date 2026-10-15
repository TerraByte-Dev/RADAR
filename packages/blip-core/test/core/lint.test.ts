import { describe, it, expect } from 'vitest';
import { hasLabel, isShouting, isSlugName, lint } from '../../src/core/lint.js';
import { hasSecret, redact, secretLines } from '../../src/core/secrets.js';
import { LINT, fixture, parse, parseText } from './fixtures.js';

const ERRORS = ['yaml-invalid', 'schema-newer', 'fence-unclosed'];
const WARNINGS = [
  'schema-v2',
  'name-missing',
  'name-slug',
  'now-missing',
  'now-long',
  'title-long',
  'title-shouting',
  'title-label',
  'title-duplicate',
  'detail-long',
  'log-bullet-long',
  'due-not-iso',
  'done-in-queue',
  'open-in-done',
  'queue-too-long',
  'secret-shaped',
];
const CODES = [...ERRORS, ...WARNINGS];

const codes = (rel: string): string[] => lint(parse(rel)).map((p) => p.code);

describe('lint codes', () => {
  it('there are nineteen, each with one positive and one negative fixture', () => {
    expect(CODES).toHaveLength(19);
    expect(LINT).toEqual(CODES.flatMap((c) => [`lint/${c}.neg.md`, `lint/${c}.pos.md`]).sort());
  });

  it.each(CODES)('%s: the positive fixture has it', (code) => {
    const problems = lint(parse(`lint/${code}.pos.md`)).filter((p) => p.code === code);
    expect(problems.length).toBeGreaterThan(0);
    for (const p of problems) {
      expect(p.severity).toBe(ERRORS.includes(code) ? 'error' : 'warn');
      expect(p.message.length).toBeGreaterThan(10);
    }
  });

  it.each(CODES)('%s: the negative fixture is a near miss with no problems at all', (code) => {
    expect(codes(`lint/${code}.neg.md`)).toEqual([]);
  });

  it.each(CODES.filter((c) => !['yaml-invalid', 'schema-newer', 'schema-v2'].includes(c)))('%s: the positive fixture has nothing else wrong with it', (code) => {
    expect([...new Set(codes(`lint/${code}.pos.md`))]).toEqual([code]);
  });

  it('lint never changes the file', () => {
    for (const rel of LINT) {
      const file = parse(rel);
      lint(file);
      expect(file.toString()).toBe(fixture(rel));
    }
  });

  it('is the same list the read model carries', () => {
    const file = parse('lint/title-label.pos.md');
    expect(file.doc().problems).toEqual(lint(file));
  });
});

describe('where problems point', () => {
  it('a task problem carries the line of its title', () => {
    expect(lint(parse('lint/title-duplicate.pos.md'))).toEqual([expect.objectContaining({ code: 'title-duplicate', line: 10 })]);
    expect(lint(parse('lint/open-in-done.pos.md'))).toEqual([expect.objectContaining({ code: 'open-in-done', line: 13 })]);
  });

  it('an unclosed code fence points at the line that opens it, wherever it is', () => {
    expect(lint(parse('lint/fence-unclosed.pos.md'))).toEqual([expect.objectContaining({ code: 'fence-unclosed', line: 10 })]);
    // A fence of the other kind does not close it.
    const notes = parseText('---\nblip: 3\nname: Sample\nnow: Fine.\n---\n\n# Notes\n~~~\none\n```\ntwo\n');
    expect(lint(notes)).toEqual([expect.objectContaining({ code: 'fence-unclosed', line: 8 })]);
    expect(lint(parseText('---\r\nblip: 3\r\nname: Sample\r\nnow: Fine.\r\n---\r\n\r\n# Notes\r\n```\r\none\r\n'))).toEqual([expect.objectContaining({ code: 'fence-unclosed', line: 8 })]);
    expect(lint(parseText('---\nblip: 3\nname: Sample\nnow: Fine.\n---\n\n# Notes\n```\none\n```\n'))).toEqual([]);
  });

  it('a frontmatter problem carries the line of its key', () => {
    expect(lint(parse('lint/name-slug.pos.md'))[0]).toMatchObject({ code: 'name-slug', line: 3 });
    expect(lint(parse('lint/now-long.pos.md'))[0]).toMatchObject({ code: 'now-long', line: 4 });
    expect(lint(parse('lint/schema-newer.pos.md'))[0]).toMatchObject({ code: 'schema-newer', line: 2 });
  });

  it('a long log bullet carries the line it starts on', () => {
    expect(lint(parse('lint/log-bullet-long.pos.md'))[0]).toMatchObject({ code: 'log-bullet-long', line: 10 });
  });

  it('secret-shaped gives the line number and never the value', () => {
    const [p] = lint(parse('lint/secret-shaped.pos.md'));
    expect(p).toMatchObject({ code: 'secret-shaped', line: 10 });
    expect(p!.message).not.toContain('not-a-real-value');
  });

  it('counts lines correctly after CRLF and a BOM', () => {
    const text = `\uFEFF${fixture('lint/title-duplicate.pos.md').replace(/\n/g, '\r\n')}`;
    expect(lint(parseText(text))).toEqual([expect.objectContaining({ code: 'title-duplicate', line: 10 })]);
  });
});

describe('what is and is not reported', () => {
  it('a broken file reports the break, not a list of missing fields', () => {
    expect(codes('lint/yaml-invalid.pos.md')).toEqual(['yaml-invalid']);
    expect(codes('lint/schema-newer.pos.md')).toEqual(['schema-newer']);
  });

  it('queue-too-long is reported once, however long the queue', () => {
    expect(codes('v2/queue-95.md').filter((c) => c === 'queue-too-long')).toHaveLength(1);
  });

  it('title rules look at open tasks only: finished work is not nagged about', () => {
    const text = '---\nblip: 3\nname: Done Only\nnow: All finished.\n---\n\n# Tasks\n\n## Done\n\n- [x] EMAIL: ASK THE PRINTER FOR A QUOTE ON FIVE HUNDRED MORE CARDS AND THEN CHASE THEM EVERY DAY UNTIL IT ARRIVES (due friday)\n';
    expect(lint(parseText(text))).toEqual([]);
  });

  it('a non-date due in the frontmatter is reported', () => {
    const p = lint(parseText('---\nblip: 3\nname: Due Test\nnow: Fine.\ndue: next week\n---\n'));
    expect(p).toEqual([expect.objectContaining({ code: 'due-not-iso', line: 5 })]);
  });
});

describe('style predicates', () => {
  it('isSlugName: folder names, not spoken names', () => {
    for (const bad of ['game-mod-tools', '_notes-review', '01-Accounts', '.config', 'my_project']) expect(isSlugName(bad), bad).toBe(true);
    for (const good of ['RADAR', 'Lantern Notes', "Sam's Installs", 'Thesis research paper', 'lantern.page', 'Kestrel VR', 'Game Mod Tools']) expect(isSlugName(good), good).toBe(false);
  });

  it('isShouting: three or more words, twenty or more characters, all capitals', () => {
    expect(isShouting('SWITCH ON THE NEW SCANNER NOW')).toBe(true);
    expect(isShouting('ORDER 12 NEW TILL ROLLS TODAY')).toBe(true);
    for (const calm of ['TURN ON TAP', 'Turn on the scanner now please', 'FIX THE API', 'Ship RADAR to the NPM registry', 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS']) expect(isShouting(calm), calm).toBe(false);
  });

  it('hasLabel: an all-capitals lead-in before ":", " - " or " — "', () => {
    for (const labelled of ['SWITCH ON THE NEW SCANNER - it is wired', 'EMAIL: compare two newsletter tools', 'NEEDS $40 - order the spare cable', 'NOTE — the menu moved']) {
      expect(hasLabel(labelled), labelled).toBe(true);
    }
    // Fewer than four capital letters is an acronym, not a label: "API:", "GAP:".
    for (const plain of ['GAP: nobody owns the rota', 'Robin: approve the terms in PR #21', 'PR #21: answer the review', 'Fix the importer - it drops the last row', 'Fix it: THE API IS DOWN', 'Read https://example.com/a', 'API: retry on timeout']) {
      expect(hasLabel(plain), plain).toBe(false);
    }
  });
});

describe('secrets', () => {
  it('finds token-shaped text by line', () => {
    expect(secretLines('fine\nexport KEY=value\npassword: hunter2-but-fake\n\n--token abc123def456')).toEqual([3, 5]);
    expect(hasSecret('The token lives in the password manager')).toBe(false);
  });

  it('a credential word followed by ordinary words is prose, not a secret', () => {
    for (const prose of [
      'password: reset flow',
      'token = rotate later',
      'Password: reset flow is documented in the wiki',
      'MAIL_PASSWORD="put the real one here"',
      "SECRET: 'see the vault'",
      'Authorization: Bearer',
      'the --password flag is required',
      'API_KEY: see the vault',
      'token: `GH_TOKEN` from the environment',
      'token: 2026-10-13',
      'export TOKEN=$DEPLOY_TOKEN',
      '- [ ] Rotate the token: ask the bank first',
    ]) {
      expect(hasSecret(prose), prose).toBe(false);
    }
  });

  it('a credential word followed by a value shaped like a secret is still caught', () => {
    for (const secret of [
      'password: hunter2-but-fake',
      'TOKEN=abc123def456',
      'MAIL_PASSWORD="xk29fj3kd02"',
      "SECRET: 'q8w7e6r5t4y3'",
      'Authorization: Bearer abcdef123456ghijkl',
      'Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==',
      '--token abc123def456',
      '--api-key=abc123def456',
      'api_key: AbCdEfGhIjKlMnOpQrStUvWxYz',
      'token: (abc123def456).',
    ]) {
      expect(hasSecret(secret), secret).toBe(true);
    }
  });

  it('short passwords, symbols, digits only, and long letter-only keys are caught', () => {
    for (const secret of [
      'DB_PASSWORD=Spring1!',
      'password: Xk7#mQ2!',
      'password: "Spring1!"',
      "password: 'Xy7#kL9!'",
      '--password=Spring1!',
      'PASSWORD=48213907',
      'pin/password: 482139',
      'PIN: 482139',
      'password: hunter2',
      'password: 12345678',
      'Router admin password: Spring1! for the demo',
      'Authorization: Bearer abc',
      'token=AbCdEfGhIjKlMnOpQrStUvW',
      'API_KEY=abcdefghijklmnopqrstuvw',
      'password: Spring1.',
    ]) {
      expect(hasSecret(secret), secret).toBe(true);
    }
  });

  it('placeholders, names, dates, links and lower-case phrases stay prose', () => {
    for (const prose of [
      'MAIL_PASSWORD="put the real one here"',
      'secret = "correct horse battery staple"',
      'password: reset-flow',
      'token: `DEPLOY_TOKEN_FOR_PRODUCTION`',
      'token: ${DEPLOY_TOKEN}',
      'Authorization: Bearer <token>',
      'Authorization: Bearer $TOKEN',
      'password: https://vault.example/reset',
      'token: 2026-10-13.',
      'Pinned: 482139 as the build number',
      'spin: 123456',
      'password: hunter',
    ]) {
      expect(hasSecret(prose), prose).toBe(false);
    }
  });

  it('token shapes and package-manager config are caught whatever surrounds them', () => {
    for (const secret of [
      'see ghp_abcdefghijklmnopqrstuvwxyz0123 in the notes',
      'the key sk-abcdefghijklmnopqrstuvwx is old',
      '//registry.example/:_authToken=totally-opaque-value',
      '_auth=anything',
      'AKIAABCDEFGHIJKLMNOP',
    ]) {
      expect(hasSecret(secret), secret).toBe(true);
    }
  });

  it('redact blanks the whole value, quoted words and all, and leaves prose alone', () => {
    expect(redact('MAIL_PASSWORD="ab12 cd34 ef56" in the env file')).toBe('MAIL_PASSWORD=«redacted» in the env file');
    expect(redact('password: reset flow')).toBe('password: reset flow');
    expect(redact('Authorization: Bearer abcdef123456ghijkl')).toBe('Authorization: Bearer «redacted»');
  });

  it('gives the same answer every time it is asked (no state between calls)', () => {
    const line = 'curl -H "Authorization: Bearer sk-abcdefghijklmnopqrstuvwx"';
    expect([hasSecret(line), hasSecret(line), hasSecret(line)]).toEqual([true, true, true]);
  });

  it('redact still blanks the value, as in v2', () => {
    expect(redact('curl -H "Authorization: Bearer sk-abcdefghijklmnopqrstuvwx"')).not.toContain('abcdefghij');
    expect(redact('//registry.example/:_authToken=totally-opaque-value')).not.toContain('totally-opaque-value');
  });
});
