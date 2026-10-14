import { createHash } from 'node:crypto';
import { parseIsoDate } from './dates.js';
import { collapse, fold, makeFenceTracker, trimBlankTail, type Task } from './schema.js';

/**
 * The `# Tasks` section as blocks. A task is its column-0 title line plus every line that
 * follows it, up to the next title line, the `## Done` heading or the end of the section.
 * Indented lines, blank lines in the middle and column-0 "loose" lines all belong to the
 * block above them and move and delete with it — no line in the section is unowned.
 */
export interface TaskBlock {
  checked: boolean;
  /** Title text with the due and done tails removed. */
  title: string;
  due: string | null;
  doneOn: string | null;
  /** Every line under the title, verbatim. Trailing blank lines are not part of a block. */
  children: string[];
  /** 1-based line of the title in the file it was parsed from; null for a block made since. */
  line: number | null;
}

export interface TaskSection {
  /** The `# Tasks` heading line, verbatim. */
  heading: string;
  /** Lines between the heading and the first block, verbatim. */
  preamble: string[];
  /** Blocks above `## Done`, in file order. */
  queue: TaskBlock[];
  /** The `## Done` heading line, verbatim; null when the section has none. */
  doneHeading: string | null;
  /** Lines between `## Done` and the first block under it, verbatim. */
  donePreamble: string[];
  /** Blocks under `## Done`, in file order. */
  done: TaskBlock[];
}

/** Column 0 only: an indented `- [ ]` is detail, not a task. */
export const TITLE_LINE_RE = /^[-*] \[([ xX])\][ \t]+(.*)$/;
const DONE_HEADING_RE = /^## +done[ \t]*$/i;
/** A `(done …)` or `(due …)` tail. Matched against the end of the text only: see {@link takeTail}. */
const TAIL_RE = /^\s\((done|due) (\d{4}-\d{2}-\d{2})\)$/i;
/** A `(due …)` tail of any wording. Only a strict ISO date is a due date; the rest is title text. */
export const DUE_PHRASE_RE = /\(due\s+[^)]*\)\s*$/i;

/**
 * Take a ` (done YYYY-MM-DD)` or ` (due YYYY-MM-DD)` tail off the end of a title. The tail
 * has a fixed length, so only that many characters are looked at: a pattern starting with
 * `\s+` is retried at every space and is quadratic on a long run of them.
 */
function takeTail(text: string, word: 'done' | 'due'): { rest: string; date: string } | null {
  const m = TAIL_RE.exec(text.slice(-(word.length + 14)));
  if (!m || m[1]!.toLowerCase() !== word || !parseIsoDate(m[2])) return null;
  return { rest: text.slice(0, -(word.length + 14)).trimEnd(), date: m[2]! };
}

/** Split the text after the checkbox into title, due and done stamp. */
export function parseTitleText(text: string): { title: string; due: string | null; doneOn: string | null } {
  let title = text.trimEnd();
  let due: string | null = null;
  let doneOn: string | null = null;
  const done = takeTail(title, 'done');
  if (done) {
    doneOn = done.date;
    title = done.rest;
  }
  const dueTail = takeTail(title, 'due');
  if (dueTail) {
    due = dueTail.date;
    title = dueTail.rest;
  }
  return { title, due, doneOn };
}

export function renderTitleLine(b: TaskBlock): string {
  const due = b.due ? ` (due ${b.due})` : '';
  const done = b.doneOn ? ` (done ${b.doneOn})` : '';
  return `- [${b.checked ? 'x' : ' '}] ${b.title}${due}${done}`;
}

/** The block exactly as it is written: title line plus children. */
export function renderBlock(b: TaskBlock): string[] {
  return [renderTitleLine(b), ...b.children];
}

/** Task identity: NFC, whitespace collapsed, one trailing `.` removed, lower-cased. */
export function normalizeTitle(title: string): string {
  return collapse(title).replace(/\.$/, '').trimEnd().toLowerCase();
}

/**
 * Parse a `# Tasks` section. `lines[0]` is the heading; `firstLine` is its 1-based line
 * in the file. Nothing inside a code fence is a task or a `## Done` heading.
 */
