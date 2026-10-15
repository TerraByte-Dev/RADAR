import { userInfo } from 'node:os';
import { relative, resolve } from 'node:path';
import type { ParseArgsConfig } from 'node:util';
import type { ReportLine } from '../core/edit.js';
import { BlipError, type BlipDoc } from '../core/schema.js';
import { gitUserName, systemGit } from '../git.js';
import type { UpdateResult } from '../io.js';
import { mainCheckoutPath, resolveProject } from '../paths.js';

export type Options = NonNullable<ParseArgsConfig['options']>;

export interface Args {
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  positionals: string[];
}

/** What a command hands back: `data` for `--json`, `lines` for a person, and an exit code when it is not 0. */
export interface Outcome {
  data: unknown;
  lines: string[];
  exit?: number;
}

export interface Command {
  /** The arguments after the command name, as shown in usage. */
  usage: string;
  summary: string;
  options?: Options;
  /** How many positional arguments the command takes (default: none). */
  positionals?: { min: number; max: number };
  run(args: Args): Promise<Outcome>;
}

/** On every project command. */
export const PROJECT_OPTIONS: Options = { path: { type: 'string' }, json: { type: 'boolean' } };

/** A mistake in how the command was typed: exit 1 and usage. */
export function usageError(message: string): BlipError {
  return new BlipError('E_USAGE', message);
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
export const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** There is no project at `start` or above it: exit 2. */
export function noProject(start: string): BlipError {
  return new BlipError('E_NO_PROJECT', `no BLIP.md in ${start} or any folder above it`, { hint: 'run "radar-blip init" there to start tracking it', path: start });
}

/** The project `--path` (or the current folder) belongs to. */
export function projectDir(args: Args): string {
  const start = str(args.values.path) ?? process.cwd();
  const dir = resolveProject(start);
  if (!dir) throw noProject(start);
  return dir;
}

/**
 * The project's folder in the linked worktree the command was started in (`--path`, else the
 * cwd), when it was: the project is the main checkout's, but the agent's branch and edits are there.
 */
export function worktreeOf(args: Args, dir: string): string | undefined {
  const start = resolve(str(args.values.path) ?? process.cwd());
  const mapped = mainCheckoutPath(start);
  return mapped ? resolve(start, relative(mapped, dir)) : undefined;
}

/** The line that says the registry could not be read as it is, for a command that works from the list of projects. */
export function registryWarning(warning: string | null): string[] {
  return warning ? [`! registry: ${warning}`] : [];
}

/**
 * Who is writing: the git user name for this folder, else the OS user. Git runs through
 * the hardened runner, never with the project as its working folder.
 */
export async function detectAuthor(dir: string): Promise<string> {
  const name = await gitUserName(systemGit(), dir);
  if (name) return name;
  try {
    return userInfo().username.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

const MARK: Record<ReportLine['kind'], string> = {
  done: '✔ done     ',
  reopened: '↺ reopened ',
  added: '+ added    ',
  edited: '✎ edited   ',
  moved: '↕ moved    ',
  removed: '✕ removed (copy kept) ',
  set: '= set      ',
  logged: '▸ logged   ',
  skipped: '· skipped  ',
  tidied: '~ tidied   ',
  warn: '! ',
};

export function reportLines(report: readonly ReportLine[]): string[] {
  return report.map((r) => {
    if (r.kind === 'warn') return `${MARK.warn}${r.code}: ${r.text}`;
    if (r.kind === 'moved' && r.top) return `↑ top      ${r.text}`;
    if (r.kind === 'added' && r.top) return `${MARK.added}${r.text} (top)`;
    if (r.kind === 'edited' && r.kept) return `${MARK.edited}${r.text} (old detail kept)`;
    if (r.kind === 'logged') return `${MARK.logged}${r.text} line${r.text === '1' ? '' : 's'}`;
    return `${MARK[r.kind]}${r.text}`;
  });
}

/** The outcome of a write command: what changed, then whatever the registry had to say. */
export function writeOutcome(res: UpdateResult, extra: Record<string, unknown> = {}): Outcome {
  const lines = reportLines(res.report);
  if (!res.changed && !res.report.length) lines.push('· nothing to change');
  if (res.registry) lines.push(res.registry);
  return { data: { changed: res.changed, report: res.report, rev: res.rev, registry: res.registry, ...extra }, lines };
}

/** The whole project for a person to read. */
export function renderDoc(doc: BlipDoc, dir: string): string[] {
  const out: string[] = [`${doc.name}${doc.focus ? '  ★' : ''}  [${doc.status}]`, dir];
  out.push(`now   ${doc.now ?? '(not set)'}`);
  if (doc.due) out.push(`due   ${doc.due}`);
  if (doc.tags.length) out.push(`tags  ${doc.tags.join(', ')}`);
  for (const l of doc.links) out.push(`link  ${l.label ? `${l.label}: ` : ''}${l.url}`);
  out.push('', `Tasks (${doc.tasks.open.length} open, ${doc.tasks.done.length} done)`);
  for (const t of doc.tasks.open) {
    out.push(`${String(t.n).padStart(3)}. ${t.title}${t.due ? `  (due ${t.due})` : ''}`);
    for (const d of t.detail) out.push(`       ${d}`);
  }
  for (const t of doc.tasks.done) out.push(`   ✔ ${t.title}${t.doneOn ? `  (${t.doneOn})` : ''}`);
  out.push('', `Log (${doc.log.length} entr${doc.log.length === 1 ? 'y' : 'ies'})`);
  for (const e of doc.log) {
    out.push(`  ${e.heading}`);
    for (const l of e.lines) out.push(`    ${l}`);
  }
  if (!doc.writable) out.push('', 'read-only: see "radar-blip lint"');
  else if (doc.problems.length) out.push('', `${doc.problems.length} warning${doc.problems.length === 1 ? '' : 's'}: radar-blip lint`);
  return out;
}
