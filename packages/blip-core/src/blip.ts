import { parseDocument } from 'yaml';
import type { Document } from 'yaml';
import {
  type BlipTask,
  type BlipFields,
  type Horizon,
  type Status,
  KNOWN_KEYS,
  DEFAULTS,
  coerceHorizon,
  coerceStatus,
  coercePriority,
  coerceAngle,
  coerceDeadline,
} from './types.js';
import { detectAuthor } from './identity.js';

/** Leading-frontmatter matcher. Anchored to start; lazy body so a stray `---` in a value is tolerated. */
const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
/** Column-0 only: an indented `- [ ]` is a sub-bullet (body text), not an engine-owned task. */
const TASK_LINE_RE = /^- \[([ xX])\][ \t]+(.*)$/;
const LEAD_COMMENT_RE = /^\s*<!--[\s\S]*?-->/;

/**
 * Line-by-line fenced-code tracker (``` / ~~~, CommonMark-ish: up to 3 spaces of indent,
 * a closing fence at least as long as the opener, backtick info strings may not contain
 * a backtick). Returns true for any line inside a fence — delimiters included — so
 * callers never mistake a `# Tasks` heading or `- [ ]` checklist in a code example
 * for the real thing.
 */
function makeFenceTracker(): (line: string) => boolean {
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

/** Tasks are single-line by contract — fold embedded newlines (which would otherwise forge headings or checklist lines in the file) into spaces. */
function singleLine(text: string): string {
  return text.replace(/[ \t]*\r?\n[ \t\r\n]*/g, ' ').trim();
}

/** Session-log dates are `YYYY-MM-DD` by contract; reject anything else loudly rather than write a malformed entry heading. */
function normalizeSessionDate(date: string): string {
  const s = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) {
    throw new Error(`invalid session date ${JSON.stringify(date)} — use YYYY-MM-DD`);
  }
  return s;
}

/** Best-effort string coercion for frontmatter scalars: `name: 123` arrives from YAML as a number, not a string. */
function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

type Block =
  | { kind: 'raw'; heading: string | null; text: string }
  | { kind: 'tasks'; heading: string; comment: string; original: string; dirty: boolean }
  | { kind: 'log'; heading: string; text: string };

export interface BlipReadModel extends BlipFields {
  tasks: BlipTask[];
  /** The `# Session log` body (heading stripped), read-only. */
  sessionLog: string;
  /** Frontmatter keys the engine does not manage, surfaced read-only. */
  unknown: Record<string, unknown>;
}

export interface SessionEntry {
  date?: string; // YYYY-MM-DD, defaults to today (local)
  author?: string; // defaults to the detected OS user (see detectAuthor)
  lines: string[];
}

function splitBody(body: string): { heading: string | null; text: string }[] {
  // Walk line-by-line tracking fenced-code state so a `# Tasks` inside a code example
  // (say, in # Notes) can never hijack the real section boundaries — only `# ` headings
  // OUTSIDE fences split the body.
  const matches: { index: number; heading: string }[] = [];
  const inFence = makeFenceTracker();
  let pos = 0;
  while (pos <= body.length) {
    const nl = body.indexOf('\n', pos);
    const end = nl === -1 ? body.length : nl;
    let line = body.slice(pos, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!inFence(line)) {
      const hm = /^# (.+?)[ \t]*$/.exec(line);
      if (hm) matches.push({ index: pos, heading: hm[1]!.trim() });
    }
    if (nl === -1) break;
    pos = nl + 1;
  }

  const blocks: { heading: string | null; text: string }[] = [];
  if (matches.length === 0) {
    if (body.length) blocks.push({ heading: null, text: body });
    return blocks;
  }
  const firstIdx = matches[0]!.index;
  if (firstIdx > 0) blocks.push({ heading: null, text: body.slice(0, firstIdx) });
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : body.length;
    blocks.push({ heading: m.heading, text: body.slice(m.index, end) });
  }
  return blocks;
}

