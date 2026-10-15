import {
  checkDetail,
  checkDue,
  checkLog,
  checkName,
  checkNow,
  checkSecret,
  checkTitle,
  cleanTitle,
  numberedList,
  raise,
  type EditOp,
  type Finding,
} from './edit.js';
import { BlipError, wellFormed, type BlipDoc, type Violation } from './schema.js';
import { normalizeTitle } from './tasks.js';

/** A task as an agent names it: its number in the brief it just read, or its whole title. */
export type SyncRef = number | string;

export interface SyncAdd {
  title: string;
  detail?: string[];
  due?: string;
  top?: boolean;
}

/** What an agent sends at the end of a stretch of work. Every key is optional; `{}` means "nothing to log". */
export interface SyncPayload {
  /** The `rev` of the brief the integer refs came from. */
  rev?: string;
  now?: string;
  log?: string[];
  done?: SyncRef[];
  reopen?: SyncRef[];
  remove?: SyncRef[];
  edit?: { ref: SyncRef; title?: string; detail?: string[]; due?: string | null }[];
  move?: { ref: SyncRef; to: 'top' | 'bottom' | number }[];
  add?: SyncAdd[];
  status?: 'active' | 'blocked';
  name?: string;
}

const KEYS = ['rev', 'now', 'log', 'done', 'reopen', 'remove', 'edit', 'move', 'add', 'status', 'name'] as const;
const V2_KEYS = ['session', 'tasks', 'fields'];
const EDIT_KEYS = ['ref', 'title', 'detail', 'due'];
const MOVE_KEYS = ['ref', 'to'];
const ADD_KEYS = ['title', 'detail', 'due', 'top'];
/** No field holds more than a few hundred characters; a string past this is refused unread. */
const TEXT_MAX = 4000;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/**
 * Check a sync payload: its shape, and every writing rule that can be judged without the
 * file. Everything wrong is found before returning and thrown together, each violation
 * with its field path and the measured value, so one rejection costs one retry.
 */
