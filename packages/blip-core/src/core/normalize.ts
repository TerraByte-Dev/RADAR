import { BlipFile, applyFrontmatter, ensureTasksSection, parseBlip, readsBack } from './doc.js';
import { asString, cleanLine, readFields } from './frontmatter.js';
import { lint } from './lint.js';
import { logPreamble, rawEntries, rebuildLogSection, sortNewestFirst, type LogOrder } from './log.js';
import { CAPS, SCHEMA_VERSION, makeFenceTracker, measure, slugTag, trimBlankTail } from './schema.js';
import { secretLines } from './secrets.js';
import { TITLE_LINE_RE, normalizeTitle, parseTitleText, sameLegacyTask, settle } from './tasks.js';

/** What one migration did (or, for a dry run, would do) to one file. */
export interface MigrationReport {
  /** The schema the file was in. */
  from: 2 | 3;
  changed: boolean;
  /** Why nothing was done, when nothing was. */
  skipped: 'already-v3' | 'unwritable' | 'newer-schema' | null;
  bytes: { before: number; after: number };
  /** Keys renamed or re-mapped, one readable line each: `deadline → due 2026-09-08`. */
  keys: string[];
  /** Keys removed, with the value each one held. */
  dropped: { key: string; value: string }[];
  /** Old keys deliberately left in place. */
  kept: { key: string; value: string }[];
  /** `promote`: `next_action` became task 1. `skip`: it matched an existing task. */
  nextAction: 'none' | 'promote' | 'skip';
  tasks: {
    open: number;
    /** Long titles split at a natural break. */
    split: number;
    /** Long titles with no natural break, cut at the last space within the limit. */
    cut: number;
    /** Long titles left alone, for one of the reasons counted in `leftLongWhy`. */
    leftLong: number;
    /**
     * `collision`: another open task has the same text, or every place it could be divided
     * leaves a title another open task ends up with. `noBreak`: there is no space to cut at
     * (a space right after a mid-text `(due …)` / `(done …)` does not count). `fence`: every
     * cut would start the detail with a code fence.
     */
    leftLongWhy: { collision: number; noBreak: number; fence: number };
    short: number;
    /** Ticked tasks moved from the queue to `## Done`. */
    movedToDone: number;
  };
  log: { entries: number; order: LogOrder };
  /** v2 boilerplate taken out. */
  removed: string[];
  /** Checklists sitting inside sections the engine does not manage: preserved, not imported. */
  foreign: { heading: string; items: number }[];
  /** Line numbers in the original file that look like they hold a token. Never the value. */
  secretLines: number[];
  /** Lint codes that remain after migration, with counts. */
  still: Record<string, number>;
  /** Up to three of the splits, to judge the rule by. */
  examples: { original: string; title: string; detail: string }[];
}

// Each of these is one whole comment and nothing else: `(?!-->)` stops the match from
// running past the comment's own end to a later `-->`, which would take real text with it.
const LEAD_TASKS_COMMENT = /^<!--\s*RADAR-owned checklist(?:(?!-->)[\s\S])*-->$/;
const LEAD_LOG_COMMENT = /^<!--\s*Append-only\b(?:(?!-->)[\s\S])*-->$/;
const NOTES_PLACEHOLDER = /^<!--\s*human-only\.(?:(?!-->)[\s\S])*-->$/i;
const DROPPED_KEYS = ['horizon', 'priority', 'radar_angle', 'last_session'] as const;
/** A split never leaves a title shorter than this, so a short label is carried to the next break. */
const SPLIT_MIN = 20;

function show(v: unknown): string {
  return typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v);
}

/** One way to divide a long task text. `title + " " + detail` is the text, byte for byte. */
export interface TitleSplit {
  title: string;
  detail: string;
  /** `split`: at a natural break. `cut`: at the last space that fits. */
  how: 'split' | 'cut';
}

/**
 * Every place a long task text may be divided into a title and one detail line, best
 * first: each natural break from the earliest on, then the last space within the limit.
 * Nothing is ever lost or reworded, wherever the cut falls. Empty when the text is short
 * enough or has nowhere to cut. Indexes are Unicode code points.
 */
