import { Blip } from './blip.js';
import {
  HORIZONS,
  STATUSES,
  coerceDeadline,
  coercePriority,
  type Horizon,
  type Status,
} from './types.js';

export interface CreateBlipOptions {
  name: string;
  horizon?: Horizon;
  priority?: number;
  category?: string;
  status?: Status;
  /** First task in the queue — the project's opening next action. */
  first_task?: string;
  deadline?: string;
  operation?: string;
}

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const SKELETON = [
  '',
  '# Tasks',
  '<!-- RADAR-owned checklist, in priority order. The first unchecked task is the next action. -->',
  '',
  '# Session log',
  '<!-- Append-only. `radar-blip sync`/`handoff` add a dated entry; prior entries are never rewritten. -->',
  '',
  '# Notes',
  '<!-- Human-only. Tooling never rewrites this section. -->',
  '',
].join('\n');

/**
 * Build a fresh BLIP for a new project. Frontmatter is created through the engine
 * (so values are YAML-escaped safely) and the body has the three canonical sections.
 */
export function createBlip(opts: CreateBlipOptions): Blip {
  const blip = Blip.parse(SKELETON);
  blip.setField('name', opts.name);
  blip.setField('horizon', opts.horizon ?? 'someday');
  blip.setField('priority', opts.priority ?? 3);
  blip.setField('category', opts.category ?? '');
  blip.setField('status', opts.status ?? 'active');
  if (opts.deadline) blip.setField('deadline', opts.deadline);
  if (opts.operation) blip.setField('operation', opts.operation);
  blip.setField('created', todayLocal());
  if (opts.first_task) blip.addTask(opts.first_task);
  return blip;
}

/* ── sync: one reconciliation, one atomic write ─────────────────────────────── */

/** A task to add. String form is shorthand for `{ text }`. */
export type SyncTaskAdd = string | { text: string; top?: boolean; due?: string };

/** A 1-based checklist position (as humans and `task list` see it) or exact task text. */
export type SyncRef = number | string;

/**
 * The whole result of reconciling a working session against a `BLIP.md` — what got done,
 * what's next, what the log says — applied in a single pass so an agent never has to fire
 * six commands and half-succeed.
 */
export interface SyncPayload {
  session?: { lines: string[]; author?: string; date?: string };
  tasks?: {
    done?: SyncRef[];
    undone?: SyncRef[];
    rm?: SyncRef[];
    edit?: { ref: SyncRef; text: string }[];
    add?: SyncTaskAdd[];
  };
  fields?: {
    name?: string;
    horizon?: Horizon;
    priority?: number;
    category?: string;
    status?: Status;
    deadline?: string | null;
    operation?: string | null;
    tags?: string[];
  };
}

const TASK_KEYS = ['done', 'undone', 'rm', 'edit', 'add'] as const;
const FIELD_KEYS = ['name', 'horizon', 'priority', 'category', 'status', 'deadline', 'operation', 'tags'] as const;

function bad(msg: string): never {
  throw new Error(`invalid sync payload: ${msg}`);
}

function assertNoExtraKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) bad(`unknown key ${JSON.stringify(k)} in ${where}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate an untrusted (LLM-authored) sync payload into a typed one. Strict on purpose:
 * a typo'd key silently doing nothing is worse than a loud failure, and the whole point of
 * `sync` is that the agent finds out immediately when its plan didn't apply.
 */
export function parseSyncPayload(raw: unknown): SyncPayload {
  if (!isRecord(raw)) bad('expected a JSON object');
  assertNoExtraKeys(raw, ['session', 'tasks', 'fields'], 'the payload');
  const out: SyncPayload = {};

  if (raw.session !== undefined) {
    const s = raw.session;
    if (!isRecord(s)) bad('`session` must be an object');
    assertNoExtraKeys(s, ['lines', 'author', 'date'], '`session`');
    if (!Array.isArray(s.lines) || !s.lines.every((l) => typeof l === 'string')) {
      bad('`session.lines` must be an array of strings');
    }
    if (s.author !== undefined && typeof s.author !== 'string') bad('`session.author` must be a string');
    if (s.date !== undefined && typeof s.date !== 'string') bad('`session.date` must be a string');
    out.session = { lines: s.lines as string[], author: s.author as string | undefined, date: s.date as string | undefined };
  }

  if (raw.tasks !== undefined) {
    const t = raw.tasks;
    if (!isRecord(t)) bad('`tasks` must be an object');
    assertNoExtraKeys(t, TASK_KEYS, '`tasks`');
    const refs = (v: unknown, key: string): SyncRef[] => {
      if (!Array.isArray(v)) bad(`\`tasks.${key}\` must be an array`);
      return v.map((r) => {
        if (typeof r === 'string') return r;
        if (typeof r === 'number' && Number.isInteger(r) && r >= 1) return r;
        bad(`\`tasks.${key}\` entries must be exact task text or a 1-based position`);
      });
    };
    const tasks: NonNullable<SyncPayload['tasks']> = {};
    if (t.done !== undefined) tasks.done = refs(t.done, 'done');
    if (t.undone !== undefined) tasks.undone = refs(t.undone, 'undone');
    if (t.rm !== undefined) tasks.rm = refs(t.rm, 'rm');
    if (t.edit !== undefined) {
      if (!Array.isArray(t.edit)) bad('`tasks.edit` must be an array');
      tasks.edit = t.edit.map((e) => {
        if (!isRecord(e)) bad('`tasks.edit` entries must be objects');
        assertNoExtraKeys(e, ['ref', 'text'], '`tasks.edit`');
        if (typeof e.text !== 'string') bad('`tasks.edit[].text` must be a string');
        return { ref: refs([e.ref], 'edit')[0]!, text: e.text };
      });
    }
    if (t.add !== undefined) {
      if (!Array.isArray(t.add)) bad('`tasks.add` must be an array');
      tasks.add = t.add.map((a) => {
        if (typeof a === 'string') return a;
        if (!isRecord(a)) bad('`tasks.add` entries must be a string or an object');
        assertNoExtraKeys(a, ['text', 'top', 'due'], '`tasks.add`');
        if (typeof a.text !== 'string' || !a.text.trim()) bad('`tasks.add[].text` must be a non-empty string');
        if (a.top !== undefined && typeof a.top !== 'boolean') bad('`tasks.add[].top` must be a boolean');
        if (a.due !== undefined && (typeof a.due !== 'string' || coerceDeadline(a.due) === undefined)) {
          bad('`tasks.add[].due` must be an ISO date like 2026-07-01');
        }
        return { text: a.text, top: a.top as boolean | undefined, due: a.due as string | undefined };
      });
    }
    out.tasks = tasks;
  }

  if (raw.fields !== undefined) {
    const f = raw.fields;
    if (!isRecord(f)) bad('`fields` must be an object');
    assertNoExtraKeys(f, FIELD_KEYS, '`fields`');
    const fields: NonNullable<SyncPayload['fields']> = {};
    if (f.name !== undefined) {
      if (typeof f.name !== 'string' || !f.name.trim()) bad('`fields.name` must be a non-empty string');
      fields.name = f.name;
    }
    if (f.horizon !== undefined) {
      if (!HORIZONS.includes(f.horizon as Horizon)) bad(`\`fields.horizon\` must be one of: ${HORIZONS.join(', ')}`);
      fields.horizon = f.horizon as Horizon;
    }
    if (f.status !== undefined) {
      if (!STATUSES.includes(f.status as Status)) bad(`\`fields.status\` must be one of: ${STATUSES.join(', ')}`);
      fields.status = f.status as Status;
    }
    if (f.priority !== undefined) {
      if (typeof f.priority !== 'number') bad('`fields.priority` must be a number 1-5');
      fields.priority = coercePriority(f.priority);
    }
    if (f.category !== undefined) {
      if (typeof f.category !== 'string') bad('`fields.category` must be a string');
      fields.category = f.category;
    }
    if (f.deadline !== undefined) {
      if (f.deadline === null) fields.deadline = null;
      else if (typeof f.deadline === 'string' && coerceDeadline(f.deadline) !== undefined) fields.deadline = f.deadline;
      else bad('`fields.deadline` must be an ISO date like 2026-07-01, or null to clear');
    }
    if (f.operation !== undefined) {
      if (f.operation === null) fields.operation = null;
      else if (typeof f.operation === 'string') fields.operation = f.operation;
      else bad('`fields.operation` must be a string, or null to clear');
    }
    if (f.tags !== undefined) {
      if (!Array.isArray(f.tags) || !f.tags.every((t) => typeof t === 'string')) {
        bad('`fields.tags` must be an array of strings');
      }
      fields.tags = f.tags as string[];
    }
    out.fields = fields;
  }

  return out;
}