function parseTasksSection(text: string): { comment: string; tasks: BlipTask[]; taskLines: number[] } {
  const nl = text.indexOf('\n');
  const afterHeading = nl >= 0 ? text.slice(nl + 1) : '';
  const cm = LEAD_COMMENT_RE.exec(afterHeading);
  const comment = cm ? cm[0].trim() : '';
  const tasks: BlipTask[] = [];
  const taskLines: number[] = []; // section-relative line index (heading = line 0) per task
  const inFence = makeFenceTracker();
  const lines = afterHeading.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (inFence(line)) continue; // a checklist inside a fenced example is not a task
    const tm = TASK_LINE_RE.exec(line);
    if (tm) {
      tasks.push({ done: tm[1]!.toLowerCase() === 'x', text: tm[2]!.trimEnd() });
      taskLines.push(i + 1);
    }
  }
  return { comment, tasks, taskLines };
}

/**
 * Where the first checklist line goes in a section that has none: right after the
 * heading and its lead `<!-- … -->` comment (if any). Index into the section's lines.
 */
function taskInsertionPoint(lines: string[]): number {
  const afterHeading = lines.slice(1).join('\n');
  const cm = LEAD_COMMENT_RE.exec(afterHeading);
  return cm ? 1 + cm[0].split('\n').length : 1;
}

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * A parsed BLIP.md. Reads managed fields/tasks; mutations are non-destructive —
 * unknown frontmatter keys and unmanaged body sections (incl. `# Notes`) round-trip verbatim.
 */
export class Blip {
  #hadBom: boolean;
  #eol: '\n' | '\r\n';
  #fmRaw: string | null;
  #fmValues: Record<string, unknown>;
  #fmErrors: string[];
  #doc: Document | null = null;
  #fmDirty = false;
  #blocks: Block[];
  #tasks: BlipTask[];
  /** Section-relative source line of each task parsed from the original `# Tasks` text. */
  #taskLines: WeakMap<BlipTask, number>;
  #tasksBlock: Extract<Block, { kind: 'tasks' }> | null;
  #logBlock: Extract<Block, { kind: 'log' }> | null;

  private constructor(state: {
    hadBom: boolean;
    eol: '\n' | '\r\n';
    fmRaw: string | null;
    fmValues: Record<string, unknown>;
    fmErrors: string[];
    blocks: Block[];
    tasks: BlipTask[];
    taskLines: WeakMap<BlipTask, number>;
    tasksBlock: Extract<Block, { kind: 'tasks' }> | null;
    logBlock: Extract<Block, { kind: 'log' }> | null;
  }) {
    this.#hadBom = state.hadBom;
    this.#eol = state.eol;
    this.#fmRaw = state.fmRaw;
    this.#fmValues = state.fmValues;
    this.#fmErrors = state.fmErrors;
    this.#blocks = state.blocks;
    this.#tasks = state.tasks;
    this.#taskLines = state.taskLines;
    this.#tasksBlock = state.tasksBlock;
    this.#logBlock = state.logBlock;
  }

  static parse(raw: string): Blip {
    let s = raw;
    const hadBom = s.charCodeAt(0) === 0xfeff;
    if (hadBom) s = s.slice(1);
    const eol: '\n' | '\r\n' = s.includes('\r\n') ? '\r\n' : '\n';

    let fmRaw: string | null = null;
    let body = s;
    const m = FM_RE.exec(s);
    if (m) {
      fmRaw = m[1]!;
      body = s.slice(m[0].length);
    }

    let fmValues: Record<string, unknown> = {};
    let fmErrors: string[] = [];
    if (fmRaw !== null) {
      try {
        // The yaml Document collects syntax errors instead of throwing — and a doc with
        // errors would be mangled by re-serialization, so writes refuse (#assertWritable)
        // while reads still surface whatever toJS() could recover.
        const doc = parseDocument(fmRaw);
        fmErrors = doc.errors.map((e) => e.message.split('\n')[0]!.trim());
        const js = doc.toJS();
        if (js && typeof js === 'object') fmValues = js as Record<string, unknown>;
      } catch (err) {
        // Malformed YAML: keep empty values but preserve raw text so we never destroy it.
        fmValues = {};
        fmErrors = [err instanceof Error ? err.message.split('\n')[0]!.trim() : String(err)];
      }
    }

    const blocks: Block[] = [];
    let tasks: BlipTask[] = [];
    const taskLines = new WeakMap<BlipTask, number>();
    let tasksBlock: Extract<Block, { kind: 'tasks' }> | null = null;
    let logBlock: Extract<Block, { kind: 'log' }> | null = null;

    for (const seg of splitBody(body)) {
      const key = seg.heading?.toLowerCase();
      if (key === 'tasks' && !tasksBlock) {
        const parsed = parseTasksSection(seg.text);
        tasks = parsed.tasks;
        parsed.tasks.forEach((t, i) => taskLines.set(t, parsed.taskLines[i]!));
        tasksBlock = { kind: 'tasks', heading: seg.heading!, comment: parsed.comment, original: seg.text, dirty: false };
        blocks.push(tasksBlock);
      } else if (key === 'session log' && !logBlock) {
        logBlock = { kind: 'log', heading: seg.heading!, text: seg.text };
        blocks.push(logBlock);
      } else {
        blocks.push({ kind: 'raw', heading: seg.heading, text: seg.text });
      }
    }

    return new Blip({ hadBom, eol, fmRaw, fmValues, fmErrors, blocks, tasks, taskLines, tasksBlock, logBlock });
  }