export function splitOptions(text: string): TitleSplit[] {
  if (measure(text) <= CAPS.TITLE_MAX) return [];
  const cp = Array.from(text);
  const last = Math.min(CAPS.TITLE_MAX, cp.length - 2);
  const ws = (i: number): boolean => /\s/.test(cp[i] ?? ' ');
  const singleSpace = (p: number): boolean => cp[p] === ' ' && p > 0 && !ws(p - 1) && !ws(p + 1);
  /** A title ending in "(due YYYY-MM-DD)" or "(done …)" would be read back as a due date or a done stamp. */
  const noTail = (p: number): boolean => {
    const head = cp.slice(0, p).join('');
    return parseTitleText(head).title === head;
  };
  /** Never cut inside a code span, a bold span or an open bracket. */
  const balanced = (p: number): boolean => {
    const head = cp.slice(0, p).join('');
    const count = (re: RegExp): number => (head.match(re) ?? []).length;
    return count(/`/g) % 2 === 0 && count(/\*\*/g) % 2 === 0 && count(/\(/g) <= count(/\)/g) && count(/\[/g) <= count(/\]/g);
  };
  const natural = (p: number): boolean => {
    const before = cp[p - 1]!;
    const after = cp[p + 1]!;
    if ('-—–'.includes(after) && cp[p + 2] === ' ') return true;
    if (after === '(') return true;
    if (before === ':' || before === ';') return true;
    if (before !== '.') return false;
    // Not after an initial ("J.R. Hartwell") and not before a lower-case word (an abbreviation).
    const initial = /\p{Lu}/u.test(cp[p - 2] ?? '') && !/\p{L}/u.test(cp[p - 3] ?? '');
    return !initial && !/\p{Ll}/u.test(after);
  };
  const at = new Map<number, TitleSplit['how']>();
  for (let p = SPLIT_MIN; p <= last; p++) if (singleSpace(p) && natural(p) && balanced(p) && noTail(p)) at.set(p, 'split');
  const lastSpace = (ok: (p: number) => boolean): void => {
    for (let p = last; p > 0; p--) {
      if (!singleSpace(p) || !ok(p) || !noTail(p)) continue;
      if (!at.has(p)) at.set(p, 'cut');
      return;
    }
  };
  lastSpace(balanced);
  lastSpace(() => true);
  return [...at].map(([p, how]) => ({ title: cp.slice(0, p).join(''), detail: cp.slice(p + 1).join(''), how }));
}

/** The first of {@link splitOptions}: where a long task text is divided when nothing else is in the way. Null when there is none. */
export function splitTitle(text: string): TitleSplit | null {
  return splitOptions(text)[0] ?? null;
}

function emptyReport(file: BlipFile, text: string): MigrationReport {
  const bytes = Buffer.byteLength(text, 'utf8');
  return {
    from: file.schema,
    changed: false,
    skipped: null,
    bytes: { before: bytes, after: bytes },
    keys: [],
    dropped: [],
    kept: [],
    nextAction: 'none',
    tasks: { open: 0, split: 0, cut: 0, leftLong: 0, leftLongWhy: { collision: 0, noBreak: 0, fence: 0 }, short: 0, movedToDone: 0 },
    log: { entries: 0, order: 'unchanged' },
    removed: [],
    foreign: [],
    secretLines: secretLines(text),
    still: {},
    examples: [],
  };
}

/**
 * Rewrite a v2 file as v3. Pure: text in, text out, plus a report of everything it did.
 * A v3 file, a file from a newer schema and a file with broken YAML come back unchanged,
 * and so does a file that would not read back as migrated (`skipped: 'unwritable'`).
 * Nothing is inferred for the fields a human owns: no name, no focus and no "now" line is
 * ever made up.
 */
export function migrateFile(file: BlipFile): { text: string; report: MigrationReport } {
  const input = file.toString();
  const report = emptyReport(file, input);
  if (file.readOnly !== 'E_NEEDS_MIGRATE') {
    report.skipped = file.readOnly === 'E_UNWRITABLE' ? 'unwritable' : file.readOnly === 'E_NEWER_SCHEMA' ? 'newer-schema' : 'already-v3';
    return { text: input, report };
  }

  const next = parseBlip(input, file.ctx);
  const st = next.state;
  const values = st.values;
  const fields = readFields(values, 2);

  // ---- frontmatter ----
  const changes: Record<string, unknown> = { blip: SCHEMA_VERSION };
  if (values.status !== undefined && values.status !== fields.status) {
    changes.status = fields.status;
    const said = asString(values.status)?.trim().toLowerCase();
    // `fields.status` already holds the verdict: "active" for a value that does not say
    // "active" means the value was not a status the engine knows.
    if (said === 'shipped') report.keys.push('status shipped → archived');
    else if (fields.status === 'active' && said !== 'active') report.keys.push(`status ${show(values.status)} → active`);
  }
  for (const key of ['category', 'operation'] as const) {
    if (!(key in values)) continue;
    changes[key] = undefined;
    const slug = slugTag(show(values[key] ?? ''));
    report.keys.push(`${key} ${JSON.stringify(show(values[key] ?? ''))} → ${slug ? `tag ${slug}` : '(no tag)'}`);
  }
  if (fields.tags.length) changes.tags = fields.tags;
  else if ('tags' in values) changes.tags = undefined;
  if ('deadline' in values) {
    changes.deadline = undefined;
    if (fields.due) {
      changes.due = fields.due;
      report.keys.push(`deadline → due ${fields.due}`);
    } else if (fields.dueInvalid) {
      report.dropped.push({ key: 'deadline', value: show(values.deadline) });
    }
  }
  for (const key of DROPPED_KEYS) {
    if (!(key in values)) continue;
    changes[key] = undefined;
    report.dropped.push({ key, value: show(values[key]) });
  }
  if ('created' in values) report.kept.push({ key: 'created', value: show(values.created) });
  // The reading of `next_action` the read model uses: a scalar is the next step, anything else is not a task.
  const promoted = cleanLine(values.next_action) ?? '';
  if ('next_action' in values) {
    changes.next_action = undefined;
    if (!promoted && values.next_action !== null && values.next_action !== '') report.dropped.push({ key: 'next_action', value: show(values.next_action) });
  }
  try {
    applyFrontmatter(st, changes);
  } catch {
    return { text: input, report: { ...emptyReport(file, input), skipped: 'unwritable' } };
  }
  if (st.fmBlock === null && st.sections.length && !/^\r?\n/.test(st.sections[0]!.text)) {
    // The file had no frontmatter: keep a blank line between the new one and the body.
    st.sections.unshift({ kind: 'raw', heading: null, text: st.eol, line: 1 });
  }

  // ---- next_action: the full text, compared against every task, open and done ----
  if (promoted) {
    const all = [...next.openTasks(), ...next.doneTasks()];
    if (all.some((b) => sameLegacyTask(b.title, promoted))) {
      report.nextAction = 'skip';
    } else {
      report.nextAction = 'promote';
      ensureTasksSection(st).model.queue.unshift({ checked: false, ...parseTitleText(promoted), children: [], line: null });
    }
  }

  // ---- tasks ----
  const tasks = st.sections.find((s) => s.kind === 'tasks');
  if (tasks && tasks.kind === 'tasks') {
    const sec = tasks.model;
    const lead = trimBlankTail(sec.preamble.filter((l) => !LEAD_TASKS_COMMENT.test(l.trim())));
    if (lead.length !== trimBlankTail([...sec.preamble]).length) report.removed.push('placeholder comment under # Tasks');
    while (lead.length && lead[0]!.trim() === '') lead.shift();
    sec.preamble = lead.length ? ['', ...lead, ''] : [''];
    if (sec.doneHeading !== null && sec.donePreamble.every((l) => l.trim() === '')) sec.donePreamble = [''];

    // Ticked boxes go under `## Done` in file order. No completion date is invented.
    report.tasks.movedToDone = settle(sec, null).doneInQueue;

    // Each long title is divided at its first break. Titles that would then be the same task
    // (a lead-in such as "Agreed on 2026-05-02:" shared by several) move on to their next
    // break, all of them together, until every title is its own; one that runs out of
    // breaks takes back the first of its titles that no other task ended up with; only
    // tasks with the same text to the limit are left long. A detail line that would open a
    // code fence would swallow the rest of the file, so that break is never used.
    const options = sec.queue.map((b) => splitOptions(b.title).filter((o) => !makeFenceTracker()(`  ${o.detail}`)));
    const pick = options.map(() => 0);
    for (;;) {
      const proposed = sec.queue.map((b, i) => normalizeTitle(options[i]![pick[i]!]?.title ?? b.title));
      const counts = new Map<string, number>();
      for (const t of proposed) counts.set(t, (counts.get(t) ?? 0) + 1);
      const clashing = proposed.flatMap((t, i) => (pick[i]! < options[i]!.length && counts.get(t)! > 1 ? [i] : []));
      if (!clashing.length) break;
      for (const i of clashing) pick[i]!++;
    }
    const finalTitle = (j: number): string => normalizeTitle(options[j]![pick[j]!]?.title ?? sec.queue[j]!.title);
    sec.queue.forEach((b, i) => {
      if (pick[i]! < options[i]!.length) return;
      const whole = normalizeTitle(b.title);
      if (sec.queue.some((o, j) => j !== i && normalizeTitle(o.title) === whole)) return;
      const taken = new Set(sec.queue.flatMap((_, j) => (j === i ? [] : [finalTitle(j)])));
      const k = options[i]!.findIndex((o) => !taken.has(normalizeTitle(o.title)));
      if (k >= 0) pick[i] = k;
    });
    report.tasks.open = sec.queue.length;
    sec.queue.forEach((b, i) => {
      const plan = options[i]![pick[i]!];
      if (measure(b.title) <= CAPS.TITLE_MAX) {
        report.tasks.short++;
      } else if (!plan) {
        report.tasks.leftLong++;
        // No break at all, every break opens a code fence, or every break gives a title another task has.
        report.tasks.leftLongWhy[options[i]!.length ? 'collision' : splitTitle(b.title) ? 'fence' : 'noBreak']++;
      } else {
        if (report.examples.length < 3) report.examples.push({ original: b.title, title: plan.title, detail: plan.detail });
        b.title = plan.title;
        b.children.unshift(`  ${plan.detail}`);
        report.tasks[plan.how]++;
      }
    });
    tasks.dirty = true;
  }

  // ---- log: sorted once, newest first; every entry is moved whole ----
  const log = st.sections.find((s) => s.kind === 'log');
  if (log && log.kind === 'log') {
    const before = logPreamble(log.model);
    const lead = before.filter((l) => !LEAD_LOG_COMMENT.test(l.trim()));
    if (lead.length !== before.length) report.removed.push('placeholder comment under # Session log');
    const sorted = sortNewestFirst(rawEntries(log.model));
    rebuildLogSection(log.model, lead, sorted.entries);
    report.log = { entries: sorted.entries.length, order: sorted.order };
    log.dirty = true;
  }

  // ---- other sections: preserved; the empty v2 Notes skeleton is the one thing removed ----
  st.sections = st.sections.filter((s) => {
    if (s.kind !== 'raw' || s.heading === null) return true;
    const nl = s.text.indexOf('\n');
    const body = nl < 0 ? '' : s.text.slice(nl + 1);
    if (s.heading.toLowerCase() === 'notes' && NOTES_PLACEHOLDER.test(body.trim())) {
      report.removed.push('empty # Notes section');
      return false;
    }
    const inFence = makeFenceTracker();
    const items = body.split(/\r?\n/).filter((l) => !inFence(l) && TITLE_LINE_RE.test(l)).length;
    if (items) report.foreign.push({ heading: s.heading, items });
    return true;
  });

  if (!readsBack(next)) {
    // Moving things would bury tasks or log entries (an unclosed code fence, say). The owner fixes the file by hand first.
    return { text: input, report: { ...emptyReport(file, input), skipped: 'unwritable' } };
  }
  const text = next.toString();
  report.changed = text !== input;
  report.bytes.after = Buffer.byteLength(text, 'utf8');
  for (const p of lint(parseBlip(text, file.ctx))) report.still[p.code] = (report.still[p.code] ?? 0) + 1;
  return { text, report };
}