/** Human-readable one-liners describing what a sync did — the CLI's success output. */
export interface SyncReport {
  changed: boolean;
  lines: string[];
}

/**
 * Apply a whole reconciliation to a blip in one pass.
 *
 * **Reference stability is the contract**: every `ref` (1-based position or exact text) is
 * resolved against the task list *as the caller saw it* — the pre-sync snapshot — before
 * anything mutates. So `{done: [2], rm: [4]}` means what a human reading `task list` meant,
 * regardless of application order. Adds happen last, so they never shift a ref either.
 * Any bad ref throws before a single byte is written (`updateBlip` discards the whole
 * mutation), so a sync is all-or-nothing.
 */
export function applySync(blip: Blip, payload: SyncPayload): SyncReport {
  // Live task objects plus the text the caller saw — the engine mutates tasks in place, so
  // object identity survives edits and lets a ref keep pointing at the right row after
  // earlier ops have shifted every index around it.
  const before = blip.tasks.slice();
  const beforeText = before.map((t) => t.text);
  const report: string[] = [];

  const target = (ref: SyncRef, what: string): { index: number; text: string } => {
    const snap = typeof ref === 'number' ? ref - 1 : beforeText.indexOf(ref);
    if (snap < 0 || snap >= before.length) {
      throw new Error(
        `sync: no task matching ${JSON.stringify(ref)} to ${what} — ` +
          `run \`radar-blip show --json\` and use an exact task text or a 1-based position`,
      );
    }
    const index = blip.tasks.indexOf(before[snap]!);
    if (index < 0) {
      throw new Error(`sync: task ${JSON.stringify(beforeText[snap])} was already removed earlier in this payload`);
    }
    return { index, text: beforeText[snap]! };
  };

  const t = payload.tasks;
  if (t) {
    for (const ref of t.done ?? []) {
      const h = target(ref, 'check off');
      blip.setTaskDone(h.index, true);
      report.push(`✔ ${h.text}`);
    }
    for (const ref of t.undone ?? []) {
      const h = target(ref, 'un-check');
      blip.setTaskDone(h.index, false);
      report.push(`↺ ${h.text}`);
    }
    for (const e of t.edit ?? []) {
      const h = target(e.ref, 'edit');
      blip.editTask(h.index, e.text);
      report.push(`✎ ${h.text} → ${e.text}`);
    }
    // Removals last among the ref-taking ops; each re-resolves live, so shifting indices can't bite.
    for (const ref of t.rm ?? []) {
      const h = target(ref, 'remove');
      blip.removeTask(h.index);
      report.push(`✕ ${h.text}`);
    }
    // Adds last of all — a new task can never shift a ref. `top` entries keep their given
    // order at the head of the queue (first listed = the very next action).
    let topAt = 0;
    for (const a of t.add ?? []) {
      const spec = typeof a === 'string' ? { text: a, top: false, due: undefined } : a;
      const text = spec.due ? `${spec.text.trim()} (due ${spec.due})` : spec.text;
      if (spec.top) blip.insertTask(topAt++, text);
      else blip.addTask(text);
      report.push(`${spec.top ? '↑' : '+'} ${text}`);
    }
  }

  const f = payload.fields;
  if (f) {
    if (f.name !== undefined) blip.setField('name', f.name);
    if (f.horizon !== undefined) blip.setHorizon(f.horizon);
    if (f.priority !== undefined) blip.setPriority(f.priority);
    if (f.category !== undefined) blip.setCategory(f.category);
    if (f.status !== undefined) blip.setStatus(f.status);
    if (f.deadline !== undefined) blip.setDeadline(f.deadline);
    if (f.operation !== undefined) blip.setOperation(f.operation);
    if (f.tags !== undefined) blip.setField('tags', f.tags);
    for (const [k, v] of Object.entries(f)) report.push(`· ${k} = ${v === null ? '(cleared)' : String(v)}`);
  }

  if (payload.session && payload.session.lines.length) {
    blip.appendSession(payload.session);
    report.push(`▸ logged ${payload.session.lines.length} session line(s)`);
  }

  return { changed: report.length > 0, lines: report };
}