export function parseSyncPayload(raw: unknown): SyncPayload {
  if (!isObject(raw)) throw new BlipError('E_PAYLOAD_TYPE', 'the payload must be one JSON object: { … }');
  const v2 = V2_KEYS.filter((k) => k in raw);
  if (v2.length) {
    throw new BlipError('E_PAYLOAD_V2', `the payload uses the v2 key${v2.length > 1 ? 's' : ''} ${v2.map((k) => `"${k}"`).join(', ')}`, {
      hint: 'the /blip skill on this machine is from v2 — run "radar-blip setup"',
    });
  }

  const violations: Violation[] = [];
  const bad = (code: string, path: string, message: string): void => {
    violations.push({ code, path, message: `${path} ${message}` });
  };
  const judge = (path: string, findings: Finding[]): void => {
    for (const f of findings) bad(f.code, path + (f.at ?? ''), f.message);
  };
  const keys = (obj: Record<string, unknown>, allowed: readonly string[], path: string): void => {
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k)) bad('E_PAYLOAD_KEY', path ? `${path}.${k}` : k, `is not a key here — allowed: ${allowed.join(', ')}`);
    }
  };
  /** A string, checked for anything token-shaped. Undefined (with a violation) when it is not one. */
  const text = (value: unknown, path: string): string | undefined => {
    if (typeof value !== 'string') {
      bad('E_PAYLOAD_TYPE', path, 'must be text');
      return undefined;
    }
    // Before any pattern is run over it: a megabyte of the wrong shape must not stall the checks below.
    if (value.length > TEXT_MAX) {
      bad('E_PAYLOAD_TYPE', path, `is ${value.length} characters long — no field of a payload takes more than a few hundred`);
      return undefined;
    }
    if (wellFormed(value) !== value) {
      bad('E_PAYLOAD_TYPE', path, 'has half of a character in it (a lone surrogate) — send it as whole text');
      return undefined;
    }
    judge(path, checkSecret(value));
    return value;
  };
  const texts = (value: unknown, path: string): string[] | undefined => {
    if (!Array.isArray(value)) {
      bad('E_PAYLOAD_TYPE', path, 'must be a list of text lines');
      return undefined;
    }
    const out = value.map((item, i) => text(item, `${path}[${i}]`));
    return out.every((s) => s !== undefined) ? (out as string[]) : undefined;
  };
  let numbered = false;
  const ref = (value: unknown, path: string): SyncRef | undefined => {
    if (isCount(value)) {
      numbered = true;
      return value;
    }
    if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) {
      // As text it would be matched against titles, and complete whichever task has that digit in it.
      bad('E_PAYLOAD_TYPE', path, `is a number written as text — send the number as a number (${value.trim()}, not "${value.trim()}"), with "rev"`);
      return undefined;
    }
    if (typeof value === 'string' && normalizeTitle(value) !== '') return value;
    bad('E_PAYLOAD_TYPE', path, 'must be a task number from the brief (1 or more) or a whole title');
    return undefined;
  };
  const list = <T>(key: string, each: (item: unknown, path: string) => T | undefined): T[] | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      bad('E_PAYLOAD_TYPE', key, 'must be a list');
      return undefined;
    }
    return value.map((item, i) => each(item, `${key}[${i}]`)).filter((item): item is T => item !== undefined);
  };
  const title = (value: unknown, path: string): string | undefined => {
    const s = text(value, path);
    if (s !== undefined) judge(path, checkTitle(s));
    return s;
  };
  const detail = (value: unknown, path: string): string[] | undefined => {
    const lines = texts(value, path);
    if (lines) judge(path, checkDetail(lines));
    return lines;
  };

  keys(raw, KEYS, '');
  const out: SyncPayload = {};

  if (raw.rev !== undefined) {
    if (typeof raw.rev === 'string') out.rev = raw.rev;
    else bad('E_PAYLOAD_TYPE', 'rev', 'must be the "rev" text from the brief');
  }
  if (raw.now !== undefined) {
    const now = text(raw.now, 'now');
    if (now !== undefined) {
      judge('now', checkNow(now));
      out.now = now;
    }
  }
  if (raw.log !== undefined) {
    const log = texts(raw.log, 'log');
    if (log) {
      judge('log', checkLog(log));
      out.log = log;
    }
    if (raw.now === undefined) bad('E_NOW_REQUIRED', 'now', 'is required with "log": say where the project stands now, even if only to confirm it');
  }
  for (const key of ['done', 'reopen', 'remove'] as const) {
    const refs = list(key, ref);
    if (refs) out[key] = refs;
  }
  const edit = list('edit', (item, path) => {
    if (!isObject(item)) return void bad('E_PAYLOAD_TYPE', path, 'must be an object: { "ref": …, "title": …, "detail": […], "due": … }');
    keys(item, EDIT_KEYS, path);
    const entry: NonNullable<SyncPayload['edit']>[number] = { ref: ref(item.ref, `${path}.ref`) ?? '' };
    if (item.title !== undefined) {
      const t = title(item.title, `${path}.title`);
      if (t !== undefined) entry.title = t;
    }
    if (item.detail !== undefined) {
      const d = detail(item.detail, `${path}.detail`);
      if (d) entry.detail = d;
    }
    if (item.due === null) entry.due = null;
    else if (item.due !== undefined) {
      judge(`${path}.due`, checkDue(item.due));
      if (typeof item.due === 'string') entry.due = item.due;
    }
    return entry;
  });
  if (edit) out.edit = edit;
  const move = list('move', (item, path) => {
    if (!isObject(item)) return void bad('E_PAYLOAD_TYPE', path, 'must be an object: { "ref": …, "to": "top" | "bottom" | position }');
    keys(item, MOVE_KEYS, path);
    const to = item.to;
    if (to !== 'top' && to !== 'bottom' && !isCount(to)) bad('E_PAYLOAD_TYPE', `${path}.to`, 'must be "top", "bottom" or a position (1 or more)');
    return { ref: ref(item.ref, `${path}.ref`) ?? '', to: to as 'top' | 'bottom' | number };
  });
  if (move) out.move = move;
  const add = list('add', (item, path): SyncAdd | undefined => {
    if (typeof item === 'string') {
      const t = title(item, path);
      return t === undefined ? undefined : { title: t };
    }
    if (!isObject(item)) return void bad('E_PAYLOAD_TYPE', path, 'must be a title or an object: { "title": …, "detail": […], "due": …, "top": true }');
    keys(item, ADD_KEYS, path);
    const entry: SyncAdd = { title: title(item.title, `${path}.title`) ?? '' };
    if (item.detail !== undefined) {
      const d = detail(item.detail, `${path}.detail`);
      if (d) entry.detail = d;
    }
    if (item.due !== undefined) {
      judge(`${path}.due`, checkDue(item.due));
      if (typeof item.due === 'string') entry.due = item.due;
    }
    if (item.top !== undefined) {
      if (typeof item.top === 'boolean') entry.top = item.top;
      else bad('E_PAYLOAD_TYPE', `${path}.top`, 'must be true or false');
    }
    return entry;
  });
  if (add) out.add = add;
  if (raw.status !== undefined) {
    if (raw.status === 'active' || raw.status === 'blocked') out.status = raw.status;
    else if (raw.status === 'paused' || raw.status === 'archived') {
      bad('E_HUMAN_OWNED', 'status', `"${raw.status}" is the owner's to decide — when the owner asks for it: radar-blip set status ${raw.status}`);
    } else bad('E_PAYLOAD_TYPE', 'status', 'must be "active" or "blocked"');
  }
  if (raw.name !== undefined) {
    const name = text(raw.name, 'name');
    if (name !== undefined) {
      judge('name', checkName(name));
      out.name = name;
    }
  }
  if (numbered && raw.rev === undefined) bad('E_REV_REQUIRED', 'rev', 'is required when a ref is a number: send the "rev" of the brief the numbers came from');

  raise(violations, 'E_PAYLOAD_INVALID');
  return out;
}