  // ---- reading ----

  get fields(): BlipFields {
    const v = this.#fmValues;
    const out: BlipFields = {
      horizon: coerceHorizon(v.horizon),
      priority: coercePriority(v.priority),
      category: asString(v.category) ?? DEFAULTS.category,
      status: coerceStatus(v.status),
    };
    const name = asString(v.name);
    if (name !== undefined) out.name = name;
    const nextAction = asString(v.next_action);
    if (nextAction !== undefined) out.next_action = nextAction;
    // A garbage deadline is dropped on read (per docs/BLIP-SCHEMA.md) instead of crashing consumers.
    const deadline = coerceDeadline(v.deadline);
    if (deadline !== undefined) out.deadline = deadline;
    const angle = coerceAngle(v.radar_angle);
    if (angle !== undefined) out.radar_angle = angle;
    if (typeof v.operation === 'string') out.operation = v.operation;
    if (typeof v.created === 'string') out.created = v.created;
    if (typeof v.last_session === 'string') out.last_session = v.last_session;
    if (v.tags !== undefined && v.tags !== null) {
      out.tags = (Array.isArray(v.tags) ? v.tags : [v.tags]).filter((t): t is string => typeof t === 'string');
    }
    if (Array.isArray(v.links)) out.links = v.links;
    return out;
  }

  get tasks(): readonly BlipTask[] {
    return this.#tasks;
  }

  /** YAML syntax errors found in the frontmatter at parse time. Non-empty ⇒ the blip is read-only (every mutation throws). */
  get fmErrors(): readonly string[] {
    return this.#fmErrors;
  }

  toReadModel(): BlipReadModel {
    const unknown: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(this.#fmValues)) {
      if (!KNOWN_KEYS.includes(k)) unknown[k] = val;
    }
    let sessionLog = '';
    if (this.#logBlock) {
      const t = this.#logBlock.text;
      const nl = t.indexOf('\n');
      sessionLog = (nl >= 0 ? t.slice(nl + 1) : '').trim();
    }
    return { ...this.fields, tasks: this.#tasks.map((t) => ({ ...t })), sessionLog, unknown };
  }

  // ---- frontmatter editing ----

  /** Broken frontmatter round-trips verbatim on read but must never be re-serialized — writes fail fast instead of mangling. */
  #assertWritable(): void {
    if (this.#fmErrors.length) {
      throw new Error(`frontmatter has YAML errors — fix BLIP.md by hand or re-init (${this.#fmErrors[0]})`);
    }
  }

  #ensureDoc(): Document {
    if (!this.#doc) this.#doc = parseDocument(this.#fmRaw ?? '');
    return this.#doc;
  }

  setField(key: string, value: unknown): this {
    this.#assertWritable();
    const doc = this.#ensureDoc();
    if (value === undefined || value === null) {
      doc.delete(key);
      delete this.#fmValues[key];
    } else {
      doc.set(key, value);
      this.#fmValues[key] = value;
    }
    this.#fmDirty = true;
    return this;
  }