export function parseTaskSection(lines: readonly string[], firstLine: number): TaskSection {
  const sec: TaskSection = { heading: lines[0] ?? '# Tasks', preamble: [], queue: [], doneHeading: null, donePreamble: [], done: [] };
  const inFence = makeFenceTracker();
  let current: TaskBlock | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inFence(line)) {
      if (sec.doneHeading === null && DONE_HEADING_RE.test(line)) {
        sec.doneHeading = line;
        current = null;
        continue;
      }
      const m = TITLE_LINE_RE.exec(line);
      if (m) {
        current = { checked: m[1] !== ' ', ...parseTitleText(m[2]!), children: [], line: firstLine + i };
        (sec.doneHeading === null ? sec.queue : sec.done).push(current);
        continue;
      }
    }
    if (current) current.children.push(line);
    else (sec.doneHeading === null ? sec.preamble : sec.donePreamble).push(line);
  }
  for (const b of [...sec.queue, ...sec.done]) trimBlankTail(b.children);
  return sec;
}

/** A new, empty section in the canonical layout. */
export function emptyTaskSection(): TaskSection {
  return { heading: '# Tasks', preamble: [''], queue: [], doneHeading: null, donePreamble: [], done: [] };
}

/**
 * Serialise the section. Blocks are emitted verbatim apart from their title line; exactly
 * one blank line precedes `## Done`, and the result carries no trailing blank line (the
 * caller adds the one that separates sections).
 */
export function renderTaskSection(sec: TaskSection): string[] {
  const out: string[] = [sec.heading, ...sec.preamble];
  for (const b of sec.queue) out.push(...renderBlock(b));
  if (sec.doneHeading !== null || sec.done.length) {
    trimBlankTail(out);
    out.push('', sec.doneHeading ?? '## Done', ...(sec.doneHeading === null ? [''] : sec.donePreamble));
    for (const b of sec.done) out.push(...renderBlock(b));
  }
  return trimBlankTail(out);
}

/** A block the engine writes: one-line title, detail indented two spaces and otherwise verbatim. */
export function makeBlock(input: { title: string; detail?: readonly string[]; due?: string | null }): TaskBlock {
  return {
    checked: false,
    title: fold(input.title),
    due: input.due ?? null,
    doneOn: null,
    children: indentDetail(input.detail ?? []),
    line: null,
  };
}

export function indentDetail(detail: readonly string[]): string[] {
  return trimBlankTail(detail.map((l) => (fold(l) === '' ? '' : `  ${fold(l)}`)));
}

/**
 * Put the two out-of-place cases right: ticked boxes left in the queue move to the top of
 * `## Done` (stamped `doneOn` when a date is given and they carry none, their due tail
 * dropped), and unticked boxes under `## Done` move to the end of the queue. Both keep
 * file order and take their children with them.
 */
export function settle(sec: TaskSection, doneOn: string | null): { doneInQueue: number; openInDone: number } {
  const ticked = sec.queue.filter((b) => b.checked);
  const unticked = sec.done.filter((b) => !b.checked);
  if (ticked.length) {
    for (const b of ticked) {
      if (doneOn && !b.doneOn) {
        b.doneOn = doneOn;
        b.due = null;
      }
    }
    sec.queue = sec.queue.filter((b) => !b.checked);
    sec.done = [...ticked, ...sec.done];
  }
  if (unticked.length) {
    for (const b of unticked) b.doneOn = null;
    sec.done = sec.done.filter((b) => b.checked);
    sec.queue = [...sec.queue, ...unticked];
  }
  return { doneInQueue: ticked.length, openInDone: unticked.length };
}

/** Open or done is decided by the checkbox, never by position. */
export function openBlocks(sec: TaskSection): TaskBlock[] {
  return [...sec.queue, ...sec.done].filter((b) => !b.checked);
}

export function doneBlocks(sec: TaskSection): TaskBlock[] {
  return [...sec.queue, ...sec.done].filter((b) => b.checked);
}

/** v2's loose task equality, used only for its `next_action` key: case, spacing and a `(due …)` tail do not count. */
export function sameLegacyTask(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(DUE_PHRASE_RE, '').trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

/** Strip one indent level (a tab, or up to two spaces) from a child line. */
function stripIndent(line: string): string {
  return line.replace(/^(?:\t| {1,2})/, '');
}

/** Read-model views of a list of blocks. Equal normalised titles get `~2`, `~3` on their key. */
export function taskViews(blocks: readonly TaskBlock[], open: boolean): Task[] {
  const seen = new Map<string, number>();
  return blocks.map((b, i) => {
    const norm = normalizeTitle(b.title);
    const count = (seen.get(norm) ?? 0) + 1;
    seen.set(norm, count);
    const hash = createHash('sha1').update(norm).digest('hex').slice(0, 8);
    return {
      key: count > 1 ? `${hash}~${count}` : hash,
      title: b.title,
      detail: b.children.map(stripIndent),
      due: b.due,
      done: !open,
      doneOn: b.doneOn,
      n: open ? i + 1 : null,
    };
  });
}