const usesNumbers = (p: SyncPayload): boolean =>
  [...(p.done ?? []), ...(p.reopen ?? []), ...(p.remove ?? []), ...(p.edit ?? []).map((e) => e.ref), ...(p.move ?? []).map((m) => m.ref)].some((r) => typeof r === 'number');

/**
 * Find the one task a ref means. A number is the task's position among the open tasks. A
 * string is an exact title first, wherever that is (so a replayed "done" finds the task it
 * already completed, not another one that merely contains the words), and otherwise part of
 * exactly one title. `prefer` says which list is tried first. With `whole`, only an exact
 * title will do: that is how every ref in a sync payload is resolved, because an agent's
 * guess at part of a title, or a replay of it, can land on whichever other task contains
 * the words. The CLI shorthands a person types keep matching on part of a title.
 */
export function resolveRef<T extends { title: string }>(tasks: { open: readonly T[]; done: readonly T[] }, ref: SyncRef, prefer: 'open' | 'done' = 'open', whole = false): T {
  const listing = `open tasks:\n${numberedList(tasks.open.map((t) => t.title))}`;
  if (typeof ref === 'number') {
    if (prefer === 'done') throw new BlipError('E_TASK_GONE', `${ref}: a finished task has no number — name it by its title`, { hint: listing });
    const task = tasks.open[ref - 1];
    if (!task) throw new BlipError('E_TASK_GONE', `there is no open task number ${ref}`, { hint: listing });
    return task;
  }
  const want = normalizeTitle(ref);
  const [first, second] = prefer === 'open' ? [tasks.open, tasks.done] : [tasks.done, tasks.open];
  const shown = (hits: readonly T[]): string => hits.map((t) => (tasks.open.includes(t) ? `${tasks.open.indexOf(t) + 1}. ${t.title}` : `(done) ${t.title}`)).join('\n');
  const ambiguous = (hits: readonly T[]): BlipError =>
    new BlipError('E_REF_AMBIGUOUS', `"${ref}" matches ${hits.length} tasks`, { hint: `use more of the title, or the number:\n${shown(hits)}` });

  const exact = (pool: readonly T[]): T[] => pool.filter((t) => normalizeTitle(t.title) === want);
  const mine = exact(first);
  if (mine.length === 1) return mine[0]!;
  if (mine.length > 1) throw ambiguous(mine);
  // In the other list this is the task a replay has already dealt with. Which of several
  // namesakes is returned does not matter: "done" and "reopen" skip, everything else refuses two.
  const theirs = exact(second);
  if (theirs.length) return theirs[0]!;

  const partial = [first, second].map((pool) => pool.filter((t) => normalizeTitle(t.title).includes(want)));
  if (whole) {
    const near = partial.flat();
    throw new BlipError('E_TASK_GONE', `no task is titled "${ref}"`, {
      hint: near.length ? `name the task by its whole title, or by its number with "rev" — part of a title is not enough:\n${shown(near)}` : listing,
    });
  }
  for (const hits of partial) {
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) throw ambiguous(hits);
  }
  throw new BlipError('E_TASK_GONE', `no task matches "${ref}"`, { hint: listing });
}

