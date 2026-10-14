import { access, chmod, copyFile, mkdir, readFile, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { constants, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './atomic.js';
import { CAPS, BlipError } from './core/schema.js';
import { dataDir } from './paths.js';

/**
 * `radar-blip setup`: installs the /blip skill for Claude Code (and Codex, when it is there)
 * and RADAR's three Claude Code hooks. Every location comes from {@link Targets}, so a test
 * points the whole thing at a throwaway folder. settings.json is edited as text: only the
 * RADAR entries are added or taken out, and every other byte stays as it was.
 */

/** The marker line every `/blip` skill file carries; the number moves only when the skill text does. */
export const SKILL_STAMP = `<!-- radar-blip-skill v${CAPS.SKILL_FORMAT} -->`;
/** Any version of the stamp: a skill file RADAR installed. */
export const ANY_STAMP_RE = /<!-- radar-blip-skill v(\d+) -->/;

/** The three hooks, by Claude Code event. */
export const HOOK_EVENTS = { SessionStart: 'session-start', Stop: 'stop', SessionEnd: 'session-end' } as const;
export type HookEvent = keyof typeof HOOK_EVENTS;
export const HOOK_TIMEOUT_S = 10;

/**
 * A command that runs a RADAR hook in any spelling (spec 5.4): `radar-blip hook <event>`
 * anywhere in it, any case, after a path or `npx`, before `|| true`. Setup takes every one
 * out but the entry it writes itself, so no second copy of a hook survives.
 */
const RADAR_HOOK_RE = /(?<![\w-])radar-blip(?:\.cmd)?"?\s+hook\b\s*([\w-]*)/i;

/**
 * The form setup writes, and nothing else: the whole command is `radar-blip hook <event>`,
 * where `radar-blip` may be a path (quoted or not) ending in `radar-blip` or `radar-blip.cmd`.
 */
const WRITTEN_RE = /^(?:"(?:[^"]*[\\/])?radar-blip(?:\.cmd)?"|(?:[^\s"]*[\\/])?radar-blip(?:\.cmd)?)\s+hook\s+(session-start|stop|session-end)$/;

/** The event a hook command runs (`stop`, …, '' when it names none) when it is one of RADAR's, else null. */
export function radarHook(command: string): string | null {
  return RADAR_HOOK_RE.exec(command)?.[1]?.toLowerCase() ?? null;
}

/** Where setup reads and writes. */
export interface Targets {
  /** Claude Code's config folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
  claudeDir: string;
  /** Codex's folder: `CODEX_HOME`, else `~/.codex`. Its prompt is installed only when it exists. */
  codexDir: string;
  /** The engine's data folder; the shim lives in its `bin`. */
  dataDir: string;
  /** The skill files this package ships. */
  skillsDir: string;
}

export function defaultTargets(env: NodeJS.ProcessEnv = process.env): Targets {
  return {
    claudeDir: env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
    codexDir: env.CODEX_HOME || join(homedir(), '.codex'),
    dataDir: dataDir(),
    skillsDir: fileURLToPath(new URL('../skills/', import.meta.url)),
  };
}

export const settingsPath = (t: Targets): string => join(t.claudeDir, 'settings.json');
export const claudeSkillPath = (t: Targets): string => join(t.claudeDir, 'skills', 'blip', 'SKILL.md');
export const codexSkillPath = (t: Targets): string => join(t.codexDir, 'prompts', 'blip.md');
export const shimPath = (t: Targets): string => join(t.dataDir, 'bin', process.platform === 'win32' ? 'radar-blip.cmd' : 'radar-blip');

/** How hook entries call the CLI: the shim's absolute path, quoted with forward slashes, when it exists; else the bare name on PATH. */
export function cliCommand(t: Targets): string {
  const shim = shimPath(t);
  return existsSync(shim) ? `"${shim.replace(/\\/g, '/')}"` : 'radar-blip';
}

// ---- reading settings.json ----

export interface HookEntry {
  event: string;
  command: string;
  timeout: unknown;
}

