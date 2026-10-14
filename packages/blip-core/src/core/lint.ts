import type { BlipFile } from './doc.js';
import { keyLine, readFields, schemaOf, splitFrontmatter } from './frontmatter.js';
import { bulletItems, rawEntries } from './log.js';
import { CAPS, makeFenceTracker, measure, type Problem } from './schema.js';
import { secretLines } from './secrets.js';
import { DUE_PHRASE_RE, normalizeTitle } from './tasks.js';

/** Block detail longer than this is reported (`detail-long`): eight full lines. */
const DETAIL_WARN = CAPS.DETAIL_LINES_MAX * CAPS.DETAIL_LINE_MAX;

/** A name that is really a folder slug: `game-mod-tools`, `_notes-review`, `01-Accounts`. */
export function isSlugName(name: string): boolean {
  return /^[_.]/.test(name) || /^\d+-/.test(name) || /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+$/.test(name);
}

/** At least 3 words and 20 characters, and every word with two or more letters is upper-case. */
export function isShouting(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 3 || measure(text) < 20) return false;
  const lettered = words.filter((w) => (w.match(/\p{L}/gu) ?? []).length >= 2);
  return lettered.length > 0 && lettered.every((w) => !/\p{Ll}/u.test(w));
}

/** Begins with one or more all-caps words (4+ letters in total) immediately followed by `:`, ` - ` or ` — `. */
export function hasLabel(text: string): boolean {
  const m = /:| - | — /.exec(text);
  if (!m || m.index === 0) return false;
  const lead = text.slice(0, m.index);
  return !/\p{Ll}/u.test(lead) && (lead.match(/\p{Lu}/gu) ?? []).length >= 4;
}

/** 1-based line of a code fence in the body that is still open at the end of the file, or null. */
export function openFenceLine(file: BlipFile): number | null {
  const fm = splitFrontmatter(file.toString().replace(/^\uFEFF/, ''));
  const inFence = makeFenceTracker();
  let opened: number | null = null;
  fm.body.split(/\r?\n/).forEach((line, i) => {
    const inside = inFence(line);
    if (!inside) opened = null;
    else if (opened === null) opened = i + 1;
  });
  return opened === null ? null : opened + (fm.block ?? '').split('\n').length - 1;
}

/**
 * Everything worth telling the owner about a file. Never changes anything. Three codes are
 * errors: the header cannot be written (`yaml-invalid`, `schema-newer`), or no task or log
 * entry can be written below a code fence nobody closed (`fence-unclosed`). The rest are warnings.
 */
export function lint(file: BlipFile): Problem[] {
  const st = file.state;
  const out: Problem[] = [];
  const add = (code: string, message: string, line: number | null = null, severity: Problem['severity'] = 'warn'): void => {
    out.push({ code, severity, message, line });
  };
  /** Frontmatter lines start after the opening `---`. */
  const fmLine = (key: string): number | null => {
    const n = keyLine(st.fmRaw, key);
    return n === null ? null : n + 1;
  };

  const declared = schemaOf(st.values);
  if (st.fmError) {
    const at = st.fmError.line === null ? null : st.fmError.line + 1;
    add('yaml-invalid', `the frontmatter is not valid YAML (${st.fmError.message}); the file is read-only until it is fixed`, at, 'error');
  } else if (declared === 'newer') {
    add('schema-newer', `this file says "blip: ${String(st.values.blip)}", which is newer than this radar-blip understands; it is read-only here`, fmLine('blip'), 'error');
  } else {
    if (declared === 2) add('schema-v2', 'this file is in the v2 format and is read-only until the owner runs "radar-blip migrate"');

    const fields = readFields(st.values, file.schema);
    if (fields.name === null) add('name-missing', 'the project has no name; the folder name is shown instead');
    else if (isSlugName(fields.name)) add('name-slug', `the name "${fields.name}" looks like a folder name, not what you would call the project out loud`, fmLine('name'));
    if (fields.now === null) add('now-missing', 'there is no "now" line saying where the project stands');
    else if (measure(fields.now) > CAPS.NOW_MAX) add('now-long', `the "now" line is ${measure(fields.now)} characters (max ${CAPS.NOW_MAX})`, fmLine('now'));
    if (fields.dueInvalid) add('due-not-iso', 'the due date is not a real YYYY-MM-DD date, so the project has no due date', fmLine('due') ?? fmLine('deadline'));
  }

  const sec = file.tasksSection;
  if (sec) {
    const open = file.openTasks();
    const seen = new Set<string>();
    for (const b of open) {
      const len = measure(b.title);
      if (len > CAPS.TITLE_MAX) add('title-long', `the task title is ${len} characters (max ${CAPS.TITLE_MAX}); keep the action in the title and move the rest into detail lines`, b.line);
      if (isShouting(b.title)) add('title-shouting', 'the task title is all capitals', b.line);
      if (hasLabel(b.title)) add('title-label', 'the task title starts with an all-capitals label; drop the label and start with the verb', b.line);
      const detail = b.children.reduce((n, l) => n + measure(l), 0);
      if (detail > DETAIL_WARN) add('detail-long', `the detail under this task is ${detail} characters (more than ${DETAIL_WARN})`, b.line);
      if (DUE_PHRASE_RE.test(b.title)) add('due-not-iso', 'the "(due …)" at the end of this task is not a YYYY-MM-DD date, so it is read as plain text', b.line);
      const norm = normalizeTitle(b.title);
      if (seen.has(norm)) add('title-duplicate', 'another open task has the same title', b.line);
      seen.add(norm);
    }
    if (file.schema === 3) {
      for (const b of sec.queue) if (b.checked) add('done-in-queue', 'this finished task is still in the queue; it moves under "## Done" on the next write', b.line);
      for (const b of sec.done) if (!b.checked) add('open-in-done', 'this task is under "## Done" but is not ticked; it counts as open and moves back to the queue on the next write', b.line);
    }
    if (open.length > CAPS.OPEN_WARN) add('queue-too-long', `there are ${open.length} open tasks (more than ${CAPS.OPEN_WARN})`, sec.queue[0]?.line ?? null);
  }

  const log = file.logSection;
  if (log) {
    for (const e of rawEntries(log)) {
      for (const item of bulletItems(e.lines.slice(1))) {
        const len = measure(item.text);
        if (len > CAPS.LOG_BULLET_MAX) add('log-bullet-long', `this log line is ${len} characters (max ${CAPS.LOG_BULLET_MAX})`, e.line === null ? null : e.line + 1 + item.offset);
      }
    }
  }

  const fence = openFenceLine(file);
  if (fence !== null) {
    add('fence-unclosed', 'the code fence opened on this line is never closed: every line below it is read as code, so no task or log entry under it is seen, and nothing can be written below it', fence, 'error');
  }
  for (const line of secretLines(file.toString())) add('secret-shaped', 'this line looks like it contains a password, key or token', line);
  return out;
}
