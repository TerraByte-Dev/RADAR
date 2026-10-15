import { entryInstant, parseClock, parseIsoDate } from './dates.js';
import { fold, makeFenceTracker, trimBlankTail, type LogEntry } from './schema.js';

/**
 * The `# Session log` section. An existing entry is an opaque raw block — its `## ` heading
 * line and every line up to the next `## ` line — and is never regenerated, re-wrapped or
 * re-timed. Date, time, author and bullets are views parsed from that raw text.
 */
export interface RawEntry {
  /** Heading line plus body, verbatim. Trailing blank lines are separators, not part of the entry. */
  lines: string[];
  /** 1-based line of the heading in the file it was parsed from; null for an entry made since. */
  line: number | null;
}

export interface LogSection {
  /** The section's lines, heading first, verbatim, without trailing blank lines. */
  lines: string[];
  /** 1-based line of the section heading in the file. */
  firstLine: number | null;
}

const ENTRY_RE = /^## /;

export function parseLogSection(lines: readonly string[], firstLine: number | null): LogSection {
  return { lines: trimBlankTail([...lines]), firstLine };
}

/** Index of every entry heading in the section's lines. A `## ` inside a code fence is not one. */
function entryStarts(lines: readonly string[]): number[] {
  const inFence = makeFenceTracker();
  const starts: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!inFence(lines[i]!) && ENTRY_RE.test(lines[i]!)) starts.push(i);
  }
  return starts;
}

/** Lines between the section heading and the first entry. */
export function logPreamble(sec: LogSection): string[] {
  const first = entryStarts(sec.lines)[0] ?? sec.lines.length;
  return sec.lines.slice(1, first);
}

export function rawEntries(sec: LogSection): RawEntry[] {
  const starts = entryStarts(sec.lines);
  return starts.map((start, i) => ({
    lines: trimBlankTail(sec.lines.slice(start, starts[i + 1] ?? sec.lines.length)),
    line: sec.firstLine === null ? null : sec.firstLine + start,
  }));
}

/** Parsed view of a heading line. Whatever does not fit stays null; the raw heading is always kept. */
export function parseHeading(line: string): { heading: string; date: string | null; time: string | null; author: string | null } {
  const heading = line.slice(3).trim();
  const date = parseIsoDate(heading.slice(0, 10));
  const tm = date ? /^[ T]+(\d{2}:\d{2})(?!\d)/.exec(heading.slice(10)) : null;
  const seps = [' — ', ' - ', ' · '].map((s) => heading.indexOf(s)).filter((i) => i >= 0);
  const at = seps.length ? Math.min(...seps) : -1;
  const author = at >= 0 ? heading.slice(at + 3).trim() : '';
  return { heading, date, time: tm ? parseClock(tm[1]) : null, author: author || null };
}

/** Each top-level bullet with its wrapped continuation lines joined by one space. `offset` indexes `body`. */
export function bulletItems(body: readonly string[]): { text: string; offset: number }[] {
  const inFence = makeFenceTracker();
  const items: { text: string; offset: number }[] = [];
  let open = false;
  body.forEach((line, offset) => {
    if (inFence(line) || line.trim() === '') {
      open = false;
      return;
    }
    const m = /^[-*] +(.*)$/.exec(line);
    if (m) {
      items.push({ text: m[1]!.trim(), offset });
      open = true;
    } else if (open) {
      const item = items[items.length - 1]!;
      item.text = `${item.text} ${line.trim()}`;
    }
  });
  return items;
}

export function viewEntry(e: RawEntry): LogEntry {
  const body = e.lines.slice(1);
  return { ...parseHeading(e.lines[0]!), lines: body, bullets: bulletItems(body).map((b) => b.text) };
}

/** The latest instant any entry stands for, as an ISO string. Position in the section does not matter. */
export function lastLogAt(entries: readonly RawEntry[], mtime?: Date): string | null {
  let max: Date | null = null;
  for (const e of entries) {
    const h = parseHeading(e.lines[0]!);
    if (!h.date) continue;
    const at = entryInstant(h.date, h.time, mtime);
    if (!max || at.getTime() > max.getTime()) max = at;
  }
  return max ? max.toISOString() : null;
}

/** The lines of an entry the engine writes. Every string is folded to one line, so text cannot forge a heading. */
export function makeEntry(input: { date: string; time: string; author: string; bullets: readonly string[] }): RawEntry {
  return {
    lines: [`## ${input.date} ${input.time} — ${fold(input.author)}`, ...input.bullets.map((b) => `- ${fold(b)}`)],
    line: null,
  };
}

/** Insert an entry directly under the section heading. No existing line is changed or moved. */
export function insertEntry(sec: LogSection, entry: RawEntry): void {
  const first = entryStarts(sec.lines)[0];
  if (first === undefined) {
    sec.lines.push('', ...entry.lines);
    return;
  }
  const lead = sec.lines[first - 1]!.trim() === '' ? [] : [''];
  sec.lines.splice(first, 0, ...lead, ...entry.lines, '');
}

/** Rebuild the section from a preamble and entries, one blank line between blocks. Used by migration only. */
export function rebuildLogSection(sec: LogSection, preamble: readonly string[], entries: readonly RawEntry[]): void {
  const out = [sec.lines[0] ?? '# Session log'];
  const lead = trimBlankTail([...preamble]);
  while (lead.length && lead[0]!.trim() === '') lead.shift();
  if (lead.length) out.push('', ...lead);
  for (const e of entries) out.push('', ...e.lines);
  sec.lines = out;
}

export type LogOrder = 'unchanged' | 'reversed' | 'sorted';

/**
 * Newest first, by date only. Stable. An entry with no readable date stays attached to the
 * dated entry above it (or stays first when there is none). Among equal dates: when the
 * dated entries were already oldest-first throughout (a pure append log) the whole log is
 * reversed; otherwise equal dates keep their order in the file.
 */
export function sortNewestFirst(entries: readonly RawEntry[]): { entries: RawEntry[]; order: LogOrder } {
  const lead: RawEntry[] = [];
  const groups: { date: string; items: RawEntry[] }[] = [];
  for (const e of entries) {
    const date = parseHeading(e.lines[0]!).date;
    if (date) groups.push({ date, items: [e] });
    else if (groups.length) groups[groups.length - 1]!.items.push(e);
    else lead.push(e);
  }
  const ascending = groups.every((g, i) => i === 0 || groups[i - 1]!.date <= g.date);
  const ordered = ascending ? [...groups].reverse() : [...groups].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const sorted = [...lead, ...ordered.flatMap((g) => g.items)];
  const same = sorted.every((e, i) => e === entries[i]);
  return { entries: sorted, order: same ? 'unchanged' : ascending ? 'reversed' : 'sorted' };
}