/** Every hook command in a settings object, with the event it is filed under. */
export function hookEntries(settings: unknown): HookEntry[] {
  const hooks = (settings as { hooks?: unknown } | null)?.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      const entries = (group as { hooks?: unknown } | null)?.hooks;
      for (const entry of Array.isArray(entries) ? entries : []) {
        const e = entry as { command?: unknown; timeout?: unknown } | null;
        if (typeof e?.command === 'string') out.push({ event, command: e.command, timeout: e.timeout });
      }
    }
  }
  return out;
}

/** What is wrong with RADAR's hook entries: per event, how many there are, and entries filed under the wrong event. */
export function hookProblems(settings: unknown): string[] {
  const ours = hookEntries(settings).flatMap((h) => {
    const sub = radarHook(h.command);
    return sub === null ? [] : [{ event: h.event, sub, written: WRITTEN_RE.test(h.command.trim()) }];
  });
  const out: string[] = [];
  for (const [event, sub] of Object.entries(HOOK_EVENTS)) {
    const n = ours.filter((h) => h.event === event && h.sub === sub).length;
    if (n !== 1) out.push(`settings.json has ${n} "radar-blip hook ${sub}" entries under ${event} (there must be exactly one)`);
  }
  const stray = ours.filter((h) => (HOOK_EVENTS as Record<string, string>)[h.event] !== h.sub);
  if (stray.length) out.push(`settings.json has a hook entry filed under the wrong event ("radar-blip hook ${stray[0]!.sub}" under ${stray[0]!.event})`);
  const odd = ours.find((h) => !h.written);
  if (odd) out.push(`settings.json has a RADAR hook entry under ${odd.event} in a form setup does not write`);
  return out;
}

/**
 * Whether the installed skill or hooks are out of date (`setup-stale`), in one read of each
 * file. False when there is no Claude config folder at all: then there is nothing to update.
 */
export function setupStale(t: Targets = defaultTargets()): boolean {
  if (!existsSync(t.claudeDir)) return false;
  try {
    if (!readFileSync(claudeSkillPath(t), 'utf8').includes(SKILL_STAMP)) return true;
    return hookProblems(JSON.parse(readFileSync(settingsPath(t), 'utf8'))).length > 0;
  } catch {
    return true;
  }
}

// ---- editing settings.json as text ----

type Node = { start: number; end: number } & ({ t: 'obj'; members: { key: string; start: number; value: Node }[] } | { t: 'arr'; items: Node[] } | { t: 'val' });
type Obj = Extract<Node, { t: 'obj' }>;
type Arr = Extract<Node, { t: 'arr' }>;

/** Where every value sits in `text`, which JSON.parse has already accepted. */
function spans(text: string): Node {
  let i = 0;
  const ws = (): void => {
    while (i < text.length && ' \t\r\n'.includes(text[i]!)) i++;
  };
  const str = (): string => {
    const start = i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): Node => {
    ws();
    const start = i;
    if (text[i] === '{') {
      i++;
      const members: Obj['members'] = [];
      for (ws(); text[i] !== '}'; ws()) {
        if (text[i] === ',') {
          i++;
          ws();
        }
        const kStart = i;
        const key = str();
        ws();
        i++; // :
        members.push({ key, start: kStart, value: value() });
      }
      i++;
      return { t: 'obj', start, end: i, members };
    }
    if (text[i] === '[') {
      i++;
      const items: Node[] = [];
      for (ws(); text[i] !== ']'; ws()) {
        if (text[i] === ',') i++;
        items.push(value());
      }
      i++;
      return { t: 'arr', start, end: i, items };
    }
    if (text[i] === '"') str();
    else while (i < text.length && !',]} \t\r\n'.includes(text[i]!)) i++;
    return { t: 'val', start, end: i };
  };
  return value();
}

const member = (o: Node | undefined, key: string): Node | undefined => (o?.t === 'obj' ? o.members.find((m) => m.key === key)?.value : undefined);

