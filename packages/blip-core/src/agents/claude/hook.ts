import { dirname, join, relative, resolve } from 'node:path';
import { computeActivity } from '../../activity.js';
import type { BlipDoc } from '../../core/schema.js';
import type { Git } from '../../git.js';
import { readProject } from '../../io.js';
import { withLock } from '../../lock.js';
import { dataDir, mainCheckoutPath, projectId, projectKey, resolveProject } from '../../paths.js';
import { defaultTargets, setupStale } from '../../setup.js';
import { readState, writeState, type ProjectState } from '../../state.js';
import { SESSION_ID_RE, deleteMarker, readMarker, sweepMarkers, writeMarker, type SessionMarker, type SessionProject } from './live.js';
import { scanTranscript } from './transcript.js';

/**
 * `radar-blip hook <event>`: the Claude Code hooks (spec 5.2). Every path is fail-open: any
 * error means no output, and the CLI exits 0 whatever happens, so a hook can never block or
 * break a session it does not understand.
 */

export type HookEventName = 'session-start' | 'stop' | 'session-end';

export interface HookOptions {
  now?: Date;
  git?: Git | null;
  /** Told how many transcript bytes each Stop read (tests check the read is incremental). */
  onRead?: (bytes: number) => void;
  /** Time the Stop hook spends on transcript calls before it saves its place and moves on. */
  scanBudgetMs?: number;
}

/** Minimum time between two nudges for one project, from any session. */
export const NUDGE_FLOOR_MS = 20 * 60 * 1000;
/** Edited files that make a nudge on their own, without a commit. */
const FILES_TO_NUDGE = 3;
/**
 * Time for the transcript calls of one Stop. A long transcript read from its start (a resumed
 * session) can hold more than one hook's 10 s allows: the rest is read by the next Stop.
 */
const SCAN_BUDGET_MS = 3000;

interface Input {
  sessionId: string;
  cwd: string;
  transcriptPath: string;
  stopHookActive: boolean;
}

function parseInput(stdin: string): Input | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  const o = raw as { session_id?: unknown; cwd?: unknown; transcript_path?: unknown; stop_hook_active?: unknown } | null;
  if (!o || typeof o !== 'object' || typeof o.session_id !== 'string' || !SESSION_ID_RE.test(o.session_id)) return null;
  return {
    sessionId: o.session_id,
    cwd: typeof o.cwd === 'string' ? o.cwd : '',
    transcriptPath: typeof o.transcript_path === 'string' ? o.transcript_path : '',
    stopHookActive: o.stop_hook_active === true,
  };
}

const later = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : Date.parse(a) >= Date.parse(b) ? a : b);
/** Work up to here is covered: the last sync, or the last nudge (a re-nudge needs new work). */
const baselineOf = (s: ProjectState): string | null => later(s.lastSyncAt, s.lastNudgeAt);
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const lockPath = (dir: string): string => join(dataDir(), 'locks', `${projectId(dir)}.lock`);

/** The project's document when it is one a hook speaks about: a v3 file that can be written, or a v2 one. */
async function docOf(dir: string): Promise<BlipDoc | null> {
  try {
    const doc = (await readProject(dir)).file.doc();
    return doc.schema === 2 || doc.writable ? doc : null;
  } catch {
    return null;
  }
}

/**
 * The folder to name in a command for the project in `dir`: its folder in the linked
 * worktree the session works in (the first of `places` inside one), else `dir`. The CLI
 * maps it back to the main checkout's BLIP.md, and brief then reports the worktree's
 * branch and uncommitted work, not the main checkout's.
 */
function pathFor(dir: string, places: readonly string[]): string {
  for (const place of places) {
    const mapped = mainCheckoutPath(place);
    if (mapped !== null && resolveProject(place) === dir) return resolve(place, relative(mapped, dir));
  }
  return dir;
}

/** What has not been logged, in words: "2 commits, 3 edited files". */
function workText(commits: number, files: number, gitProject: boolean): string {
  const parts = [];
  if (commits) parts.push(plural(commits, 'commit'));
  if (files) parts.push(gitProject ? plural(files, 'edited file') : plural(files, 'changed file'));
  return parts.join(', ');
}

