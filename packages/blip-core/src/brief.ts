import { randomBytes } from 'node:crypto';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { checkoutState, commitSubjects, computeActivity } from './activity.js';
import { CAPS, type BlipStatus, type Problem } from './core/schema.js';
import { gitUserName, systemGit, type Git } from './git.js';
import { readProject } from './io.js';
import { dataDir, projectId } from './paths.js';
import { setupStale } from './setup.js';
import { readState } from './state.js';

/** What an agent reads before it syncs: small enough to read every time, whatever the file's size. */
export interface Brief {
  dir: string;
  /** Integer task refs in a payload are tied to this. */
  rev: string;
  /** First word of the git user name, else the OS user name. */
  owner: string | null;
  /** Where to write the payload; `sync --file` deletes it after use. */
  payloadPath: string;
  name: string;
  now: string | null;
  status: BlipStatus;
  focus: boolean;
  due?: string;
  /** Open tasks in the file, listed or not. */
  open: number;
  /** Every open task by number and title; detail for task 1 only, due only when set. */
  tasks: { n: number; title: string; detail?: string[]; due?: string }[];
  /** Open tasks cut from the end of `tasks` to keep within the size cap. */
  omitted?: number;
  /** The newest two log entries. */
  log: { heading: string; bullets: string[] }[];
  /** Work since the last sync or log entry. */
  since: { at: string | null; commits: number | null; subjects: string[]; files: number | null; dirty: boolean | null; branch: string | null };
  /** Errors, then the ones an agent can fix, then one line counting the rest. */
  problems: Problem[];
  /** What was cut to stay within the cap, by step; absent when nothing was. */
  clipped?: Record<string, number>;
}

/** Codes an agent should see by name even as warnings: each is fixed by a field it may write, or by setup. */
const SHOWN = ['name-missing', 'name-slug', 'now-missing', 'schema-v2', 'setup-stale'];

const LINE_MAX = 200;
const SUBJECTS_MAX = 10;
const PAYLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** The owner's name for the whole app: the first word of git `user.name`, else the OS user name, else null. */
export async function ownerName(git: Git | null = systemGit()): Promise<string | null> {
  const name = (await gitUserName(git, null))?.split(/\s+/)[0];
  if (name) return name;
  try {
    return userInfo().username.trim() || null;
  } catch {
    return null;
  }
}

/** Delete payload files under `<data>/tmp` older than a day: ones written and never synced. */
async function sweepPayloads(tmp: string, now: Date): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(tmp);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((n) => n.endsWith('.json'))
      .map(async (n) => {
        const p = join(tmp, n);
        const s = await stat(p).catch(() => null);
        if (s?.isFile() && now.getTime() - s.mtimeMs > PAYLOAD_TTL_MS) await unlink(p).catch(() => {});
      }),
  );
}

function orderProblems(problems: readonly Problem[]): Problem[] {
  const errors = problems.filter((p) => p.severity === 'error');
  const shown = SHOWN.flatMap((code) => problems.filter((p) => p.severity !== 'error' && p.code === code));
  const rest = problems.length - errors.length - shown.length;
  const out = [...errors, ...shown];
  if (rest > 0) out.push({ code: 'more', severity: 'warn', message: `${rest} more: radar-blip lint`, line: null });
  return out;
}

const cp = (s: string): number => Array.from(s).length;
const clip = (s: string, max: number): string => (cp(s) <= max ? s : `${Array.from(s).slice(0, max - 1).join('')}…`);

/** The bytes `brief --json` prints for this brief. */
export const briefBytes = (b: Brief): number => Buffer.byteLength(`${JSON.stringify({ ok: true, data: b })}\n`, 'utf8');

/**
 * Cut the brief down to `max` bytes of `--json` output, applying each step only when the
 * steps before it were not enough, in the order of spec 3.7. Task 1 — the next step — is
 * never dropped, and its title is clipped only by the last resort.
 */