function lineIndent(text: string, at: number): string {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/** `value` as two-space JSON whose lines after the first start at `indent`. */
function render(value: unknown, indent: string, nl: string): string {
  return JSON.stringify(value, null, 2).split('\n').join(`${nl}${indent}`);
}

/** Text with the span [from, to) replaced. */
const splice = (text: string, from: number, to: number, put: string): string => text.slice(0, from) + put + text.slice(to);

/** Remove element `i` of a container, its separator with it. The only element leaves `[]` / `{}`. */
function removeAt(text: string, container: Node, i: number): string {
  const parts = container.t === 'arr' ? container.items.map((n) => ({ start: n.start, end: n.end })) : container.t === 'obj' ? container.members.map((m) => ({ start: m.start, end: m.value.end })) : [];
  if (parts.length === 1) return splice(text, container.start + 1, container.end - 1, '');
  if (i < parts.length - 1) return splice(text, parts[i]!.start, parts[i + 1]!.start, '');
  return splice(text, parts[i - 1]!.end, parts[i]!.end, '');
}

/** Append `entry` (already rendered) to a container, one level deeper than it. */
function append(text: string, container: Node, entry: (indent: string) => string, nl: string): string {
  const parts = container.t === 'arr' ? container.items : container.t === 'obj' ? container.members.map((m) => ({ start: m.start, end: m.value.end })) : [];
  const outer = lineIndent(text, container.start);
  if (!parts.length) {
    const indent = `${outer}  `;
    return splice(text, container.start + 1, container.end - 1, `${nl}${indent}${entry(indent)}${nl}${outer}`);
  }
  const last = parts[parts.length - 1]!;
  // The last element's own indentation when it starts a line, else one level in.
  const lineStart = text.lastIndexOf('\n', last.start - 1) + 1;
  const lead = text.slice(lineStart, last.start);
  const own = /^[ \t]*$/.test(lead) ? lead : `${outer}  `;
  return splice(text, last.end, last.end, `,${nl}${own}${entry(own)}`);
}

const hookGroup = (command: string): unknown => ({ hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] });

/**
 * settings.json with RADAR's hook entries made right: with `remove`, none; otherwise exactly
 * one per event, `<cli> hook <event>`. Entries that are already right are left where they
 * are, so a second run changes nothing. A group or event list emptied by a removal is
 * taken out with it. Throws E_SETTINGS_INVALID for anything that is not a JSON object with
 * a `hooks` object of lists.
 */
