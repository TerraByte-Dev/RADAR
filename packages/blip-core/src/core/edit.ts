import { parseIsoDate } from './dates.js';
import { parseBlip, type BlipEditor, type BlipFile } from './doc.js';
import { hasLabel, isShouting, isSlugName } from './lint.js';
import { rawEntries, viewEntry } from './log.js';
import { BlipError, CAPS, LINK_SCHEMES, STATUSES, collapse, fold, measure, type Violation } from './schema.js';
import { hasSecret } from './secrets.js';
import { normalizeTitle, parseTitleText, type TaskBlock } from './tasks.js';

/** A task named by its title: an exact match after normalisation. An op never carries a position. */
export type TaskRef = { title: string };

/** The one mutation vocabulary. Sync payloads, the CLI shorthands and the app all compile to it. */
export type EditOp =
  | { op: 'task.add'; title: string; detail?: string[]; due?: string; before?: TaskRef | null }
  | { op: 'task.done'; task: TaskRef }
  | { op: 'task.reopen'; task: TaskRef }
  | { op: 'task.remove'; task: TaskRef }
  | { op: 'task.edit'; task: TaskRef; title?: string; detail?: string[]; due?: string | null }
  | { op: 'task.move'; task: TaskRef; before: TaskRef | null }
  | { op: 'set'; field: 'name' | 'now' | 'status' | 'focus' | 'due' | 'tags' | 'links'; value: unknown }
  | { op: 'log.add'; bullets: string[]; agent?: string };

export interface EditCtx {
  actor: 'human' | 'agent';
  /** The engine's clock: stamps completed tasks and new log entries. */
  now: Date;
  /** Who is writing: the git user name or the OS user. */
  author: string;
}

export interface ReportLine {
  kind: 'done' | 'reopened' | 'added' | 'edited' | 'moved' | 'removed' | 'set' | 'logged' | 'skipped' | 'tidied' | 'warn';
  text: string;
  /** For `warn`: the warning's code (`now-style`, `title-label`, …). */
  code?: string;
  /** For `added` and `moved`: the task is now the first in the queue. */
  top?: true;
  /** For `edited`: the task's old detail was replaced, and a copy of it kept in the trash. */
  kept?: true;
}

/** A block that left the file, for the trash: nothing is deleted without a copy. */
export interface RemovedBlock {
  reason: 'removed' | 'detail replaced';
  text: string;
}

export interface EditResult {
  changed: boolean;
  report: ReportLine[];
  removed: RemovedBlock[];
}

// ---- writing rules (spec section 4): one implementation, used by edits and by sync payloads ----

/**
 * One broken rule. `message` completes the sentence "<field> …". `warn` is set on the
 * style rules: an agent's write is rejected for them, a person's goes through with that
 * warning. `at` narrows the field (`[2]` for one line of a list).
 */
export interface Finding {
  code: string;
  message: string;
  warn?: string;
  at?: string;
}

const LINE_BREAK_RE = /[\r\n\v\f\u0085\u2028\u2029]/;
const VAGUE_NOW_RE = /^(?:wip|in progress|working on|ongoing|continuing|tbd|todo|n\/a|none|see)\b/i;
const AUTHOR_MAX = 40;

/** A title as it is stored: one line, without a closing full stop. */
export function cleanTitle(raw: string): string {
  return fold(raw).replace(/(?<!\.)\.$/, '');
}

