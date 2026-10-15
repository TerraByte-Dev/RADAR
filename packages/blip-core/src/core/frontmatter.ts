import { isMap, isNode, isScalar, parseDocument, type Document } from 'yaml';
import { parseIsoDate } from './dates.js';
import { LINK_SCHEMES, MANAGED_KEYS, STATUSES, fold, slugTag, type BlipStatus } from './schema.js';

/**
 * Leading-frontmatter matcher. The YAML body may be empty (`---\n---\n`), and that form is
 * tried first: with one optional group, an empty header followed by a `---` rule further
 * down would take everything in between as YAML.
 */
export const FM_RE = /^---[ \t]*\r?\n(?:---[ \t]*(?:\r?\n|$)|([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$))/;
/** A first line that opens frontmatter. */
const FM_OPEN_RE = /^---[ \t]*(?:\r?\n|$)/;

export interface FrontmatterSplit {
  /** The whole frontmatter block, delimiters included, exactly as it is in the file. Null when there is none. */
  block: string | null;
  /** The YAML between the delimiters. Null when there is no frontmatter. */
  raw: string | null;
  body: string;
  /** The file opens with `---` but nothing closes it: a header that lost its last line, not a body. */
  unclosed: boolean;
}

export function splitFrontmatter(text: string): FrontmatterSplit {
  const m = FM_RE.exec(text);
  if (!m) return { block: null, raw: null, body: text, unclosed: FM_OPEN_RE.test(text) };
  return { block: m[0], raw: m[1] ?? '', body: text.slice(m[0].length), unclosed: false };
}

export interface FrontmatterValues {
  values: Record<string, unknown>;
  /** Set when the YAML cannot be read safely; such a file is read-only. `line` is 1-based within the YAML. */
  error: { message: string; line: number | null } | null;
}

export function readFrontmatter(raw: string | null): FrontmatterValues {
  if (raw === null || raw.trim() === '') return { values: {}, error: null };
  try {
    // The yaml Document collects syntax errors instead of throwing, and a document with
    // errors would be mangled by re-serialisation, so such a file is never written.
    const doc = parseDocument(raw);
    const first = doc.errors[0];
    const js: unknown = doc.toJS();
    const isObject = !!js && typeof js === 'object' && !Array.isArray(js);
    const values = isObject ? (js as Record<string, unknown>) : {};
    if (first) {
      return { values, error: { message: first.message.split('\n')[0]!.trim(), line: first.linePos?.[0].line ?? null } };
    }
    if (!isObject && js !== null && js !== undefined) {
      return { values, error: { message: 'frontmatter is not a list of "key: value" lines', line: 1 } };
    }
    return { values, error: null };
  } catch (err) {
    return { values: {}, error: { message: err instanceof Error ? err.message.split('\n')[0]!.trim() : String(err), line: null } };
  }
}

/** The schema a file declares: `2` when there is no usable `blip` key, `'newer'` above 3. */
export function schemaOf(values: Record<string, unknown>): 2 | 3 | 'newer' {
  const v = values.blip;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  if (n === 3) return 3;
  return n > 3 ? 'newer' : 2;
}

/** 1-based line of a top-level key within the YAML text, or null. */
export function keyLine(raw: string | null, key: string): number | null {
  if (raw === null) return null;
  const lines = raw.split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  return i < 0 ? null : i + 1;
}

/** Best-effort string coercion for scalars: `name: 123` arrives from YAML as a number. */
export function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/** A scalar as one line of text; null for anything else and for an empty line. */
export function cleanLine(v: unknown): string | null {
  const s = asString(v);
  if (s === null) return null;
  const t = fold(s);
  return t === '' ? null : t;
}

/** Slug a tag list: strings and numbers only, empty slugs dropped, duplicates dropped, order kept. */
export function slugTags(items: unknown): string[] {
  const list = Array.isArray(items) ? items : items === undefined || items === null ? [] : [items];
  const out: string[] = [];
  for (const item of list) {
    const s = asString(item);
    if (s === null) continue;
    const slug = slugTag(s);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** The date part of a v2 `deadline` (a date or a datetime), or null when it is not a real date. */
export function deadlineDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(v.trim());
  return m ? parseIsoDate(m[1]) : null;
}

function readLinks(v: unknown): { label: string | null; url: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { label: string | null; url: string }[] = [];
  for (const item of v) {
    let label: string | null = null;
    let url: unknown = item;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const entries = Object.entries(item as Record<string, unknown>);
      if (entries.length !== 1) continue;
      [label, url] = entries[0]!;
    }
    if (typeof url !== 'string') continue;
    try {
      if (LINK_SCHEMES.includes(new URL(url.trim()).protocol)) out.push({ label, url: url.trim() });
    } catch {
      // not a URL: stays in the file, never reaches the read model
    }
  }
  return out;
}

export interface Fields {
  name: string | null;
  now: string | null;
  status: BlipStatus;
  focus: boolean;
  due: string | null;
  /** A due date is present in the file but is not a real `YYYY-MM-DD`. */
  dueInvalid: boolean;
  tags: string[];
  links: { label: string | null; url: string }[];
}

/**
 * The managed fields in their v3 shape. For a v2 file this applies the old-key mapping in
 * memory (category and operation become tags, deadline becomes due, shipped becomes archived).
 */
export function readFields(values: Record<string, unknown>, schema: 2 | 3): Fields {
  const rawStatus = asString(values.status)?.trim().toLowerCase() ?? null;
  const mapped = schema === 2 && rawStatus === 'shipped' ? 'archived' : rawStatus;
  const known = mapped !== null && (STATUSES as readonly string[]).includes(mapped);

  let tags = slugTags(values.tags);
  let dueSource: unknown = values.due;
  let due = parseIsoDate(values.due);
  if (schema === 2) {
    tags = slugTags([asString(values.category), ...tags, asString(values.operation)]);
    if (values.deadline !== undefined && values.deadline !== null && values.deadline !== '') {
      dueSource = values.deadline;
      due = deadlineDate(values.deadline);
    }
  }

  return {
    name: cleanLine(values.name),
    now: cleanLine(values.now),
    status: known ? (mapped as BlipStatus) : 'active',
    focus: values.focus === true,
    due,
    dueInvalid: due === null && dueSource !== undefined && dueSource !== null && dueSource !== '',
    tags,
    links: readLinks(values.links),
  };
}

const STRINGIFY = { lineWidth: 0, flowCollectionPadding: false } as const;

function setKey(doc: Document, key: string, value: unknown): void {
  doc.set(key, key === 'tags' ? doc.createNode(value, { flow: true }) : value);
}

/** One `key: value` pair as YAML lines. Given the pair's old text, a scalar keeps its quoting and its trailing comment. */
function renderPair(key: string, value: unknown, source: string | null): string[] {
  let doc = source === null ? null : parseDocument(source);
  if (!doc || doc.errors.length || !isMap(doc.contents)) doc = parseDocument('');
  setKey(doc, key, value);
  return doc.toString(STRINGIFY).replace(/\n+$/, '').split('\n');
}

interface SourcePair {
  key: string;
  /** Comment and blank lines above the pair. */
  lead: string[];
  /** The pair's own lines, from its key to the end of its value. */
  own: string[];
}

/**
 * Cut the YAML into its top-level pairs by line, so a pair can be copied as text. Null when
 * the layout does not allow that: a flow map, indented keys, tagged or explicit keys.
 */
function sourcePairs(doc: Document, raw: string, lines: readonly string[]): { pairs: SourcePair[]; trailer: string[] } | null {
  if (doc.contents === null) return { pairs: [], trailer: [...lines] };
  if (!isMap(doc.contents) || doc.contents.flow) return null;
  const starts: number[] = [0];
  for (let i = raw.indexOf('\n'); i !== -1; i = raw.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineAt = (offset: number): number => {
    let n = 0;
    while (n + 1 < starts.length && starts[n + 1]! <= offset) n++;
    return n;
  };
  const pairs: SourcePair[] = [];
  let next = 0;
  for (const item of doc.contents.items) {
    const key = item.key;
    if (!isScalar(key) || !key.range) return null;
    const from = lineAt(key.range[0]);
    if (starts[from] !== key.range[0] || from < next) return null;
    const end = isNode(item.value) && item.value.range ? item.value.range[1] : key.range[1];
    const to = lineAt(Math.max(end - 1, key.range[0]));
    pairs.push({ key: String(key.value), lead: lines.slice(next, from), own: lines.slice(from, to + 1) });
    next = to + 1;
  }
  return { pairs, trailer: lines.slice(next) };
}

/** The whole document through the YAML stringifier: only for a layout {@link sourcePairs} cannot cut up. */
function reserialise(doc: Document, changes: Record<string, unknown>): string {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) doc.delete(key);
    else setKey(doc, key, value);
  }
  if (isMap(doc.contents)) {
    if (doc.contents.items.length === 0) return '';
    const rank = (key: unknown): number => {
      const name = String((key as { value?: unknown } | null)?.value ?? key);
      const i = (MANAGED_KEYS as readonly string[]).indexOf(name);
      return i < 0 ? MANAGED_KEYS.length : i;
    };
    doc.contents.items.sort((a, b) => rank(a.key) - rank(b.key));
  }
  return doc.toString(STRINGIFY).replace(/\n+$/, '');
}