/**
 * Turn a payload into edit ops. Every ref is resolved against the one snapshot `doc` before
 * anything is emitted; the ops then name tasks by exact title, in the fixed order done,
 * reopen, edit, move, remove, add, status, name, now, log. `rev` is the rev of the bytes
 * `doc` was read from: integer refs are honoured only when the payload carries the same one.
 *
 * Where the moves and adds leave the queue is worked out once, as one layout, so that the
 * same payload applied to its own result finds every task already in place:
 *   - new `top` adds, in listed order; then the tasks that are not moved, in the order they
 *     have; then new plain adds, in listed order;
 *   - a task the payload adds that is already in the queue stays where it is. When it sits
 *     at the head (a `top` add) or the tail (a plain add) of the tasks that are not moved,
 *     it is taken for one this payload put there, and the moves are placed inside of it;
 *   - each moved task gets the position it was sent to among the rest: `top` and `bottom`
 *     in listed order, a number as its final 1-based position (the next free one when two
 *     tasks are sent to the same place).
 */
export function syncToOps(doc: BlipDoc, payload: SyncPayload, rev: string): EditOp[] {
  if (usesNumbers(payload)) {
    if (payload.rev === undefined) throw new BlipError('E_REV_REQUIRED', 'a ref is a number but the payload has no "rev"', { hint: 'send the "rev" of the brief the numbers came from' });
    if (payload.rev !== rev) {
      throw new BlipError('E_STALE_REFS', 'the file has changed since the brief these task numbers came from, so nothing was written', {
        hint: `read the brief again and resend; open tasks now:\n${numberedList(doc.tasks.open.map((t) => t.title))}`,
      });
    }
  }

  // The snapshot, as objects: a task keeps its identity while the lists below are rearranged.
  type Sim = { title: string };
  let open: Sim[] = doc.tasks.open.map((t) => ({ title: t.title }));
  const done: Sim[] = doc.tasks.done.map((t) => ({ title: t.title }));
  const snapshot = { open: [...open], done: [...done] };
  // An agent names a task by its whole title or by its number, never by part of a title.
  const find = (ref: SyncRef, prefer: 'open' | 'done' = 'open'): Sim => resolveRef(snapshot, ref, prefer, true);
  const key = (t: Sim): string => normalizeTitle(t.title);

  const toDone = (payload.done ?? []).map((r) => find(r));
  const toReopen = (payload.reopen ?? []).map((r) => find(r, 'done'));
  const toEdit = (payload.edit ?? []).map((e) => ({ ...e, task: find(e.ref) }));
  const toMove = (payload.move ?? []).map((m) => ({ to: m.to, task: find(m.ref) }));
  const toRemove = (payload.remove ?? []).map((r) => find(r));
  // A payload that says two opposite things about one task has no result that a second run would leave alone.
  const both = toReopen.find((t) => toDone.includes(t));
  if (both) {
    throw new BlipError('E_CONFLICT', `"${both.title}" is in both "done" and "reopen"`, { hint: 'say which it is: finished, or open again', path: 'reopen' });
  }

  const ops: EditOp[] = [];
  const take = (list: Sim[], t: Sim): boolean => {
    const at = list.indexOf(t);
    if (at >= 0) list.splice(at, 1);
    return at >= 0;
  };
  for (const t of toDone) {
    ops.push({ op: 'task.done', task: { title: t.title } });
    if (take(open, t)) done.unshift(t);
  }
  for (const t of toReopen) {
    ops.push({ op: 'task.reopen', task: { title: t.title } });
    // Reopening is skipped when an open task already has the title, so nothing joins the queue then.
    if (!open.some((o) => normalizeTitle(o.title) === normalizeTitle(t.title)) && take(done, t)) open.push(t);
  }
  for (const e of toEdit) {
    const op: EditOp = { op: 'task.edit', task: { title: e.task.title } };
    if (e.title !== undefined) op.title = e.title;
    if (e.detail !== undefined) op.detail = e.detail;
    if (e.due !== undefined) op.due = e.due;
    ops.push(op);
    if (e.title !== undefined) e.task.title = cleanTitle(e.title);
  }

  // The adds: which create a task, and which titles the payload means for the top and for the end.
  const closing = new Set([...toDone, ...toRemove].map(key));
  const inQueue = new Set(open.map(key));
  const topTitles = new Set<string>();
  const endTitles = new Set<string>();
  const newTop: Sim[] = [];
  const newEnd: Sim[] = [];
  (payload.add ?? []).forEach((a, i) => {
    const title = cleanTitle(a.title);
    const k = normalizeTitle(title);
    if (closing.has(k)) {
      // Applied twice, this would finish or delete the task its own first run added.
      throw new BlipError('E_CONFLICT', `add[${i}] "${title}" is also a task this payload completes or removes`, {
        hint: 'send the add in a sync of its own, after this one',
        path: `add[${i}]`,
      });
    }
    // Only the first mention of a title counts; a second one is skipped when it is applied.
    if (topTitles.has(k) || endTitles.has(k)) return;
    (a.top ? topTitles : endTitles).add(k);
    if (!inQueue.has(k)) (a.top ? newTop : newEnd).push({ title });
  });

  // A task named twice goes where its last mention says. One that is not open is left for the op to refuse.
  const movers = new Map<Sim, 'top' | 'bottom' | number>();
  for (const m of toMove) {
    movers.delete(m.task);
    if (open.includes(m.task)) movers.set(m.task, m.to);
    else ops.push({ op: 'task.move', task: { title: m.task.title }, before: null });
  }
  if (movers.size) {
    const rest = [...newTop, ...open.filter((t) => !movers.has(t)), ...newEnd];
    let lead = 0;
    while (lead < rest.length && topTitles.has(key(rest[lead]!))) lead++;
    let tail = rest.length;
    while (tail > lead && endTitles.has(key(rest[tail - 1]!))) tail--;
    const middle = rest.slice(lead, tail);

    const n = middle.length + movers.size;
    const slots: (Sim | undefined)[] = Array.from({ length: n });
    const sent = [...movers];
    const tops = sent.filter(([, to]) => to === 'top');
    const bottoms = sent.filter(([, to]) => to === 'bottom');
    tops.forEach(([t], i) => (slots[i] = t));
    bottoms.forEach(([t], i) => (slots[n - bottoms.length + i] = t));
    for (const [t, to] of sent) {
      if (typeof to !== 'number') continue;
      let at = Math.min(to, n) - 1;
      while (at < n && slots[at]) at++;
      if (at === n) for (at = n - 1; slots[at]; at--);
      slots[at] = t;
    }
    let next = 0;
    const placed = slots.map((t) => t ?? middle[next++]!);

    // The queue as the moves leave it: the layout, less the tasks that do not exist yet.
    const made = new Set([...newTop, ...newEnd]);
    open = [...rest.slice(0, lead), ...placed, ...rest.slice(tail)].filter((t) => !made.has(t));
    // Last in the queue first, so the task each one is put in front of is already where it will stay.
    for (let i = open.length - 1; i >= 0; i--) {
      const t = open[i]!;
      const before = open[i + 1];
      if (movers.has(t)) ops.push({ op: 'task.move', task: { title: t.title }, before: before ? { title: before.title } : null });
    }
  }
  for (const t of toRemove) {
    ops.push({ op: 'task.remove', task: { title: t.title } });
    if (!take(open, t)) take(done, t);
  }
  const head = open[0];
  for (const a of payload.add ?? []) {
    const op: EditOp = { op: 'task.add', title: a.title };
    if (a.detail !== undefined) op.detail = a.detail;
    if (a.due !== undefined) op.due = a.due;
    if (a.top && head) op.before = { title: head.title };
    ops.push(op);
  }
  if (payload.status !== undefined) ops.push({ op: 'set', field: 'status', value: payload.status });
  if (payload.name !== undefined) ops.push({ op: 'set', field: 'name', value: payload.name });
  if (payload.now !== undefined) ops.push({ op: 'set', field: 'now', value: payload.now });
  if (payload.log !== undefined) ops.push({ op: 'log.add', bullets: payload.log });
  return ops;
}
