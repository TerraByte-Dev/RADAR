import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBlip } from './io.js';
import { isBlipWrite, readSessions } from './sessions.js';

/**
 * `radar-blip hook stop` — the automatic half of `/blip sync`.
 *
 * RADAR's premise is that project state is a byproduct of the work, not a chore you remember.
 * A session can still end with the work done and the `BLIP.md` stale, so this runs as a Claude
 * Code **Stop** hook: when a session in a tracked repo ends with real, unlogged work behind it,
 * it asks the agent to sync before it stops. It writes nothing itself — it only knows *that*
 * something happened; the agent supplies the prose.
 *
 * It is deliberately timid. It stays silent unless every condition holds, and any unexpected
 * error exits 0 with no output — a hook that misfires on someone's unrelated repo, or that
 * blocks a session it can't reason about, would be far worse than one that occasionally
 * misses a handoff.
 */

/** Fields we rely on from Claude Code's hook payload. Everything else is ignored. */
interface StopHookInput {
  session_id?: string;
  cwd?: string;
  /** True when this stop was already caused by a hook — the loop guard. */
  stop_hook_active?: boolean;
}

/** One nudge per session, whatever else happens. Belt to `stop_hook_active`'s braces. */
function alreadyNudged(sessionId: string): boolean {
  const dir = join(tmpdir(), 'radar-blip-hook');
  const marker = join(dir, `${sessionId.replace(/[^A-Za-z0-9-]/g, '')}.stop`);
  if (existsSync(marker)) return true;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(marker, '');
  } catch {
    // Can't mark it — better to risk one extra nudge than to crash the user's session.
  }
  return false;
}

/** Did this session actually change anything worth recording? */
function isSubstantive(files: number, commits: number, commands: number): boolean {
  return files > 0 || commits > 0 || commands >= 2;
}

/**
 * Decide whether to nudge. Returns the exact stdout payload Claude Code should receive
 * (`{"decision":"block","reason":…}` keeps the agent going and hands it the reason), or
 * `null` to stay silent. Pure apart from the once-per-session marker, so it's testable.
 */
export async function runStopHook(rawInput: string, home?: string): Promise<string | null> {
  let input: StopHookInput = {};
  try {
    input = JSON.parse(rawInput || '{}') as StopHookInput;
  } catch {
    return null; // not a payload we understand — stay out of the way
  }
  if (input.stop_hook_active) return null; // we already asked; never loop

  const dir = input.cwd ?? process.cwd();
  const file = join(dir, 'BLIP.md');
  if (!existsSync(file)) return null; // not a tracked project — adoption is the user's call

  const blip = await readBlip(file);
  if (blip.fmErrors.length) return null; // signal lost; nagging about it helps nobody
  const since = blip.fields.last_session;

  const sessions = await readSessions(dir, { since, limit: 3, home });
  const files = new Set(sessions.flatMap((s) => s.filesTouched));
  const commits = sessions.flatMap((s) => s.commits);
  const commands = sessions.flatMap((s) => s.commands);
  // Already synced this session? Then the log is current by definition.
  if (commands.some(isBlipWrite)) return null;
  if (!isSubstantive(files.size, commits.length, commands.length)) return null;

  if (input.session_id && alreadyNudged(input.session_id)) return null;

  const open = blip.tasks.filter((t) => !t.done).length;
  const what = [
    files.size ? `${files.size} file(s) changed` : '',
    commits.length ? `${commits.length} commit(s)` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return JSON.stringify({
    decision: 'block',
    reason:
      `This repo is tracked by RADAR and its BLIP.md is stale — ${what} since ` +
      `${since ? `the last logged session (${since.slice(0, 10)})` : 'it was created'}, ` +
      `with ${open} open task(s). Run /blip sync now: reconcile what this session actually did ` +
      `against BLIP.md, check off what got finished, queue the real next steps in order, and ` +
      `log 1-4 bullets — all in one \`radar-blip sync\` call. Then stop.`,
  });
}