/**
 * The YAML with some keys set (or, with `undefined`, removed), in canonical key order: the
 * managed keys first, then every other key in its original order. Only the keys in
 * `changes` are written afresh. Every other pair is copied from the source text as it
 * stands — spacing, quoting, comments, number spelling and all — because a key the engine
 * does not manage is never interpreted. Returns the new YAML with `\n` line endings.
 */
export function writeFrontmatter(raw: string | null, changes: Record<string, unknown>): string {
  let text = raw ?? '';
  let doc = parseDocument(text);
  if (text.trim() === '' || (doc.contents !== null && !isMap(doc.contents))) {
    // Nothing, or a lone null (`~`): there are no keys to keep.
    text = '';
    doc = parseDocument('');
  }
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const source = sourcePairs(doc, text, lines);
  if (!source) return reserialise(doc, changes);

  const rank = (key: string): number => {
    const i = (MANAGED_KEYS as readonly string[]).indexOf(key);
    return i < 0 ? MANAGED_KEYS.length : i;
  };
  const out: { rank: number; lines: string[] }[] = [];
  const seen = new Set<string>();
  for (const pair of source.pairs) {
    seen.add(pair.key);
    if (!(pair.key in changes)) {
      out.push({ rank: rank(pair.key), lines: [...pair.lead, ...pair.own] });
    } else if (changes[pair.key] === undefined) {
      // The key goes; a comment written above it stays where it was.
      const comments = pair.lead.filter((l) => l.trim() !== '');
      if (comments.length) out.push({ rank: MANAGED_KEYS.length, lines: comments });
    } else {
      out.push({ rank: rank(pair.key), lines: [...pair.lead, ...renderPair(pair.key, changes[pair.key], pair.own.join('\n'))] });
    }
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined && !seen.has(key)) out.push({ rank: rank(key), lines: renderPair(key, value, null) });
  }
  out.sort((a, b) => a.rank - b.rank);
  return [...out.flatMap((o) => o.lines), ...source.trailer].join('\n');
}
