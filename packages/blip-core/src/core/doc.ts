import { localDate, localTime } from './dates.js';
import { cleanLine, readFields, readFrontmatter, schemaOf, slugTags, splitFrontmatter, writeFrontmatter } from './frontmatter.js';
import { lint, openFenceLine } from './lint.js';
import { insertEntry, lastLogAt, makeEntry, parseLogSection, rawEntries, sortNewestFirst, viewEntry, type LogSection } from './log.js';
import { BlipError, fold, makeFenceTracker, type BlipDoc, type ManagedKey } from './schema.js';
import {
  doneBlocks,
  emptyTaskSection,
  indentDetail,
  makeBlock,
  openBlocks,
  parseTaskSection,
  parseTitleText,
  renderBlock,
  renderTaskSection,
  sameLegacyTask,
  settle,
  taskViews,
  type TaskBlock,
  type TaskSection,
} from './tasks.js';

/**
 * One top-level piece of the body. A section the engine does not manage — and any text
 * before the first heading — is `raw` and is written back byte for byte. A managed section
 * keeps its original text too, and is re-serialised only once something in it has changed.
 */
export type Section =
  | { kind: 'raw'; heading: string | null; text: string; line: number }
  | { kind: 'tasks'; text: string; line: number | null; model: TaskSection; dirty: boolean; created: boolean }
  | { kind: 'log'; text: string; line: number | null; model: LogSection; dirty: boolean; created: boolean };

/** Everything a parsed file holds. Internal to the engine's core; not part of the public surface. */
export interface FileState {
  bom: boolean;
  eol: '\n' | '\r\n';
  /** The frontmatter block as it is in the file, delimiters included; null when there is none. */
  fmBlock: string | null;
  /** The YAML between the delimiters. */
  fmRaw: string | null;
  fmDirty: boolean;
  values: Record<string, unknown>;
  fmError: { message: string; line: number | null } | null;
  sections: Section[];
}

export interface ParseContext {
  /** Basename of the project folder: the name shown when the file has none. */
  dirName: string;
  /** The file's modification time; clamps the instant of a date-only log entry. */
  mtime?: Date;
}

