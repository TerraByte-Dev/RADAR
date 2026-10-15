/**
 * The v3 BLIP.md vocabulary: caps, enums, the read model, the error type and the few
 * text helpers every other core module shares. Pure — no fs, no os, no child processes.
 */

/** Every length limit in one place. Lengths are measured with {@link measure}. */
export const CAPS = {
  NAME_MIN: 2,
  NAME_MAX: 32,
  NOW_MAX: 140,
  TITLE_MIN: 3,
  TITLE_MAX: 80,
  DETAIL_LINES_MAX: 8,
  DETAIL_LINE_MAX: 160,
  LOG_BULLETS_MAX: 6,
  LOG_BULLET_MAX: 200,
  OPEN_WARN: 25,
  LINKS_MAX: 20,
  LINK_URL_MAX: 2048,
  BRIEF_MAX_BYTES: 8192,
  SKILL_FORMAT: 1,
} as const;

/**
 * Spec 4.5, the one table of who writes what. `sync`: an agent may send it in a payload
 * (`'unnamed'`: only while the project has no name, or a slug one). `setWhenAsked`: an agent
 * may run `radar-blip set` for it, only when the owner asked for that in the conversation.
 * The owner may write every field. Tests check the skill files and `applyEdit` against it.
 */
export const FIELD_OWNERSHIP: readonly { field: string; value?: string; sync: boolean | 'unnamed'; setWhenAsked: boolean }[] = [
  { field: 'now', sync: true, setWhenAsked: false },
  { field: 'tasks', sync: true, setWhenAsked: false },
  { field: 'log', sync: true, setWhenAsked: false },
  { field: 'status', value: 'active', sync: true, setWhenAsked: false },
  { field: 'status', value: 'blocked', sync: true, setWhenAsked: false },
  { field: 'status', value: 'paused', sync: false, setWhenAsked: true },
  { field: 'status', value: 'archived', sync: false, setWhenAsked: true },
  { field: 'name', sync: 'unnamed', setWhenAsked: true },
  { field: 'due', sync: false, setWhenAsked: true },
  { field: 'tags', sync: false, setWhenAsked: true },
  { field: 'focus', sync: false, setWhenAsked: true },
  { field: 'links', sync: false, setWhenAsked: false },
];

/** The schema version this engine writes (`blip: 3`). */
export const SCHEMA_VERSION = 3;

export const STATUSES = ['active', 'blocked', 'paused', 'archived'] as const;
export type BlipStatus = (typeof STATUSES)[number];

/** Frontmatter keys the engine manages, in the order it writes them. Every other key is preserved verbatim. */
export const MANAGED_KEYS = ['blip', 'name', 'now', 'status', 'focus', 'due', 'tags', 'links'] as const;
export type ManagedKey = (typeof MANAGED_KEYS)[number];

/** Link schemes that reach the read model; anything else stays in the file untouched. */
export const LINK_SCHEMES: readonly string[] = ['http:', 'https:', 'mailto:'];

// ---- read model: the only shape the app and `--json` ever see ----

export interface BlipDoc {
  /** What is on disk. The shape below is always v3. */
  schema: 2 | 3;
  /** Folder basename when the file has none. */
  name: string;
  nameSource: 'file' | 'folder';
  now: string | null;
  status: BlipStatus;
  focus: boolean;
  /** `YYYY-MM-DD`. */
  due: string | null;
  /** `tags[0]` is the project's group. */
  tags: string[];
  links: { label: string | null; url: string }[];
  tasks: { open: Task[]; done: Task[] };
  /** `tasks.open[0]`. */
  next: Task | null;
  /** File order (newest first in a v3 file); a date-sorted view for a v2 file. */
  log: LogEntry[];
  /** ISO instant: the maximum over all entries. */
  lastLogAt: string | null;
  problems: Problem[];
  /** False for a v2 file, a newer schema and broken YAML. */
  writable: boolean;
}

export interface Task {
  /** Rendering convenience only — never part of a reference. */
  key: string;
  /** Tails removed. */
  title: string;
  /** Lines, one indent level stripped, verbatim otherwise. */
  detail: string[];
  due: string | null;
  done: boolean;
  doneOn: string | null;
  /** 1-based position among open tasks; null when done. */
  n: number | null;
}