/** The session's marker, new or merged: counts and projects are kept; the folder and transcript are the latest. */
async function openMarker(input: Input, now: Date): Promise<SessionMarker> {
  const marker = (await readMarker(input.sessionId)) ?? { sessionId: input.sessionId, cwd: input.cwd, transcriptPath: input.transcriptPath, startedAt: now.toISOString(), scannedBytes: 0, projects: {} };
  marker.cwd = input.cwd || marker.cwd;
  if (input.transcriptPath && input.transcriptPath !== marker.transcriptPath) {
    marker.transcriptPath = input.transcriptPath;
    marker.scannedBytes = 0; // another file: what was read of the old one says nothing about it
  }
  return marker;
}

async function sessionStart(input: Input, opts: HookOptions): Promise<string> {
  const now = opts.now ?? new Date();
  await sweepMarkers(now);
  await writeMarker(await openMarker(input, now));

  const dir = input.cwd ? resolveProject(input.cwd) : null;
  if (!dir) return '';
  const doc = await docOf(dir);
  if (!doc) return '';
  const setup = setupStale(defaultTargets()) ? ' RADAR setup is out of date: tell the owner to run radar-blip setup.' : '';
  let text: string;
  if (doc.schema === 2) {
    text = `RADAR — ${doc.name}. Its BLIP.md is in the old v2 format and cannot be updated until the owner runs radar-blip migrate (do not run it yourself).${setup}`;
  } else {
    const state = await readState(projectId(dir));
    const a = await computeActivity(dir, { lastLogAt: doc.lastLogAt, lastSyncAt: state.lastSyncAt, dirtyAtSync: state.dirtyAtSync, now, ...(opts.git === undefined ? {} : { git: opts.git }) });
    const commits = a.drift.commits ?? 0;
    const files = a.drift.files ?? 0;
    const work = workText(commits, files, a.source === 'git') || 'Uncommitted changes';
    const verb = commits + files === 1 ? 'is' : 'are';
    const catchUp = a.unlogged ? ` ${work} ${verb} not in the log: run radar-blip brief --path "${pathFor(dir, [input.cwd])}" and sync before starting new work.` : '';
    text = `RADAR — ${doc.name}. Now: ${doc.now?.replace(/\.$/, '') ?? 'not set'}. Next: ${doc.next?.title ?? 'nothing queued'}.${catchUp}${setup}`;
  }
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
}