/** Split the body on column-0 `# ` headings outside code fences. Offsets index `body`. */
function splitBody(body: string): { heading: string | null; text: string; index: number }[] {
  const starts: { index: number; heading: string }[] = [];
  const inFence = makeFenceTracker();
  let pos = 0;
  while (pos <= body.length) {
    const nl = body.indexOf('\n', pos);
    const end = nl === -1 ? body.length : nl;
    let line = body.slice(pos, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!inFence(line)) {
      // No pattern here: `(.+?)[ \t]*$` is quadratic on a long run of spaces in the line.
      if (line.startsWith('# ') && line.length > 2) starts.push({ index: pos, heading: line.slice(2).trim() });
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  const out: { heading: string | null; text: string; index: number }[] = [];
  const first = starts[0]?.index ?? body.length;
  if (first > 0) out.push({ heading: null, text: body.slice(0, first), index: 0 });
  starts.forEach((s, i) => {
    out.push({ heading: s.heading, text: body.slice(s.index, starts[i + 1]?.index ?? body.length), index: s.index });
  });
  return out;
}

function countLines(s: string): number {
  let n = 0;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

/** A section's lines without the final line terminator. */
function sectionLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const READ_ONLY = {
  E_UNWRITABLE: { message: 'the frontmatter is not valid YAML', hint: 'fix the lines between the two "---" markers by hand; "radar-blip lint" shows where' },
  E_NEWER_SCHEMA: { message: 'this file was written by a newer version of RADAR', hint: 'update radar-blip' },
  E_NEEDS_MIGRATE: { message: 'this file is in the v2 format', hint: 'this file is in the v2 format — the owner runs "radar-blip migrate" once' },
} as const;
export type ReadOnlyCode = keyof typeof READ_ONLY;

/** Parse a BLIP.md. Never throws: whatever a person or an old tool wrote is read without loss. */
export function parseBlip(text: string, ctx: ParseContext): BlipFile {
  const bom = text.charCodeAt(0) === 0xfeff;
  const s = bom ? text.slice(1) : text;
  const eol: '\n' | '\r\n' = s.includes('\r\n') ? '\r\n' : '\n';
  const fm = splitFrontmatter(s);
  const read = readFrontmatter(fm.raw);
  const values = read.values;
  // `line` counts from the line after the opening `---`, so 0 is the opening line itself.
  const error = fm.unclosed ? { message: 'the closing --- is missing', line: 0 } : read.error;

  const bodyLine = 1 + countLines(fm.block ?? '');
  const sections: Section[] = [];
  let haveTasks = false;
  let haveLog = false;
  for (const seg of splitBody(fm.body)) {
    const line = bodyLine + countLines(fm.body.slice(0, seg.index));
    const key = seg.heading?.toLowerCase();
    if (key === 'tasks' && !haveTasks) {
      haveTasks = true;
      sections.push({ kind: 'tasks', text: seg.text, line, model: parseTaskSection(sectionLines(seg.text), line), dirty: false, created: false });
    } else if ((key === 'session log' || key === 'log') && !haveLog) {
      haveLog = true;
      sections.push({ kind: 'log', text: seg.text, line, model: parseLogSection(sectionLines(seg.text), line), dirty: false, created: false });
    } else {
      sections.push({ kind: 'raw', heading: seg.heading, text: seg.text, line });
    }
  }
  return new BlipFile({ bom, eol, fmBlock: fm.block, fmRaw: fm.raw, fmDirty: false, values, fmError: error, sections }, ctx);
}

export class BlipFile {
  /** @internal The parsed parts. Only the engine's own core modules touch this. */
  readonly state: FileState;
  readonly ctx: ParseContext;

  constructor(state: FileState, ctx: ParseContext) {
    this.state = state;
    this.ctx = ctx;
  }

  /** What is on disk: 2 when the file has no `blip` key. */
  get schema(): 2 | 3 {
    return schemaOf(this.state.values) === 2 ? 2 : 3;
  }

  /** Why the engine will not write this file, or null when it will. */
  get readOnly(): ReadOnlyCode | null {
    if (this.state.fmError) return 'E_UNWRITABLE';
    const schema = schemaOf(this.state.values);
    return schema === 'newer' ? 'E_NEWER_SCHEMA' : schema === 2 ? 'E_NEEDS_MIGRATE' : null;
  }

  get writable(): boolean {
    return this.readOnly === null;
  }

  get tasksSection(): TaskSection | null {
    for (const s of this.state.sections) if (s.kind === 'tasks') return s.model;
    return null;
  }

  get logSection(): LogSection | null {
    for (const s of this.state.sections) if (s.kind === 'log') return s.model;
    return null;
  }

  /** Open task blocks in read-model order: `openTasks()[i]` is `doc().tasks.open[i]` in a writable file. */
  openTasks(): TaskBlock[] {
    return this.tasksSection ? openBlocks(this.tasksSection) : [];
  }

  /** Done task blocks in read-model order. */
  doneTasks(): TaskBlock[] {
    return this.tasksSection ? doneBlocks(this.tasksSection) : [];
  }

  /** @internal The read model without `problems` (lint builds on this). */
  model(): Omit<BlipDoc, 'problems'> {
    const schema = this.schema;
    const fields = readFields(this.state.values, schema);

    const open = this.openTasks();
    const done = this.doneTasks();
    if (schema === 2) {
      // A v2 `next_action` is the next step unless the checklist already says so.
      const text = cleanLine(this.state.values.next_action) ?? '';
      if (text && ![...open, ...done].some((b) => sameLegacyTask(b.title, text))) {
        open.unshift({ checked: false, ...parseTitleText(text), children: [], line: null });
      }
    }
    const openViews = taskViews(open, true);

    const raw = this.logSection ? rawEntries(this.logSection) : [];
    const entries = schema === 2 ? sortNewestFirst(raw).entries : raw;

    return {
      schema,
      name: fields.name ?? this.ctx.dirName,
      nameSource: fields.name === null ? 'folder' : 'file',
      now: fields.now,
      status: fields.status,
      focus: fields.focus,
      due: fields.due,
      tags: fields.tags,
      links: fields.links,
      tasks: { open: openViews, done: taskViews(done, false) },
      next: openViews[0] ?? null,
      log: entries.map(viewEntry),
      lastLogAt: lastLogAt(raw, this.ctx.mtime),
      writable: this.writable,
    };
  }

  doc(): BlipDoc {
    return { ...this.model(), problems: lint(this) };
  }

  toString(): string {
    const st = this.state;
    const eol = st.eol;
    let out = '';
    if (st.fmDirty) out += `---${eol}${st.fmRaw ? st.fmRaw.split(/\r?\n/).join(eol) + eol : ''}---${eol}`;
    else out += st.fmBlock ?? '';

    st.sections.forEach((sec, i) => {
      if (sec.kind === 'raw' || !sec.dirty) {
        out += sec.text;
        return;
      }
      if (sec.created && out.length) {
        // A new section needs a line break and a blank line above it; nothing else is added to existing text.
        if (!out.endsWith('\n')) out += eol;
        if (!/\n\r?\n$/.test(out)) out += eol;
      }
      const lines = sec.kind === 'tasks' ? renderTaskSection(sec.model) : sec.model.lines;
      out += lines.join(eol) + eol + (i === st.sections.length - 1 ? '' : eol);
    });
    return (st.bom ? '\uFEFF' : '') + out;
  }

  /**
   * Start changing the file. Throws when the file is read-only (broken YAML, a newer
   * schema, or a v2 file), so no edit can ever change the bytes of such a file.
   */
  edit(ctx: { now: Date }): BlipEditor {
    return new BlipEditor(this, ctx.now);
  }
}

/** Undo for everything a task or log edit can touch. Blocks are restored in place: callers hold references to them. */
function snapshot(st: FileState): () => void {
  const sections = [...st.sections];
  const undo = sections.map((sec) => {
    if (sec.kind === 'raw') return () => {};
    const dirty = sec.dirty;
    if (sec.kind === 'log') {
      const lines = [...sec.model.lines];
      return () => {
        sec.model.lines = lines;
        sec.dirty = dirty;
      };
    }
    const model = { ...sec.model, preamble: [...sec.model.preamble], queue: [...sec.model.queue], donePreamble: [...sec.model.donePreamble], done: [...sec.model.done] };
    const blocks = [...model.queue, ...model.done].map((block) => ({ block, was: { ...block, children: [...block.children] } }));
    return () => {
      Object.assign(sec.model, model);
      for (const { block, was } of blocks) Object.assign(block, was);
      sec.dirty = dirty;
    };
  });
  return () => {
    st.sections = sections;
    for (const u of undo) u();
  };
}

/**
 * Would the file, written out now, be read back as the tasks and log entries the model
 * holds? It would not when text ends up inside a code fence nobody closed, or when a line
 * under a task is read as the `## Done` heading once its task has moved above the real one.
 * Titles are not compared: only what belongs to what.
 */
export function readsBack(file: BlipFile): boolean {
  const st = file.state;
  if (!st.sections.some((s) => s.kind !== 'raw' && s.dirty)) return true;
  // Text before the first heading is one section on a read however many pieces hold it here.
  const headed = (list: Section[]): Section[] => list.filter((s) => s.kind !== 'raw' || s.heading !== null);
  const blocks = (list: TaskBlock[]): string => JSON.stringify(list.map((b) => [b.checked, b.children]));
  const mine = headed(st.sections);
  const theirs = headed(parseBlip(file.toString(), file.ctx).state.sections);
  return (
    mine.length === theirs.length &&
    mine.every((a, i) => {
      const b = theirs[i]!;
      if (a.kind === 'raw') return b.kind === 'raw' && b.heading === a.heading;
      if (a.kind === 'tasks') return b.kind === 'tasks' && blocks(a.model.queue) === blocks(b.model.queue) && blocks(a.model.done) === blocks(b.model.done);
      return b.kind === 'log' && JSON.stringify(rawEntries(a.model).map((e) => e.lines)) === JSON.stringify(rawEntries(b.model).map((e) => e.lines));
    })
  );
}

/**
 * Write frontmatter changes into the state: keys set, or removed with `undefined`. Refused,
 * with the state untouched, when the result would not be valid YAML — taking away a key
 * whose anchor another key points at does that.
 */
export function applyFrontmatter(st: FileState, changes: Record<string, unknown>): void {
  let raw: string | null = null;
  try {
    raw = writeFrontmatter(st.fmRaw, changes);
  } catch {
    // the YAML library could not write it: refused below
  }
  const read = raw === null ? null : readFrontmatter(raw);
  if (raw === null || !read || read.error) {
    throw new BlipError('E_UNWRITABLE', 'the frontmatter cannot be rewritten without breaking it', {
      hint: 'one key refers to another with a YAML anchor (&name / *name); write the value out in full by hand',
    });
  }
  st.fmRaw = raw;
  st.values = read.values;
  st.fmDirty = true;
}

/** The `# Tasks` section, created when the file has none: immediately before the log, or at the end when there is no log. */
export function ensureTasksSection(st: FileState): Extract<Section, { kind: 'tasks' }> {
  let entry = st.sections.find((s): s is Extract<Section, { kind: 'tasks' }> => s.kind === 'tasks');
  if (!entry) {
    entry = { kind: 'tasks', text: '', line: null, model: emptyTaskSection(), dirty: true, created: true };
    const logAt = st.sections.findIndex((s) => s.kind === 'log');
    st.sections.splice(logAt >= 0 ? logAt : st.sections.length, 0, entry);
  }
  return entry;
}

export type EditableField = Exclude<ManagedKey, 'blip'>;

/**
 * The low-level mutations. Tasks are referred to by their block (from `openTasks()` /
 * `doneTasks()`), so a change always lands on the task it was aimed at. These do not
 * validate lengths or style; the edit layer above does that.
 *
 * The first change to the task list also puts right what a hand edit left out of place:
 * ticked boxes still in the queue and unticked boxes under `## Done` (`corrections`).
 */
export class BlipEditor {
  corrections = { doneInQueue: 0, openInDone: 0 };
  #file: BlipFile;
  #state: FileState;
  #now: Date;
  #settled = false;

  /** The read-only gate is here, not in `file.edit()`, so that no way of getting an editor goes round it. */
  constructor(file: BlipFile, now: Date) {
    const code = file.readOnly;
    if (code) throw new BlipError(code, READ_ONLY[code].message, { hint: READ_ONLY[code].hint });
    this.#file = file;
    this.#state = file.state;
    this.#now = now;
  }

  /**
   * Run one task or log edit whole or not at all. Whatever it throws, the model is as it
   * was. An edit that goes through but leaves a file that would not be read back as the
   * model says is undone and refused too: writing it would hide tasks or log entries.
   */
  #change<T>(edit: () => T): T {
    const undo = snapshot(this.#state);
    const settled = this.#settled;
    const corrections = this.corrections;
    try {
      const result = edit();
      if (!readsBack(this.#file)) throw new BlipError('E_UNWRITABLE', 'this change would not be read back from the file the way it was made');
      return result;
    } catch (err) {
      undo();
      this.#settled = settled;
      this.corrections = corrections;
      if (err instanceof BlipError && err.code === 'E_UNWRITABLE') {
        const line = openFenceLine(this.#file);
        err.hint =
          line === null
            ? 'a line in it would open a code fence that is never closed, or would be read as the "## Done" heading; change that line'
            : `the code fence opened on line ${line} is never closed, and what was to be written would land inside it; close the fence by hand`;
      }
      throw err;
    }
  }

  #tasksEntry(): Extract<Section, { kind: 'tasks' }> {
    const entry = ensureTasksSection(this.#state);
    if (!this.#settled) {
      this.#settled = true;
      this.corrections = settle(entry.model, localDate(this.#now));
      if (this.corrections.doneInQueue || this.corrections.openInDone) entry.dirty = true;
    }
    return entry;
  }

  /**
   * Put out-of-place tasks right without any other change. Every task edit does this
   * itself; a write that only touches the header or the log calls it, so that any write
   * to the file corrects the list. Creates nothing when the file has no task list.
   * True when something moved.
   */
  tidy(): boolean {
    if (!this.#state.sections.some((s) => s.kind === 'tasks')) return false;
    return this.#change(() => {
      this.#tasksEntry();
      return this.corrections.doneInQueue + this.corrections.openInDone > 0;
    });
  }

  /** Add an open task before another open task, or at the end of the queue. */
  addTask(input: { title: string; detail?: readonly string[]; due?: string | null }, before: TaskBlock | null = null): TaskBlock {
    return this.#change(() => {
      const entry = this.#tasksEntry();
      const block = makeBlock(input);
      entry.model.queue.splice(this.#slot(entry.model, before), 0, block);
      entry.dirty = true;
      return block;
    });
  }

  /** Move an open task before another open task, or to the end. False when it is already there. */
  moveTask(block: TaskBlock, before: TaskBlock | null): boolean {
    return this.#change(() => {
      const entry = this.#tasksEntry();
      const queue = entry.model.queue;
      const from = queue.indexOf(block);
      if (from < 0) throw new Error('moveTask: not an open task in this file');
      if (before === block || (queue[from + 1] ?? null) === before) return false;
      queue.splice(from, 1);
      queue.splice(this.#slot(entry.model, before), 0, block);
      entry.dirty = true;
      return true;
    });
  }

  /** Remove a task with everything under it. Returns the removed block as text, for the caller to keep a copy. */
  removeTask(block: TaskBlock): string {
    return this.#change(() => {
      const entry = this.#tasksEntry();
      const list = entry.model.queue.includes(block) ? entry.model.queue : entry.model.done;
      const at = list.indexOf(block);
      if (at < 0) throw new Error('removeTask: not a task in this file');
      list.splice(at, 1);
      entry.dirty = true;
      return renderBlock(block).join(this.#state.eol);
    });
  }

  /** Tick a task: it moves to the top of `## Done`, stamped with today, its due tail dropped. False when already done. */
  completeTask(block: TaskBlock): boolean {
    if (block.checked) return false;
    return this.#change(() => {
      const entry = this.#tasksEntry();
      const at = entry.model.queue.indexOf(block);
      if (at < 0) throw new Error('completeTask: not a task in this file');
      entry.model.queue.splice(at, 1);
      block.checked = true;
      block.due = null;
      block.doneOn = localDate(this.#now);
      entry.model.done.unshift(block);
      entry.dirty = true;
      return true;
    });
  }

  /** Untick a task: it returns to the end of the queue. False when already open. */
  reopenTask(block: TaskBlock): boolean {
    if (!block.checked) return false;
    return this.#change(() => {
      const entry = this.#tasksEntry();
      const at = entry.model.done.indexOf(block);
      if (at < 0) throw new Error('reopenTask: not a task in this file');
      entry.model.done.splice(at, 1);
      block.checked = false;
      block.doneOn = null;
      entry.model.queue.push(block);
      entry.dirty = true;
      return true;
    });
  }

  /**
   * Change a task's title, due date or detail. Supplying `detail` replaces every line under
   * the title; when there was any, the block as it was is returned so a copy can be kept.
   * A patch that changes no value rewrites nothing.
   */
  editTask(block: TaskBlock, patch: { title?: string; due?: string | null; detail?: readonly string[] }): string | null {
    return this.#change(() => {
      const entry = this.#tasksEntry();
      if (!entry.model.queue.includes(block) && !entry.model.done.includes(block)) throw new Error('editTask: not a task in this file');
      const before = renderBlock(block).join(this.#state.eol);
      const replaced = patch.detail !== undefined && block.children.length > 0;
      if (patch.title !== undefined) block.title = fold(patch.title);
      if (patch.due !== undefined) block.due = patch.due;
      if (patch.detail !== undefined) block.children = indentDetail(patch.detail);
      if (renderBlock(block).join(this.#state.eol) === before) return null;
      entry.dirty = true;
      return replaced ? before : null;
    });
  }

  /**
   * Set a frontmatter field, or remove it with `null`. `focus` is stored only as `true`;
   * tags are slugged. False when the file already says so (nothing is re-serialised).
   */
  setField(key: EditableField, value: unknown): boolean {
    const st = this.#state;
    let next: unknown = value ?? undefined;
    if (key === 'name' || key === 'now') next = typeof value === 'string' && fold(value) ? fold(value) : undefined;
    if (key === 'focus') next = value === true ? true : undefined;
    if (key === 'tags') next = slugTags(value).length ? slugTags(value) : undefined;
    if (key === 'links') next = Array.isArray(value) && value.length ? value : undefined;
    if (JSON.stringify(st.values[key]) === JSON.stringify(next)) return false;
    applyFrontmatter(st, { [key]: next });
    return true;
  }

  /** Add a log entry directly under the section heading, timed by the engine's clock in local time. */
  addLogEntry(input: { author: string; bullets: readonly string[] }): void {
    this.#change(() => {
      const st = this.#state;
      let entry = st.sections.find((s): s is Extract<Section, { kind: 'log' }> => s.kind === 'log');
      if (!entry) {
        entry = { kind: 'log', text: '', line: null, model: { lines: ['# Session log'], firstLine: null }, dirty: true, created: true };
        st.sections.push(entry);
      }
      insertEntry(entry.model, makeEntry({ date: localDate(this.#now), time: localTime(this.#now), author: input.author, bullets: input.bullets }));
      entry.dirty = true;
    });
  }

  #slot(sec: TaskSection, before: TaskBlock | null): number {
    if (before === null) return sec.queue.length;
    const at = sec.queue.indexOf(before);
    if (at < 0) throw new Error('"before" is not an open task in this file');
    return at;
  }
}