export function checkTitle(raw: string): Finding[] {
  const out: Finding[] = [];
  const title = cleanTitle(raw);
  const len = measure(title);
  if (LINE_BREAK_RE.test(raw.trim())) out.push({ code: 'E_TITLE_STYLE', message: 'has a line break — a title is one line; the rest belongs in "detail"' });
  if (len < CAPS.TITLE_MIN) out.push({ code: 'E_TITLE_LENGTH', message: `is ${len} chars (min ${CAPS.TITLE_MIN})` });
  if (len > CAPS.TITLE_MAX) out.push({ code: 'E_TITLE_LENGTH', message: `is ${len} chars (max ${CAPS.TITLE_MAX}) — keep the action in the title and move the rest into "detail"` });
  if (/^(?:- |\[|#)/.test(title)) out.push({ code: 'E_TITLE_STYLE', message: 'starts with "- ", "[" or "#" — write the action as plain text' });
  // `[^()]*`, not `[^)]*`: the search must not start over at every "(due " of a long run of them.
  if (/\(due [^()]*\)/i.test(title)) out.push({ code: 'E_TITLE_STYLE', message: 'has "(due …)" in its text — a real date goes in "due", never in the title' });
  else if (parseTitleText(title).title !== title) {
    // Written as it is, the tail would be read back as the stamp and not as part of the title.
    out.push({ code: 'E_TITLE_STYLE', message: 'ends in "(done YYYY-MM-DD)" — the engine writes that stamp itself when the task is completed; leave it out' });
  }
  if (isShouting(title)) out.push({ code: 'E_TITLE_STYLE', warn: 'title-shouting', message: 'is all capitals — write it as a sentence' });
  if (hasLabel(title)) out.push({ code: 'E_TITLE_STYLE', warn: 'title-label', message: 'starts with an all-capitals label — drop the label; start with the verb' });
  return out;
}

export function checkDetail(lines: readonly string[]): Finding[] {
  const out: Finding[] = [];
  if (lines.length > CAPS.DETAIL_LINES_MAX) out.push({ code: 'E_DETAIL_SIZE', message: `has ${lines.length} lines (max ${CAPS.DETAIL_LINES_MAX})` });
  lines.forEach((line, i) => {
    const len = measure(line);
    if (len > CAPS.DETAIL_LINE_MAX) out.push({ code: 'E_DETAIL_SIZE', at: `[${i}]`, message: `is ${len} chars (max ${CAPS.DETAIL_LINE_MAX})` });
  });
  return out;
}

export function checkNow(raw: string): Finding[] {
  const out: Finding[] = [];
  const now = fold(raw);
  const len = measure(now);
  if (LINE_BREAK_RE.test(raw.trim())) out.push({ code: 'E_NOW_LENGTH', message: 'has a line break — the Now line is one sentence on one line' });
  if (len === 0) out.push({ code: 'E_NOW_LENGTH', message: 'is empty' });
  if (len > CAPS.NOW_MAX) out.push({ code: 'E_NOW_LENGTH', message: `is ${len} chars (max ${CAPS.NOW_MAX})` });
  if (/^(?:- |#|\[)/.test(now)) out.push({ code: 'E_NOW_STYLE', message: 'starts with "- ", "#" or "[" — write one plain sentence' });
  const letters = (now.match(/\p{L}/gu) ?? []).length;
  const upper = (now.match(/\p{Lu}/gu) ?? []).length;
  if (letters >= 12 && upper / letters >= 0.6) out.push({ code: 'E_NOW_STYLE', warn: 'now-style', message: 'is mostly capitals — write it as a sentence' });
  if (hasLabel(now)) out.push({ code: 'E_NOW_STYLE', warn: 'now-style', message: 'starts with an all-capitals label — say where the project stands in plain words' });
  return out;
}

/** A Now line that says nothing: a vague opener, or one that trails off. Worth a warning, never a rejection. */
export function isVagueNow(now: string): boolean {
  const s = fold(now);
  return VAGUE_NOW_RE.test(s) || /(?:…|\.\.\.)$/.test(s);
}

export function checkName(raw: string): Finding[] {
  const out: Finding[] = [];
  const name = fold(raw);
  const len = measure(name);
  if (len < CAPS.NAME_MIN) out.push({ code: 'E_NAME_LENGTH', message: `is ${len} chars (min ${CAPS.NAME_MIN})` });
  if (len > CAPS.NAME_MAX) out.push({ code: 'E_NAME_LENGTH', message: `is ${len} chars (max ${CAPS.NAME_MAX})` });
  if (/[\\/]/.test(name) || LINE_BREAK_RE.test(raw.trim())) out.push({ code: 'E_NAME_STYLE', message: 'has a slash or a line break — a name is what you would say out loud' });
  if (isSlugName(name)) out.push({ code: 'E_NAME_STYLE', warn: 'name-slug', message: 'looks like a folder name — write what you would call the project out loud ("Dungeon Dig", not "dungeon-dig")' });
  return out;
}

/** Log bullets as they are stored: one line each, list markers and checkboxes taken off, blanks dropped. `index` is the position in the input. */
export function cleanBullets(raw: readonly string[]): { text: string; index: number }[] {
  return raw
    .map((b, index) => ({ text: fold(b).replace(/^(?:[-*]\s+|#+\s*|\[[ xX]\]\s*)+/, ''), index }))
    .filter((b) => b.text !== '');
}

export function checkLog(raw: readonly string[]): Finding[] {
  const out: Finding[] = [];
  const bullets = cleanBullets(raw);
  if (bullets.length === 0) out.push({ code: 'E_LOG_SIZE', message: 'has no bullets — leave "log" out when there is nothing to log' });
  if (bullets.length > CAPS.LOG_BULLETS_MAX) {
    out.push({ code: 'E_LOG_SIZE', message: `has ${bullets.length} bullets (max ${CAPS.LOG_BULLETS_MAX}) — put the overflow in the detail of the task it concerns` });
  }
  for (const b of bullets) {
    const len = measure(b.text);
    if (len > CAPS.LOG_BULLET_MAX) out.push({ code: 'E_LOG_SIZE', at: `[${b.index}]`, message: `is ${len} chars (max ${CAPS.LOG_BULLET_MAX})` });
  }
  return out;
}

export function checkDue(value: unknown): Finding[] {
  return parseIsoDate(value) ? [] : [{ code: 'E_DATE', message: 'is not a real YYYY-MM-DD date' }];
}

export function checkSecret(value: string): Finding[] {
  return hasSecret(value) ? [{ code: 'E_SECRET', message: 'looks like it holds a password, key or token — leave the value out' }] : [];
}

/** A field's value as a report line shows it. */
function shown(value: unknown): string {
  if (value === null || value === undefined || value === false) return 'cleared';
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : 'cleared';
  return String(value);
}

/** Throw every violation at once: the top-level code is the single violation's own, or `many` when there are several. */
export function raise(violations: Violation[], many: string): void {
  if (violations.length === 0) return;
  const first = violations[0]!;
  if (violations.length === 1) throw new BlipError(first.code, first.message, { path: first.path, violations });
  throw new BlipError(many, `${violations.length} problems — nothing was written`, { violations });
}

/** Open titles with their numbers, for an error that has to show what there is to choose from. */
export function numberedList(titles: readonly string[]): string {
  return titles.length ? titles.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(no open tasks)';
}

const HUMAN_OWNED_HINT = 'only the owner changes this: radar-blip set <field> <value>';

/** The rules an op must pass before anything is touched. An agent's style slips are violations; a person's are warnings. */
function vet(ops: readonly EditOp[], actor: EditCtx['actor']): { violations: Violation[]; warnings: ReportLine[] } {
  const violations: Violation[] = [];
  const warnings: ReportLine[] = [];
  ops.forEach((op, i) => {
    const at = (field: string): string => (ops.length === 1 ? field : `ops[${i}].${field}`);
    const judge = (field: string, findings: Finding[]): void => {
      for (const f of findings) {
        const path = at(field) + (f.at ?? '');
        if (f.warn && actor === 'human') warnings.push({ kind: 'warn', code: f.warn, text: `${path} ${f.message}` });
        else violations.push({ code: f.code, path, message: `${path} ${f.message}` });
      }
    };
    const secrets = (field: string, values: readonly unknown[]): void => {
      if (actor !== 'agent') return;
      values.forEach((v, n) => {
        if (typeof v === 'string') judge(values.length === 1 ? field : `${field}[${n}]`, checkSecret(v));
      });
    };
    const wrong = (field: string, message: string): void => {
      violations.push({ code: 'E_VALUE', path: at(field), message: `${at(field)} ${message}` });
    };

    if (op.op === 'task.add' || op.op === 'task.edit') {
      if (op.title !== undefined) {
        judge('title', checkTitle(op.title));
        secrets('title', [op.title]);
      }
      if (op.detail !== undefined) {
        judge('detail', checkDetail(op.detail));
        secrets('detail', op.detail);
      }
      if (op.due !== undefined && op.due !== null) judge('due', checkDue(op.due));
    } else if (op.op === 'log.add') {
      judge('bullets', checkLog(op.bullets));
      secrets('bullets', op.bullets);
    } else if (op.op === 'set') {
      const v = op.value;
      const owned = actor === 'agent' && (!['name', 'now', 'status'].includes(op.field) || (op.field === 'status' && (v === 'paused' || v === 'archived')));
      if (owned) {
        violations.push({ code: 'E_HUMAN_OWNED', path: at(op.field), message: `${at(op.field)} is the owner's to decide — ${HUMAN_OWNED_HINT}` });
      } else if (op.field === 'name') {
        if (typeof v !== 'string') wrong('name', 'must be text');
        else {
          judge('name', checkName(v));
          secrets('name', [v]);
        }
      } else if (op.field === 'now') {
        if (typeof v === 'string' && (actor === 'agent' || fold(v) !== '')) {
          judge('now', checkNow(v));
          secrets('now', [v]);
        } else if (actor === 'agent' || (v !== null && typeof v !== 'string')) wrong('now', 'must be text');
      } else if (op.field === 'status') {
        if (typeof v !== 'string' || !(STATUSES as readonly string[]).includes(v)) wrong('status', `must be one of ${STATUSES.join(', ')}`);
      } else if (op.field === 'focus') {
        if (typeof v !== 'boolean') wrong('focus', 'must be true or false');
      } else if (op.field === 'due') {
        if (v !== null) judge('due', checkDue(v));
      } else if (op.field === 'tags') {
        if (!Array.isArray(v) || v.some((t) => typeof t !== 'string')) wrong('tags', 'must be a list of words');
      } else {
        const bad = badLinks(v);
        if (bad) wrong('links', bad);
      }
    }
  });
  return { violations, warnings };
}

/** A `set links` item: a URL, or the read model's own `{ label, url }`. */
type LinkItem = string | { label: string | null; url: string };

const BREAK_OR_CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

/** Why a `set links` value is refused, or null when every item is a link the read model will show (spec 1.3). */
function badLinks(v: unknown): string | null {
  if (!Array.isArray(v)) return 'must be a list';
  if (v.length > CAPS.LINKS_MAX) return `has ${v.length} items (max ${CAPS.LINKS_MAX})`;
  for (const item of v as unknown[]) {
    let url: unknown = item;
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const keys = Object.keys(item);
      const { label } = item as { label?: unknown };
      if (keys.length !== 2 || !keys.includes('label') || !keys.includes('url')) return 'items must be a URL or { label, url }';
      if (label !== null && (typeof label !== 'string' || BREAK_OR_CONTROL.test(label) || !fold(label) || measure(label) > CAPS.TITLE_MAX)) {
        return `labels must be one line of 1 to ${CAPS.TITLE_MAX} chars, or null`;
      }
      url = (item as { url: unknown }).url;
    }
    if (typeof url !== 'string') return 'items must be a URL or { label, url }';
    if (url.length > CAPS.LINK_URL_MAX || !/^\S+$/.test(url)) return `URLs must be one word of at most ${CAPS.LINK_URL_MAX} chars`;
    let scheme: string;
    try {
      scheme = new URL(url).protocol;
    } catch {
      return `${JSON.stringify(url.slice(0, 40))} is not a URL`;
    }
    if (!LINK_SCHEMES.includes(scheme)) return `URLs must start with ${LINK_SCHEMES.join(', ')}`;
  }
  return null;
}

/** The file's spelling of a vetted `set links` value: a bare URL, or a one-key `Label: URL` map. */
function fileLinks(items: readonly LinkItem[]): unknown[] {
  return items.map((item) => (typeof item === 'string' ? item : item.label === null ? item.url : { [fold(item.label)]: item.url }));
}

/** The log heading's author: the person, plus the agent that wrote for them, one line, at most 40 characters. */
function authorLine(author: string, agent: string | undefined): string {
  const tail = agent && fold(agent) ? ` + ${fold(agent)}` : '';
  const who = Array.from(fold(author) || 'unknown').slice(0, Math.max(1, AUTHOR_MAX - Array.from(tail).length));
  return Array.from(who.join('').trimEnd() + tail).slice(0, AUTHOR_MAX).join('');
}

/**
 * Apply edit ops to a parsed file, all or nothing: any op that fails leaves the file
 * exactly as it was, and nothing an op says is applied until every op has passed the
 * writing rules. Ops that would change nothing are reported as skipped, so the same ops
 * applied twice leave the same file. Throws `BlipError`; a read-only file (broken YAML, a
 * newer schema, a v2 file) is refused before anything else.
 */
export function applyEdit(file: BlipFile, ops: readonly EditOp[], ctx: EditCtx): EditResult {
  const before = file.toString();
  // Work on a copy: the caller's file changes only if everything goes through.
  const work = parseBlip(before, file.ctx);
  const ed: BlipEditor = work.edit({ now: ctx.now });
  const { violations, warnings } = vet(ops, ctx.actor);
  raise(violations, 'E_INVALID');

  const report: ReportLine[] = [];
  const removed: RemovedBlock[] = [];
  let touched = false;
  let added = false;
  const say = (kind: ReportLine['kind'], text: string, top = false): void => {
    report.push(top ? { kind, text, top } : { kind, text });
    if (kind !== 'skipped') touched = true;
  };

  const same = (list: TaskBlock[], title: string): TaskBlock[] => list.filter((b) => normalizeTitle(b.title) === normalizeTitle(title));
  const listing = (): string => numberedList(work.openTasks().map((b) => b.title));
  const gone = (ref: TaskRef, why = 'there is no task with that title'): never => {
    throw new BlipError('E_TASK_GONE', `"${ref.title}": ${why}`, { hint: `open tasks:\n${listing()}` });
  };
  /** The one task in `list` with this title, or null. Two is an error: the ref must mean one task. */
  const one = (list: TaskBlock[], ref: TaskRef): TaskBlock | null => {
    const hits = same(list, ref.title);
    if (hits.length > 1) {
      throw new BlipError('E_REF_AMBIGUOUS', `"${ref.title}" is the title of ${hits.length} tasks`, { hint: `retitle one of them by hand; open tasks:\n${listing()}` });
    }
    return hits[0] ?? null;
  };
  const openTask = (ref: TaskRef): TaskBlock | null => one(work.openTasks(), ref);
  const anyTask = (ref: TaskRef): TaskBlock => openTask(ref) ?? one(work.doneTasks(), ref) ?? gone(ref);
  const slot = (ref: TaskRef | null | undefined): TaskBlock | null => (ref ? (openTask(ref) ?? gone(ref)) : null);

  for (const op of ops) {
    switch (op.op) {
      case 'task.add': {
        const title = cleanTitle(op.title);
        if (same(work.openTasks(), title).length) {
          say('skipped', `already in the queue: ${title}`);
          break;
        }
        const beforeBlock = slot(op.before);
        const top = beforeBlock !== null && work.openTasks()[0] === beforeBlock;
        ed.addTask({ title, detail: op.detail ?? [], due: op.due ?? null }, beforeBlock);
        say('added', title, top);
        added = true;
        break;
      }
      case 'task.done': {
        const b = openTask(op.task);
        if (b) {
          ed.completeTask(b);
          say('done', b.title);
        } else if (same(work.doneTasks(), op.task.title).length) say('skipped', `already done: ${op.task.title}`);
        else gone(op.task);
        break;
      }
      case 'task.reopen': {
        // An open task with this title comes first: reopening a finished namesake would make two of them.
        if (same(work.openTasks(), op.task.title).length) {
          say('skipped', `already open: ${op.task.title}`);
          break;
        }
        const b = one(work.doneTasks(), op.task) ?? gone(op.task);
        ed.reopenTask(b);
        say('reopened', b.title);
        break;
      }
      case 'task.remove': {
        const b = anyTask(op.task);
        removed.push({ reason: 'removed', text: ed.removeTask(b) });
        say('removed', b.title);
        break;
      }
      case 'task.edit': {
        const b = anyTask(op.task);
        const was = JSON.stringify([b.title, b.due, b.children]);
        const title = op.title === undefined ? undefined : cleanTitle(op.title);
        if (title !== undefined && !b.checked && same(work.openTasks(), title).some((other) => other !== b)) {
          throw new BlipError('E_TITLE_DUPLICATE', `another open task is already titled "${title}"`, { hint: 'two open tasks cannot share a title; edit or remove the other one' });
        }
        const patch: { title?: string; due?: string | null; detail?: readonly string[] } = {};
        // The same title again is no change: a migrated title keeps the full stop it ends with.
        if (title !== undefined && title !== cleanTitle(b.title)) patch.title = title;
        if (op.due !== undefined) patch.due = op.due;
        if (op.detail !== undefined) patch.detail = op.detail;
        const old = ed.editTask(b, patch);
        if (old !== null) removed.push({ reason: 'detail replaced', text: old });
        if (JSON.stringify([b.title, b.due, b.children]) === was) say('skipped', `no change: ${b.title}`);
        else if (old !== null) report.push({ kind: 'edited', text: b.title, kept: true });
        else say('edited', b.title);
        break;
      }
      case 'task.move': {
        const b = openTask(op.task) ?? gone(op.task, same(work.doneTasks(), op.task.title).length ? 'that task is done; reopen it first' : undefined);
        if (ed.moveTask(b, slot(op.before))) say('moved', b.title, work.openTasks()[0] === b);
        else say('skipped', `already there: ${b.title}`);
        break;
      }
      case 'set': {
        const model = work.model();
        if (op.field === 'name') {
          const name = fold(String(op.value));
          if (model.nameSource === 'file' && model.name === name) {
            say('skipped', `name is already ${name}`);
            break;
          }
          if (ctx.actor === 'agent' && model.nameSource === 'file' && !isSlugName(model.name)) {
            throw new BlipError('E_HUMAN_OWNED', `this project already has a name ("${model.name}")`, { hint: 'only the owner renames a project: radar-blip set name "…"', path: 'name' });
          }
        }
        if (op.field === 'status' && model.status === op.value) {
          say('skipped', `status is already ${model.status}`);
          break;
        }
        if (ed.setField(op.field, op.field === 'links' ? fileLinks(op.value as LinkItem[]) : op.value)) {
          // What was stored, which is not always what was sent: tags are slugged, text is folded to one line.
          say('set', op.field === 'links' ? 'links' : `${op.field}: ${shown(work.state.values[op.field])}`);
          if (op.field === 'now' && typeof op.value === 'string' && isVagueNow(op.value)) {
            warnings.push({ kind: 'warn', code: 'now-style', text: 'the Now line says little: say what state the project is in and what it is waiting on' });
          }
        } else say('skipped', `${op.field} is unchanged`);
        break;
      }
      case 'log.add': {
        const bullets = cleanBullets(op.bullets).map((b) => b.text);
        const newest = work.logSection ? rawEntries(work.logSection)[0] : undefined;
        const have = new Set((newest ? viewEntry(newest).bullets : []).map((b) => collapse(b).toLowerCase()));
        if (bullets.every((b) => have.has(collapse(b).toLowerCase()))) {
          say('skipped', 'the newest log entry already says this');
          break;
        }
        ed.addLogEntry({ author: authorLine(ctx.author, op.agent), bullets });
        say('logged', String(bullets.length));
        for (const b of bullets) {
          if (hasLabel(b)) warnings.push({ kind: 'warn', code: 'log-label', text: `a log line starts with an all-capitals label: "${b.slice(0, 40)}"` });
        }
        break;
      }
    }
  }

  // Any write also puts right what a hand edit left out of place.
  if (touched) ed.tidy();
  const { doneInQueue, openInDone } = ed.corrections;
  if (doneInQueue) report.push({ kind: 'tidied', text: `moved ${doneInQueue} finished task(s) under "## Done"` });
  if (openInDone) report.push({ kind: 'tidied', text: `moved ${openInDone} unticked task(s) from "## Done" back to the queue` });
  const changed = work.toString() !== before;
  if (!changed) return { changed: false, report: [...report.filter((r) => r.kind === 'skipped'), ...warnings], removed: [] };

  if (added && work.openTasks().length > CAPS.OPEN_WARN) {
    warnings.push({ kind: 'warn', code: 'queue-too-long', text: `there are ${work.openTasks().length} open tasks (more than ${CAPS.OPEN_WARN})` });
  }
  Object.assign(file.state, work.state);
  return { changed: true, report: [...report, ...warnings], removed };
}