export function fitBrief(b: Brief, max: number = CAPS.BRIEF_MAX_BYTES): Brief {
  const fits = (): boolean => briefBytes(b) <= max;
  const note = (step: string, n: number): void => {
    if (n > 0) b.clipped = { ...b.clipped, [step]: (b.clipped?.[step] ?? 0) + n };
  };
  const first = b.tasks[0];
  const clipAll = (list: string[], limit: number): number => {
    let n = 0;
    list.forEach((s, i) => {
      if (cp(s) > limit) {
        list[i] = clip(s, limit);
        n++;
      }
    });
    return n;
  };
  const steps: (() => void)[] = [
    // 1. every log bullet and every task-1 detail line to 200 characters
    () => note('lines', b.log.reduce((n, e) => n + clipAll(e.bullets, LINE_MAX), 0) + (first?.detail ? clipAll(first.detail, LINE_MAX) : 0)),
    // 2. task-1 detail to 8 lines
    () => {
      if (first?.detail && first.detail.length > CAPS.DETAIL_LINES_MAX) {
        note('detail', first.detail.length - CAPS.DETAIL_LINES_MAX);
        first.detail = first.detail.slice(0, CAPS.DETAIL_LINES_MAX);
      }
    },
    // 3. the log to the newest entry
    () => {
      note('log', Math.max(0, b.log.length - 1));
      b.log = b.log.slice(0, 1);
    },
    // 4. subjects to 5
    () => {
      note('subjects', Math.max(0, b.since.subjects.length - 5));
      b.since.subjects = b.since.subjects.slice(0, 5);
    },
    // 5. every title but task 1's to 80 characters (a clipped title is no longer a whole-title ref)
    () => {
      let n = 0;
      for (const t of b.tasks.slice(1)) {
        if (cp(t.title) > CAPS.TITLE_MAX) {
          t.title = clip(t.title, CAPS.TITLE_MAX);
          n++;
        }
      }
      note('titles', n);
    },
    // 6. the task list from the tail, never task 1
    () => {
      while (b.tasks.length > 1 && !fits()) {
        b.tasks.pop();
        b.omitted = (b.omitted ?? 0) + 1;
        note('tasks', 1);
      }
    },
    // Beyond the spec's six steps, for a file no agent wrote (a huge hand-edited Now line, heading or detail):
    // everything but task 1's title down to its cap, and the lists that are left to nothing.
    () => {
      b.now = b.now === null ? null : clip(b.now, CAPS.NOW_MAX);
      b.name = clip(b.name, CAPS.NAME_MAX);
      note('log', b.log.length);
      b.log = [];
      note('subjects', b.since.subjects.length);
      b.since.subjects = [];
      if (first?.detail) {
        note('detail', first.detail.length);
        delete first.detail;
      }
      note('problems', b.problems.length);
      b.problems = [];
    },
    // Last resort: task 1's own title.
    () => {
      if (first && cp(first.title) > CAPS.TITLE_MAX) {
        first.title = clip(first.title, CAPS.TITLE_MAX);
        note('titles', 1);
      }
    },
  ];
  for (const step of steps) {
    if (fits()) break;
    step();
  }
  return b;
}

/**
 * The brief for the project in `dir`. Writes nothing but the payload folder under `<data>`,
 * and deletes payload files there older than a day. `worktree`: the same project's folder in
 * the linked worktree the agent works in; the branch and dirt are then that checkout's.
 */
export async function buildBrief(dir: string, opts: { git?: Git | null; now?: Date; worktree?: string } = {}): Promise<Brief> {
  const now = opts.now ?? new Date();
  const git = opts.git === undefined ? systemGit() : opts.git;
  const id = projectId(dir);
  const { file, rev } = await readProject(dir);
  const doc = file.doc();
  const tmp = join(dataDir(), 'tmp');
  await mkdir(tmp, { recursive: true });
  await sweepPayloads(tmp, now);

  const { lastSyncAt, dirtyAtSync } = await readState(id);
  const [activity, owner, here] = await Promise.all([
    computeActivity(dir, { lastLogAt: doc.lastLogAt, lastSyncAt, dirtyAtSync, git, now }),
    ownerName(git),
    opts.worktree === undefined ? null : checkoutState(opts.worktree, git),
  ]);
  const subjects = activity.source === 'git' && (activity.drift.commits ?? 0) > 0 ? await commitSubjects(dir, activity.drift.since, { git, now, max: SUBJECTS_MAX, dirtyAtSync }) : [];

  const brief: Brief = {
    dir,
    rev,
    owner,
    payloadPath: join(tmp, `${id}-${randomBytes(4).toString('hex')}.json`),
    name: doc.name,
    now: doc.now,
    status: doc.status,
    focus: doc.focus,
    ...(doc.due ? { due: doc.due } : {}),
    open: doc.tasks.open.length,
    tasks: doc.tasks.open.map((t, i) => ({
      n: t.n ?? i + 1,
      title: t.title,
      ...(i === 0 && t.detail.length ? { detail: [...t.detail] } : {}),
      ...(t.due ? { due: t.due } : {}),
    })),
    log: doc.log.slice(0, 2).map((e) => ({ heading: e.heading, bullets: [...e.bullets] })),
    since: {
      at: activity.drift.since,
      commits: activity.drift.commits,
      subjects,
      files: activity.drift.files,
      dirty: opts.worktree === undefined ? (activity.git?.dirty ?? null) : (here?.dirty ?? null),
      branch: opts.worktree === undefined ? (activity.git?.branch ?? null) : (here?.branch ?? null),
    },
    problems: orderProblems(
      setupStale()
        ? [...doc.problems, { code: 'setup-stale', severity: 'warn', message: 'the /blip skill or the RADAR hooks on this machine are out of date: tell the owner to run radar-blip setup', line: null }]
        : doc.problems,
    ),
  };
  return fitBrief(brief);
}