export interface LogEntry {
  /** Raw heading text after `## `. */
  heading: string;
  /** Parsed views; null when the heading does not fit. */
  date: string | null;
  time: string | null;
  author: string | null;
  /** Raw body lines, verbatim. */
  lines: string[];
  /** Each top-level `- ` item with its wrapped continuation lines joined by one space. */
  bullets: string[];
}

export interface Problem {
  code: string;
  severity: 'error' | 'warn';
  message: string;
  /** 1-based line in the file, when the problem has one. */
  line: number | null;
}

// ---- errors ----

export interface Violation {
  code: string;
  path: string;
  message: string;
}

export class BlipError extends Error {
  code: string;
  hint?: string;
  path?: string;
  violations?: Violation[];

  constructor(code: string, message: string, extra: { hint?: string; path?: string; violations?: Violation[] } = {}) {
    super(message);
    this.name = 'BlipError';
    this.code = code;
    if (extra.hint !== undefined) this.hint = extra.hint;
    if (extra.path !== undefined) this.path = extra.path;
    if (extra.violations !== undefined) this.violations = extra.violations;
  }
}

// ---- text helpers ----

/** NFC, runs of whitespace collapsed to one space, trimmed — the form every length is counted in. */
export function collapse(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Length in Unicode code points after {@link collapse}. */
export function measure(s: string): number {
  let n = 0;
  for (const _ of collapse(s)) n++;
  return n;
}

/** Anything an editor or a tool may treat as the end of a line, a lone CR included. */
const LINE_BREAKS_RE = /[\r\n\v\f\u0085\u2028\u2029]+/;
/** The other control characters: no business in a one-line field. Tab stays. */
const CONTROLS_RE = /[\u0000-\u0008\u000e-\u001f\u007f]/g;

/** Half of a surrogate pair on its own: not a character, and not something UTF-8 can hold. */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * The string as it will be read back from a UTF-8 file: a lone surrogate becomes U+FFFD.
 * Without this the text in memory and the text on disk differ, and a title is never found
 * equal to itself on the next read.
 */
export function wellFormed(s: string): string {
  return s.replace(LONE_SURROGATE_RE, '�');
}

/** Trim spaces and tabs from both ends. A loop, because `/[ \t]+$/` is quadratic on a long run of spaces mid-line. */
function trimBlanks(s: string): string {
  const blank = (i: number): boolean => s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9;
  let from = 0;
  let to = s.length;
  while (from < to && blank(from)) from++;
  while (to > from && blank(to - 1)) to--;
  return s.slice(from, to);
}

/**
 * Fold a string to one line. Everything the engine writes into a title, a heading or a
 * bullet goes through this first, so text can never forge a heading or a checklist line —
 * not in this parser, and not in an editor that ends a line at a lone CR or a form feed.
 */
export function fold(s: string): string {
  return wellFormed(s)
    .split(LINE_BREAKS_RE)
    .map(trimBlanks)
    .filter((piece) => piece !== '')
    .join(' ')
    .replace(CONTROLS_RE, '')
    .trim();
}

/** Tag slug: lower-case, runs outside `[a-z0-9]` become `-`, leading and trailing `-` trimmed. */
export function slugTag(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Line-by-line fenced-code tracker (``` / ~~~, CommonMark-ish: up to 3 spaces of indent,
 * a closing fence at least as long as the opener, backtick info strings may not contain
 * a backtick). Returns true for any line inside a fence — delimiters included — so
 * callers never mistake a heading or a checklist in a code example for the real thing.
 * Carried over unchanged from the v2 engine.
 */
export function makeFenceTracker(): (line: string) => boolean {
  let open: { char: string; len: number } | null = null;
  return (line: string): boolean => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      if (m && m[1]![0] === open.char && m[1]!.length >= open.len && m[2]!.trim() === '') open = null;
      return true;
    }
    if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      open = { char: m[1]![0]!, len: m[1]!.length };
      return true;
    }
    return false;
  };
}

/** Drop blank lines from the end of a line list, in place. */
export function trimBlankTail(lines: string[]): string[] {
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines;
}
