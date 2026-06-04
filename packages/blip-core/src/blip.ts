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
} from './types.js';
import { detectAuthor } from './identity.js';

/** Leading-frontmatter matcher. Anchored to start; lazy body so a stray `---` in a value is tolerated. */
const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const TASK_LINE_RE = /^[ \t]*- \[([ xX])\][ \t]+(.*)$/;
const LEAD_COMMENT_RE = /^\s*<!--[\s\S]*?-->/;

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
  const blocks: { heading: string | null; text: string }[] = [];
  const matches = [...body.matchAll(/^# (.+?)[ \t]*$/gm)];
  if (matches.length === 0) {
    if (body.length) blocks.push({ heading: null, text: body });
    return blocks;
  }
  const firstIdx = matches[0]!.index!;
  if (firstIdx > 0) blocks.push({ heading: null, text: body.slice(0, firstIdx) });
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : body.length;
    blocks.push({ heading: m[1]!.trim(), text: body.slice(start, end) });
  }
  return blocks;
}

function parseTasksSection(text: string): { comment: string; tasks: BlipTask[] } {
  const nl = text.indexOf('\n');
  const afterHeading = nl >= 0 ? text.slice(nl + 1) : '';
  const cm = LEAD_COMMENT_RE.exec(afterHeading);
  const comment = cm ? cm[0].trim() : '';
  const tasks: BlipTask[] = [];
  for (const line of afterHeading.split(/\r?\n/)) {
    const tm = TASK_LINE_RE.exec(line);
    if (tm) tasks.push({ done: tm[1]!.toLowerCase() === 'x', text: tm[2]!.trimEnd() });
  }
  return { comment, tasks };
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
  #doc: Document | null = null;
  #fmDirty = false;
  #blocks: Block[];
  #tasks: BlipTask[];
  #tasksBlock: Extract<Block, { kind: 'tasks' }> | null;
  #logBlock: Extract<Block, { kind: 'log' }> | null;

  private constructor(state: {
    hadBom: boolean;
    eol: '\n' | '\r\n';
    fmRaw: string | null;
    fmValues: Record<string, unknown>;
    blocks: Block[];
    tasks: BlipTask[];
    tasksBlock: Extract<Block, { kind: 'tasks' }> | null;
    logBlock: Extract<Block, { kind: 'log' }> | null;
  }) {
    this.#hadBom = state.hadBom;
    this.#eol = state.eol;
    this.#fmRaw = state.fmRaw;
    this.#fmValues = state.fmValues;
    this.#blocks = state.blocks;
    this.#tasks = state.tasks;
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
    if (fmRaw !== null) {
      try {
        const js = parseDocument(fmRaw).toJS();
        if (js && typeof js === 'object') fmValues = js as Record<string, unknown>;
      } catch {
        // Malformed YAML: keep empty values but preserve raw text so we never destroy it.
        fmValues = {};
      }
    }

    const blocks: Block[] = [];
    let tasks: BlipTask[] = [];
    let tasksBlock: Extract<Block, { kind: 'tasks' }> | null = null;
    let logBlock: Extract<Block, { kind: 'log' }> | null = null;

    for (const seg of splitBody(body)) {
      const key = seg.heading?.toLowerCase();
      if (key === 'tasks' && !tasksBlock) {
        const parsed = parseTasksSection(seg.text);
        tasks = parsed.tasks;
        tasksBlock = { kind: 'tasks', heading: seg.heading!, comment: parsed.comment, original: seg.text, dirty: false };
        blocks.push(tasksBlock);
      } else if (key === 'session log' && !logBlock) {
        logBlock = { kind: 'log', heading: seg.heading!, text: seg.text };
        blocks.push(logBlock);
      } else {
        blocks.push({ kind: 'raw', heading: seg.heading, text: seg.text });
      }
    }

    return new Blip({ hadBom, eol, fmRaw, fmValues, blocks, tasks, tasksBlock, logBlock });
  }

  // ---- reading ----

  get fields(): BlipFields {
    const v = this.#fmValues;
    const out: BlipFields = {
      horizon: coerceHorizon(v.horizon),
      priority: coercePriority(v.priority),
      category: typeof v.category === 'string' ? v.category : DEFAULTS.category,
      status: coerceStatus(v.status),
    };
    if (typeof v.name === 'string') out.name = v.name;
    if (typeof v.next_action === 'string') out.next_action = v.next_action;
    if (typeof v.deadline === 'string') out.deadline = v.deadline;
    const angle = coerceAngle(v.radar_angle);
    if (angle !== undefined) out.radar_angle = angle;
    if (typeof v.operation === 'string') out.operation = v.operation;
    if (typeof v.created === 'string') out.created = v.created;
    if (typeof v.last_session === 'string') out.last_session = v.last_session;
    if (Array.isArray(v.tags)) out.tags = v.tags as string[];
    if (Array.isArray(v.links)) out.links = v.links;
    return out;
  }

  get tasks(): readonly BlipTask[] {
    return this.#tasks;
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

  #ensureDoc(): Document {
    if (!this.#doc) this.#doc = parseDocument(this.#fmRaw ?? '');
    return this.#doc;
  }

  setField(key: string, value: unknown): this {
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
    this.#tasks = tasks.map((t) => ({ text: t.text, done: !!t.done }));
    this.#ensureTasksBlock().dirty = true;
    return this;
  }

  addTask(text: string, done = false): this {
    this.#tasks.push({ text, done });
    this.#ensureTasksBlock().dirty = true;
    return this;
  }

  setTaskDone(ref: number | string, done: boolean): this {
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
    const i = this.#resolveTaskIndex(ref);
    const t = this.#tasks[i];
    if (!t) throw new Error(`No task matching ${JSON.stringify(ref)}`);
    t.text = newText;
    this.#ensureTasksBlock().dirty = true;
    return this;
  }

  removeTask(ref: number | string): this {
    const i = this.#resolveTaskIndex(ref);
    if (i < 0 || i >= this.#tasks.length) throw new Error(`No task matching ${JSON.stringify(ref)}`);
    this.#tasks.splice(i, 1);
    this.#ensureTasksBlock().dirty = true;
    return this;
  }

  // ---- session log ----

  /** Append a dated session-log entry (never rewrites prior entries) and stamp last_session. */
  appendSession(entry: SessionEntry): this {
    const date = entry.date ?? todayLocal();
    const author = entry.author ?? detectAuthor();
    const eol = this.#eol;
    const body = entry.lines.map((l) => `- ${l}`).join(eol);
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
    let s = `# ${b.heading}${eol}`;
    if (b.comment) s += `${b.comment}${eol}`;
    for (const t of this.#tasks) s += `- [${t.done ? 'x' : ' '}] ${t.text}${eol}`;
    s += eol; // trailing blank line so the next section is separated
    return s;
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