async function stop(input: Input, opts: HookOptions): Promise<string> {
  if (input.stopHookActive) return '';
  const now = opts.now ?? new Date();
  const marker = await openMarker(input, now);

  const states = new Map<string, ProjectState>();
  const stateOf = async (dir: string): Promise<ProjectState> => {
    let s = states.get(dir);
    if (!s) states.set(dir, (s = await readState(projectId(dir))));
    return s;
  };
  const resolved = new Map<string, string | null>();
  const projectOf = (folder: string): string | null => {
    if (!resolved.has(folder)) resolved.set(folder, resolveProject(folder));
    return resolved.get(folder)!;
  };

  // 3. A sync or a nudge since the evidence was gathered covers it.
  for (const [dir, p] of Object.entries(marker.projects)) {
    const base = baselineOf(await stateOf(dir));
    if (base !== null && Date.parse(base) > Date.parse(p.since)) marker.projects[dir] = { files: [], committed: false, ran: false, since: base };
  }

  // 2. What the session did since the last Stop.
  if (marker.transcriptPath) {
    try {
      const started = performance.now();
      const budget = opts.scanBudgetMs ?? SCAN_BUDGET_MS;
      const scan = await scanTranscript(marker.transcriptPath, marker.scannedBytes);
      opts.onRead?.(scan.bytesRead);
      // Each edited file's key once per run, and each project's listed keys once: never files × edits.
      const keys = new Map<string, Set<string>>();
      const keysOf = (dir: string, entry: SessionProject): Set<string> => {
        let k = keys.get(dir);
        if (!k) keys.set(dir, (k = new Set(entry.files.map((f) => projectKey(f)))));
        return k;
      };
      let end = scan.end;
      for (const [i, call] of scan.calls.entries()) {
        const prev = scan.calls[i - 1];
        // Out of time: stop between two lines, so what is saved is whole lines read.
        if (prev && prev.next !== call.next && performance.now() - started > budget) {
          end = prev.next;
          break;
        }
        const folder = call.kind === 'edit' ? dirname(call.path) : call.dir;
        const dir = folder === null ? null : projectOf(folder);
        if (dir === null) continue;
        const base = baselineOf(await stateOf(dir));
        if (call.at !== null && base !== null && Date.parse(call.at) <= Date.parse(base)) continue;
        const entry: SessionProject = (marker.projects[dir] ??= { files: [], committed: false, ran: false, since: base ?? call.at ?? now.toISOString() });
        if (call.kind === 'edit') {
          const listed = keysOf(dir, entry);
          const key = projectKey(call.path);
          if (!listed.has(key)) {
            listed.add(key);
            entry.files.push(call.path);
          }
        } else {
          entry.ran = true;
          if (call.commit) entry.committed = true;
        }
      }
      marker.scannedBytes = end;
    } catch {
      // no transcript yet, or it cannot be read: judge on what the marker already holds
    }
  }
  await writeMarker(marker);

  // 4–6. Projects this session has evidence for, and enough unlogged work in each.
  // A session that only started in a folder, or only read there, has no evidence: in a folder
  // without git the drift may be the owner's own edits, which the agent cannot describe.
  let best: { dir: string; doc: BlipDoc; text: string; score: number } | null = null;
  for (const [dir, entry] of Object.entries(marker.projects)) {
    if (!entry.files.length && !entry.committed && !entry.ran) continue;
    const state = await stateOf(dir);
    if (state.lastNudgeAt !== null && now.getTime() - Date.parse(state.lastNudgeAt) < NUDGE_FLOOR_MS) continue;
    const doc = await docOf(dir);
    if (!doc) continue;
    if (doc.schema === 2 && state.lastNudgeAt !== null) continue; // the owner is told to migrate once, not every 20 minutes
    const a = await computeActivity(dir, { lastLogAt: doc.lastLogAt, lastSyncAt: baselineOf(state), dirtyAtSync: state.dirtyAtSync, now, ...(opts.git === undefined ? {} : { git: opts.git }) });
    let commits = 0;
    let files: number;
    if (a.source === 'git') {
      if (!entry.files.length && !entry.committed) continue; // a read-only session, whatever the repo's drift
      commits = a.drift.commits ?? 0;
      files = entry.files.length;
    } else {
      // No git: shell commands, scripts and subagents write here unseen, so having run a command here is the evidence.
      files = Math.max(entry.files.length, a.drift.files ?? 0);
    }
    if (commits < 1 && files < FILES_TO_NUDGE) continue;
    const score = commits * 3 + files;
    if (best === null || score > best.score) best = { dir, doc, text: workText(commits, files, a.source === 'git'), score };
  }
  if (best === null) return '';

  // 7. One nudge, recorded for every session.
  const { dir, doc, text } = best;
  const at = pathFor(dir, [marker.cwd, ...(marker.projects[dir]?.files ?? []).map((f) => dirname(f))].filter(Boolean));
  await withLock(lockPath(dir), () => writeState(projectId(dir), { lastNudgeAt: now.toISOString() }));
  if (doc.schema === 2) {
    return JSON.stringify({ systemMessage: `RADAR: ${doc.name} has ${text} not in its log, but its BLIP.md is in the old v2 format. Run radar-blip migrate --path "${dir}" to start logging again.` });
  }
  return JSON.stringify({
    decision: 'block',
    reason:
      `RADAR: ${doc.name} has ${text} not in its log. Run: radar-blip brief --path "${at}"  — then write the payload to the payloadPath it prints ` +
      `and run: radar-blip sync --agent Claude --path "${at}" --file "<payloadPath>"  — then stop. If nothing is worth logging, write {} to that payloadPath and run the same sync command.`,
  });
}

/** Run one hook. Returns what to print on stdout ('' for nothing). Never throws. */
export async function runHook(event: string, stdin: string, opts: HookOptions = {}): Promise<string> {
  try {
    const input = parseInput(stdin);
    if (!input) return '';
    if (event === 'session-start') return await sessionStart(input, opts);
    if (event === 'stop') return await stop(input, opts);
    if (event === 'session-end') await deleteMarker(input.sessionId);
    return '';
  } catch {
    return '';
  }
}