  /** Apply a partial patch of managed fields (only provided keys are touched). */
  merge(patch: Partial<BlipFields>): this {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) this.setField(k, v);
    }
    return this;
  }

  setHorizon(h: Horizon): this { return this.setField('horizon', h); }
  setPriority(p: number): this { return this.setField('priority', coercePriority(p)); }
  setCategory(c: string): this { return this.setField('category', c); }
  setStatus(s: Status): this { return this.setField('status', s); }
  setNextAction(text: string): this { return this.setField('next_action', text); }
  /** Set or (with `null`) clear the hard deadline. */
  setDeadline(date: string | null): this { return this.setField('deadline', date ?? undefined); }
  /** Pin the visual radar angle, or clear it with `null`. Stored normalized to [0, 360). */
  setRadarAngle(angle: number | null): this {
    return this.setField('radar_angle', angle == null ? undefined : coerceAngle(angle));
  }
  setOperation(op: string | null): this { return this.setField('operation', op ?? undefined); }

  // ---- task editing ----

  #ensureTasksBlock(): Extract<Block, { kind: 'tasks' }> {
    if (this.#tasksBlock) return this.#tasksBlock;
    const block: Extract<Block, { kind: 'tasks' }> = { kind: 'tasks', heading: 'Tasks', comment: '', original: '', dirty: true };
    // Insert before the session log, else before a Notes section, else append.
    const logIdx = this.#blocks.findIndex((b) => b.kind === 'log');
    const notesIdx = this.#blocks.findIndex((b) => b.kind === 'raw' && b.heading?.toLowerCase() === 'notes');
    const at = logIdx >= 0 ? logIdx : notesIdx >= 0 ? notesIdx : this.#blocks.length;
    this.#blocks.splice(at, 0, block);
    this.#tasksBlock = block;
    return block;
  }

  #resolveTaskIndex(ref: number | string): number {
    if (typeof ref === 'number') return ref;
    return this.#tasks.findIndex((t) => t.text === ref);
  }

  setTasks(tasks: BlipTask[]): this {
    this.#assertWritable();
    this.#tasks = tasks.map((t) => ({ text: singleLine(t.text), done: !!t.done }));
    this.#ensureTasksBlock().dirty = true;
    return this;
  }

  addTask(text: string, done = false): this {
    this.#assertWritable();
    this.#tasks.push({ text: singleLine(text), done });
    this.#ensureTasksBlock().dirty = true;
    return this;
  }

  setTaskDone(ref: number | string, done: boolean): this {
    this.#assertWritable();
    const i = this.#resolveTaskIndex(ref);
    const t = this.#tasks[i];
    if (!t) throw new Error(`No task matching ${JSON.stringify(ref)}`);
    t.done = done;
    this.#ensureTasksBlock().dirty = true;
    return this;
  }

  toggleTask(ref: number | string): this {
    const i = this.#resolveTaskIndex(ref);
    const t = this.#tasks[i];
    if (!t) throw new Error(`No task matching ${JSON.stringify(ref)}`);
    return this.setTaskDone(i, !t.done);
  }

  editTask(ref: number | string, newText: string): this {
    this.#assertWritable();
    const i = this.#resolveTaskIndex(ref);
    const t = this.#tasks[i];
    if (!t) throw new Error(`No task matching ${JSON.stringify(ref)}`);
    t.text = singleLine(newText);
    this.#ensureTasksBlock().dirty = true;
    return this;
  }

  removeTask(ref: number | string): this {
    this.#assertWritable();
    const i = this.#resolveTaskIndex(ref);
    if (i < 0 || i >= this.#tasks.length) throw new Error(`No task matching ${JSON.stringify(ref)}`);
    this.#tasks.splice(i, 1);
    this.#ensureTasksBlock().dirty = true;
    return this;
  }

  // ---- session log ----

  /** Append a dated session-log entry (never rewrites prior entries) and stamp last_session. */
  appendSession(entry: SessionEntry): this {
    this.#assertWritable();
    const date = entry.date === undefined ? todayLocal() : normalizeSessionDate(entry.date);
    // A blank/whitespace author would render a dangling `## date — ` — fall back to the OS user.
    // Author is also single-line: an embedded newline in any of these would smuggle a heading
    // into the log block and hijack section parsing on the next read.
    const author = singleLine(entry.author?.trim() || detectAuthor());
    const eol = this.#eol;
    const body = entry.lines.map((l) => `- ${singleLine(l)}`).join(eol);
    const block = `## ${date} — ${author}${eol}${body}`;

    if (this.#logBlock) {
      const base = this.#logBlock.text.replace(/[ \t\r\n]+$/, '');
      this.#logBlock.text = `${base}${eol}${eol}${block}${eol}${eol}`;
    } else {
      const newBlock: Extract<Block, { kind: 'log' }> = {
        kind: 'log',
        heading: 'Session log',
        text: `# Session log${eol}${eol}${block}${eol}${eol}`,
      };
      const notesIdx = this.#blocks.findIndex((b) => b.kind === 'raw' && b.heading?.toLowerCase() === 'notes');
      const at = notesIdx >= 0 ? notesIdx : this.#blocks.length;
      this.#blocks.splice(at, 0, newBlock);
      this.#logBlock = newBlock;
    }

    this.setField('last_session', new Date().toISOString());
    return this;
  }

  // ---- serialize ----

  #renderTasks(b: Extract<Block, { kind: 'tasks' }>): string {
    const eol = this.#eol;
    const render = (t: BlipTask): string => `- [${t.done ? 'x' : ' '}] ${t.text}`;

    // A net-new section (created by #ensureTasksBlock) has no original text to preserve.
    if (!b.original) {
      let s = `# ${b.heading}${eol}`;
      if (b.comment) s += `${b.comment}${eol}`;
      for (const t of this.#tasks) s += `${render(t)}${eol}`;
      s += eol; // trailing blank line so the next section is separated
      return s;
    }

    // Rebuild from the ORIGINAL section text: only checklist lines are rewritten — every
    // other line (sub-bullets, prose, code examples, blanks) round-trips verbatim. Each
    // surviving task overwrites the line it was parsed from, a removed task drops its
    // line, and net-new tasks are appended after the last checklist line (or after the
    // heading + lead comment when the section never had one).
    const byLine = new Map<number, BlipTask>();
    const added: BlipTask[] = [];
    for (const t of this.#tasks) {
      const line = this.#taskLines.get(t);
      if (line !== undefined) byLine.set(line, t);
      else added.push(t);
    }

    const endsWithEol = /\r?\n$/.test(b.original);
    const lines = b.original.split(/\r?\n/);
    if (endsWithEol) lines.pop();

    const out: string[] = [];
    const inFence = makeFenceTracker();
    let lastTaskAt = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!inFence(line) && TASK_LINE_RE.test(line)) {
        const t = byLine.get(i);
        if (t) {
          out.push(render(t));
          lastTaskAt = out.length - 1;
        }
        // No surviving task for this checklist line → it was removed.
      } else {
        out.push(line);
      }
    }

    if (added.length) {
      const at = lastTaskAt >= 0 ? lastTaskAt + 1 : taskInsertionPoint(lines);
      out.splice(at, 0, ...added.map(render));
    }

    return out.join(eol) + (endsWithEol ? eol : '');
  }

  toString(): string {
    const eol = this.#eol;
    let fm: string | null = null;
    if (this.#fmDirty) {
      fm = this.#ensureDoc().toString({ lineWidth: 0 }).replace(/\n+$/, '');
    } else if (this.#fmRaw !== null) {
      fm = this.#fmRaw.replace(/\r?\n$/, '');
    }

    let out = this.#hadBom ? '\uFEFF' : '';
    if (fm !== null) {
      const fmJoined = fm.split(/\r?\n/).join(eol);
      out += `---${eol}${fmJoined}${eol}---${eol}`;
    }
    for (const b of this.#blocks) {
      if (b.kind === 'raw' || b.kind === 'log') out += b.text;
      else out += b.dirty ? this.#renderTasks(b) : b.original;
    }
    return out;
  }
}