export function editSettings(original: string, cli: string, remove: boolean): string {
  const bom = original.startsWith('﻿') ? '﻿' : '';
  let text = original.slice(bom.length);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const invalid = (why: string): BlipError => new BlipError('E_SETTINGS_INVALID', `settings.json ${why}, so it was not changed`, { hint: 'fix the file by hand, then run setup again' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw invalid(`is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid('is not a JSON object');
  const want = (event: string): string | null => (remove || !(event in HOOK_EVENTS) ? null : `${cli} hook ${HOOK_EVENTS[event as HookEvent]}`);

  // Take out one wrong entry at a time, reading the text again after each.
  for (;;) {
    const root = spans(text) as Obj;
    const hooks = member(root, 'hooks');
    if (hooks === undefined) break;
    if (hooks.t !== 'obj') throw invalid('has a "hooks" value that is not an object');
    let removal: { list: Arr; gi: number; group: Node; ei: number; hooksAt: number; eventAt: number } | null = null;
    hooks.members.forEach((m, eventAt) => {
      if (m.value.t !== 'arr') throw invalid(`has a "hooks.${m.key}" value that is not a list`);
      let kept = false;
      m.value.items.forEach((group, gi) => {
        const entries = member(group, 'hooks');
        if (entries?.t !== 'arr') return;
        entries.items.forEach((entry, ei) => {
          const v = JSON.parse(text.slice(entry.start, entry.end)) as { type?: unknown; command?: unknown; timeout?: unknown } | null;
          if (typeof v?.command !== 'string' || radarHook(v.command) === null) return;
          const right = !kept && v.command === want(m.key) && v.type === 'command' && v.timeout === HOOK_TIMEOUT_S;
          if (right) kept = true;
          else removal ??= { list: m.value as Arr, gi, group, ei, hooksAt: root.members.findIndex((r) => r.key === 'hooks'), eventAt };
        });
      });
    });
    if (removal === null) break;
    const r: { list: Arr; gi: number; group: Node; ei: number; hooksAt: number; eventAt: number } = removal;
    const entries = member(r.group, 'hooks') as Arr;
    if (entries.items.length > 1) {
      text = removeAt(text, entries, r.ei);
      continue;
    }
    const event = hooks.members[r.eventAt]!.key;
    if (r.list.items.length > 1 || want(event) !== null) text = removeAt(text, r.list, r.gi);
    else if (hooks.members.length > 1) text = removeAt(text, hooks, r.eventAt);
    else text = removeAt(text, root, r.hooksAt);
  }

  if (!remove) {
    for (const event of Object.keys(HOOK_EVENTS)) {
      const root = spans(text) as Obj;
      const hooks = member(root, 'hooks');
      const command = want(event)!;
      const list = member(hooks, event);
      if (list?.t === 'arr' && hookEntries({ hooks: { [event]: JSON.parse(text.slice(list.start, list.end)) } }).some((h) => h.command === command)) continue;
      if (hooks === undefined) text = append(text, root, (ind) => `"hooks": ${render({ [event]: [hookGroup(command)] }, ind, nl)}`, nl);
      else if (list === undefined) text = append(text, hooks, (ind) => `${JSON.stringify(event)}: ${render([hookGroup(command)], ind, nl)}`, nl);
      else text = append(text, list, (ind) => render(hookGroup(command), ind, nl), nl);
    }
  }
  return bom + text;
}

// ---- the plan ----

export interface SkillAction {
  target: string;
  action: 'install' | 'replace' | 'remove';
  /** For `replace`: where the old file is copied first. */
  backup?: string;
}

/** The app's runtime for the shim: node, or the app's own executable run as node. */
export interface ShimTarget {
  /** The bundled CLI file. */
  cli: string;
  /** The node binary, or the app executable when `electron` is set. */
  runtime: string;
  electron?: boolean;
}

export interface SetupPlan {
  settings: { path: string; before: string | null; after: string };
  skills: SkillAction[];
  /** Contents for skill files being installed or replaced, by target. */
  skillText: Record<string, string>;
  shim: { path: string; text: string } | null;
  changed: boolean;
}

/** `YYYYMMDD-HHMMSS`, local time. */
function stamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

const readOrNull = (path: string): Promise<string | null> => readFile(path, 'utf8').catch(() => null);

/**
 * The shim's text: run the CLI with the runtime it was written for, every argument passed
 * through. Paths are quoted for the shell that reads the file: in a batch file `%` starts a
 * variable, so it is doubled; in sh, single quotes keep `$` and backticks literal.
 */
export function shimText(s: ShimTarget, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    const q = (p: string): string => `"${p.replace(/%/g, '%%')}"`;
    return `@echo off\r\nsetlocal\r\n${s.electron ? 'set ELECTRON_RUN_AS_NODE=1\r\n' : ''}${q(s.runtime)} ${q(s.cli)} %*\r\n`;
  }
  const q = (p: string): string => `'${p.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\n${s.electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}exec ${q(s.runtime)} ${q(s.cli)} "$@"\n`;
}

/**
 * What setup (or `--remove`) would change. Reads only. With `shim`, the shim is written too
 * and the hook entries call it.
 */
export async function planSetup(t: Targets, opts: { remove?: boolean; shim?: ShimTarget; now?: Date } = {}): Promise<SetupPlan> {
  const remove = opts.remove === true;
  const now = opts.now ?? new Date();
  const sPath = settingsPath(t);
  const before = await readOrNull(sPath);

  let shim: SetupPlan['shim'] = null;
  if (!remove && opts.shim) {
    const text = shimText(opts.shim);
    if ((await readOrNull(shimPath(t))) !== text) shim = { path: shimPath(t), text };
  }
  const cli = opts.shim ? `"${shimPath(t).replace(/\\/g, '/')}"` : cliCommand(t);
  const after = editSettings(before ?? '{}\n', cli, remove);

  const skills: SkillAction[] = [];
  const skillText: Record<string, string> = {};
  const targets: [string, string][] = [[claudeSkillPath(t), join(t.skillsDir, 'claude', 'blip', 'SKILL.md')]];
  if (existsSync(t.codexDir)) targets.push([codexSkillPath(t), join(t.skillsDir, 'codex', 'blip.md')]);
  for (const [target, source] of targets) {
    const current = await readOrNull(target);
    if (remove) {
      if (current !== null && ANY_STAMP_RE.test(current)) skills.push({ target, action: 'remove' });
      continue;
    }
    const text = await readFile(source, 'utf8');
    if (current === text) continue;
    skillText[target] = text;
    skills.push(current === null ? { target, action: 'install' } : { target, action: 'replace', backup: `${target}.bak-${stamp(now)}` });
  }
  const settingsChanged = after !== (before ?? '{}\n') || (before === null && !remove);
  return {
    settings: { path: sPath, before, after },
    skills,
    skillText,
    shim,
    changed: settingsChanged || skills.length > 0 || shim !== null,
  };
}

/** The file a path names: a symlink's target (dotfile managers link ~/.claude files), else the path. */
const fileOf = (path: string): Promise<string> => realpath(path).catch(() => path);

/**
 * Carry out a plan. settings.json is copied to `settings.json.radar-bak` first, then replaced
 * atomically. A symlinked file is written where the link points, so the link survives.
 */
export async function applySetup(plan: SetupPlan): Promise<void> {
  const { path, before, after } = plan.settings;
  if (before === null ? after !== '{}\n' : after !== before) {
    await mkdir(dirname(path), { recursive: true });
    const file = await fileOf(path);
    if (before !== null) {
      await access(file, constants.W_OK).catch((err: unknown) => {
        throw new BlipError('E_SETTINGS_READONLY', `settings.json cannot be written (${(err as { code?: string }).code ?? 'no access'}), so it was not changed`, {
          hint: 'the file is read-only or not yours: make it writable, then run setup again',
          path: file,
        });
      });
      await copyFile(path, `${path}.radar-bak`);
    }
    await writeAtomic(file, after);
  }
  for (const s of plan.skills) {
    if (s.action === 'remove') {
      await unlink(s.target);
      await rmdir(dirname(s.target)).catch(() => {}); // only when empty
      continue;
    }
    await mkdir(dirname(s.target), { recursive: true });
    if (s.backup) await copyFile(s.target, s.backup);
    await writeAtomic(await fileOf(s.target), plan.skillText[s.target]!);
  }
  if (plan.shim) await writeShim(plan.shim.path, plan.shim.text);
}

async function writeShim(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  if (process.platform !== 'win32') await chmod(path, 0o755);
}

/** Whether RADAR v3's own skill or hooks are on this machine (a v2-only install does not count). */
async function installed(t: Targets): Promise<boolean> {
  const skill = await readOrNull(claudeSkillPath(t));
  if (skill !== null && ANY_STAMP_RE.test(skill)) return true;
  try {
    const entries = hookEntries(JSON.parse((await readOrNull(settingsPath(t))) ?? '{}'));
    return entries.some((h) => (h.event === 'SessionStart' || h.event === 'SessionEnd') && radarHook(h.command) !== null);
  } catch {
    return false;
  }
}

/**
 * What the app runs on every start: rewrite the shim when it points somewhere else, and,
 * only when RADAR's own skill or hooks are already installed, bring them up to date without
 * asking. Nothing is ever installed for the first time here, and nothing the owner took out
 * is put back: the hooks are touched only while one of RADAR's is still in settings.json, a
 * skill file only while it carries RADAR's stamp. Returns whether anything changed.
 */
export async function ensure(t: Targets, shim: ShimTarget): Promise<boolean> {
  let changed = false;
  const current = await readOrNull(shimPath(t));
  if (current !== null && current !== shimText(shim)) {
    await writeShim(shimPath(t), shimText(shim));
    changed = true;
  }
  if (await installed(t)) {
    const plan = await planSetup(t);
    const { before } = plan.settings;
    if (!hookEntries(JSON.parse((before ?? '{}').replace(/^﻿/, ''))).some((h) => radarHook(h.command) !== null)) plan.settings.after = before ?? '{}\n';
    const stamped = await Promise.all(plan.skills.map(async (s) => ANY_STAMP_RE.test((await readOrNull(s.target)) ?? '')));
    plan.skills = plan.skills.filter((_, i) => stamped[i]);
    plan.changed = plan.settings.after !== (before ?? '{}\n') || plan.skills.length > 0;
    if (plan.changed) {
      await applySetup(plan);
      changed = true;
    }
  }
  return changed;
}

// ---- showing the plan ----

/** Past this many cells (16 MB of table), the changed middle of a diff is shown whole instead of compared. */
const LCS_MAX_CELLS = 4_000_000;

/** A unified diff of two texts, three lines of context. Empty when they are equal. */
export function unifiedDiff(a: string, b: string, name: string): string[] {
  if (a === b) return [];
  const x = a.split(/\r?\n/);
  const y = b.split(/\r?\n/);
  const ops: { op: ' ' | '-' | '+'; line: string; i: number; j: number }[] = [];
  // The lines both texts start and end with are kept as they are: RADAR's edit is a small region.
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length && x[i] === y[j]) ops.push({ op: ' ', line: x[i]!, i: i++, j: j++ });
  let tail = 0;
  while (tail < x.length - i && tail < y.length - j && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const n = x.length - tail;
  const m = y.length - tail;
  if ((n - i) * (m - j) > LCS_MAX_CELLS) {
    // Too big to compare line by line in reasonable memory: one block out, one block in.
    while (i < n) ops.push({ op: '-', line: x[i]!, i: i++, j });
    while (j < m) ops.push({ op: '+', line: y[j]!, i, j: j++ });
  } else {
    // Longest common subsequence of the middle, from the end.
    const i0 = i;
    const j0 = j;
    const lcs: Uint32Array[] = Array.from({ length: n - i0 + 1 }, () => new Uint32Array(m - j0 + 1));
    const at = (p: number, q: number): number => lcs[p - i0]![q - j0]!;
    for (let p = n - 1; p >= i0; p--) for (let q = m - 1; q >= j0; q--) lcs[p - i0]![q - j0] = x[p] === y[q] ? at(p + 1, q + 1) + 1 : Math.max(at(p + 1, q), at(p, q + 1));
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) ops.push({ op: ' ', line: x[i]!, i: i++, j: j++ });
      // a tie removes first, so a changed line reads as its removal, then what replaces it
      else if (i < n && (j === m || at(i + 1, j) >= at(i, j + 1))) ops.push({ op: '-', line: x[i]!, i: i++, j });
      else ops.push({ op: '+', line: y[j]!, i, j: j++ });
    }
  }
  while (i < x.length) ops.push({ op: ' ', line: x[i]!, i: i++, j: j++ });
  const out = [`--- ${name}`, `+++ ${name}`];
  const C = 3;
  for (let k = 0; k < ops.length; ) {
    if (ops[k]!.op === ' ') {
      k++;
      continue;
    }
    const start = Math.max(0, k - C);
    let end = k;
    // Extend while changes are within 2C lines of each other.
    for (let q = k; q < ops.length; q++) {
      if (ops[q]!.op !== ' ') end = q;
      else if (q - end > 2 * C) break;
    }
    const stop = Math.min(ops.length, end + C + 1);
    const hunk = ops.slice(start, stop);
    const oldLen = hunk.filter((o) => o.op !== '+').length;
    const newLen = hunk.filter((o) => o.op !== '-').length;
    out.push(`@@ -${hunk[0]!.i + (oldLen ? 1 : 0)},${oldLen} +${hunk[0]!.j + (newLen ? 1 : 0)},${newLen} @@`);
    for (const o of hunk) out.push(`${o.op}${o.line}`);
    k = stop;
  }
  return out;
}

/** The plan as a person reads it: the settings diff, then one line per skill and the shim. */
export function describePlan(plan: SetupPlan): string[] {
  const { path, before, after } = plan.settings;
  const lines = unifiedDiff(before ?? '', before === null && after === '{}\n' ? '' : after, path);
  for (const s of plan.skills) {
    if (s.action === 'install') lines.push(`install  ${s.target}`);
    else if (s.action === 'replace') lines.push(`replace  ${s.target} (the old file is kept as ${s.backup})`);
    else lines.push(`remove   ${s.target}`);
  }
  if (plan.shim) lines.push(`write    ${plan.shim.path}`);
  return lines;
}
