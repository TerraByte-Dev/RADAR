import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * AI coding-session transcripts → a compact digest a model can reconcile against a BLIP.md.
 *
 * This is the "what actually happened" half of `radar-blip sync`: RADAR's whole premise is
 * that project state is a *byproduct* of the work, so the tooling should be able to read the
 * work rather than rely on the agent remembering it. Claude Code writes one JSONL file per
 * session under `~/.claude/projects/<slug>/<sessionId>.jsonl`, where `<slug>` is the session's
 * cwd with every non-alphanumeric character replaced by `-`.
 *
 * We deliberately keep only high-signal, low-volume facts — the user's prompts, the files
 * written, the commands run, the commits made. Assistant prose and thinking are the bulk of a
 * transcript (they run to megabytes) and say least about what changed on disk.
 */

/** `C:\Users\t\Dev\My App` → `C--Users-t-Dev-My-App`. Claude Code's per-cwd directory name. */
export function slugForPath(dir: string): string {
  return resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
}

export function claudeProjectsDir(home = homedir()): string {
  return join(home, '.claude', 'projects');
}

export interface SessionDigest {
  sessionId: string;
  /** The transcript file, so a caller can go deeper if it wants to. */
  file: string;
  start?: string;
  end?: string;
  cwd?: string;
  gitBranch?: string;
  prompts: string[];
  filesTouched: string[];
  commands: string[];
  commits: string[];
  /** Entries skipped because they predate `--since`. */
  skippedBefore: number;
  /** Files this session wrote outside the project — counted, never named. */
  filesOutside: number;
  /**
   * `project` — the agent ran inside this project (or a subfolder of it).
   * `ancestor` — it ran from a parent folder (a workspace root) but wrote files in here, so the
   * session is only *partly* about this project. Kept, but flagged, and trimmed to the files
   * that actually landed in it.
   */
  scope: 'project' | 'ancestor';
}

export interface SessionsOptions {
  /** Only consider entries at or after this ISO timestamp. */
  since?: string;
  /** Keep at most this many sessions, most recent first. */
  limit?: number;
  /** Truncate each prompt/command to this many characters. */
  maxChars?: number;
  home?: string;
}

const DEFAULTS = { limit: 8, maxChars: 300 };
/** Per-session caps — a digest is a summary, not an archive. */
const CAP = { prompts: 12, files: 30, commands: 12, commits: 20, commandChars: 160 };

/** Tool calls whose input names a file we consider "touched". */
const FILE_TOOLS: Record<string, string> = {
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
};
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * Commands worth remembering: ones that *change* something or prove something.
 * Reading around (ls/cat/grep/find/…) is how an agent thinks, not what it did, and it
 * dominates a transcript by volume — keeping it would bury the two lines that matter.
 */
const CONSEQUENTIAL =
  /(^|[|;&]\s*|\bnpx\s+(?:-[\w-]+\s+)*)(radar-blip|git|npm|pnpm|yarn|bun|node|python3?|pytest|cargo|go|make|docker|gh|vitest|jest|tsc|eas|vercel)\b/;
const READ_ONLY_GIT = /^git\s+(status|log|diff|show|branch|remote|rev-parse|config)\b/;

/**
 * Did this command write a BLIP.md through the engine? Covers every form the skills teach:
 * `radar-blip sync`, `npx -y radar-blip handoff`, and the from-source `npm run blip -- sync`.
 * The Stop hook uses it to shut up about a session that already logged itself.
 */
export function isBlipWrite(command: string): boolean {
  return /(?:radar-blip|run\s+blip)\s+(?:(?:--|-\w+|\S*=\S*)\s+)*(sync|handoff)\b/.test(command);
}

/**
 * Blunt, deliberately over-eager redaction of anything token-shaped. A digest is fed to a
 * model and may end up quoted into a session log that gets committed, so a false positive
 * (a mangled command) is far cheaper than a leaked key.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic / Stripe style
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub classic PAT / OAuth / refresh
  /\bnpm_[A-Za-z0-9]{30,}/g, // npm automation + granular tokens
  /\bglpat-[A-Za-z0-9_-]{16,}/g, // GitLab PAT
  /\bpypi-[A-Za-z0-9_-]{16,}/g, // PyPI upload token
  /\bdop_v1_[a-f0-9]{32,}/g, // DigitalOcean
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /(--(?:password|token|api[-_]?key|secret)[= ])\S+/gi,
  /((?:AUTHORIZATION|BEARER|PASSWORD|SECRET|TOKEN|API[_-]?KEY)\s*[:=]\s*)\S+/gi,
  // Last resort: an `_authToken=` / `:_auth=` assignment of any shape (npmrc, pip.conf, …).
  /((?:_authToken|_auth|_password)\s*=\s*)\S+/gi,
];

export function redact(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m, prefix?: string) => `${prefix ?? ''}«redacted»`);
  return out;
}

function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Drop the `cd …/Set-Location …` preamble agents prefix onto everything — it's never the point. */
function stripCd(cmd: string): string {
  return cmd.replace(/^\s*(?:cd|Set-Location)\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/i, '');
}

/**
 * A project-relative path, or null when the file lives outside the project. Both halves matter:
 * absolute paths are mostly repeated prefix, and a file in someone else's repo (or a scratchpad)
 * is not this project's work — leaking it into a digest risks it being quoted into a committed
 * session log.
 */
function shortPath(p: string, base: string): string | null {
  const rel = relative(base, resolve(p));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split('\\').join('/');
}

/** Pull the plain text out of an Anthropic message `content` (string or block array). */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: string; text: string } => !!b && typeof b === 'object' && (b as { type?: string }).type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** `git commit -m "subject"` / `-m subject` → the subject line, for the commits list. */
function commitSubject(command: string): string | null {
  if (!/\bgit\b[\s\S]*\bcommit\b/.test(command)) return null;
  const m = /-m\s+(?:"([^"]{1,200})"|'([^']{1,200})'|(\S{1,200}))/.exec(command);
  const subject = m?.[1] ?? m?.[2] ?? m?.[3];
  return subject ? subject.split(/\r?\n/)[0]!.trim() : '(commit)';
}

/** Push unless already present or the list is full — transcripts repeat themselves constantly. */
function pushUnique(list: string[], value: string, cap: number): void {
  if (value && list.length < cap && !list.includes(value)) list.push(value);
}

async function digestFile(
  file: string,
  opts: { maxChars: number; since?: string; base: string },
): Promise<SessionDigest> {
  const d: SessionDigest = {
    sessionId: basename(file).replace(/\.jsonl$/, ''),
    file,
    prompts: [],
    filesTouched: [],
    commands: [],
    commits: [],
    skippedBefore: 0,
    filesOutside: 0,
    scope: 'project',
  };
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // a torn last line on a live session, or a corrupt entry — skip it
      }
      const ts = typeof e.timestamp === 'string' ? e.timestamp : undefined;
      if (ts) {
        if (opts.since && ts < opts.since) {
          d.skippedBefore++;
          continue;
        }
        if (!d.start || ts < d.start) d.start = ts;
        if (!d.end || ts > d.end) d.end = ts;
      }
      if (typeof e.cwd === 'string' && !d.cwd) d.cwd = e.cwd;
      if (typeof e.gitBranch === 'string' && e.gitBranch !== 'HEAD') d.gitBranch = e.gitBranch;

      const message = e.message as { content?: unknown } | undefined;
      if (e.type === 'user' && !e.isMeta && !e.isSidechain && message) {
        const text = messageText(message.content);
        // Local-command wrappers and tool results are machinery, not something the user asked for.
        if (text && !text.startsWith('<local-command') && !text.startsWith('<command-')) {
          pushUnique(d.prompts, clip(redact(text), opts.maxChars), CAP.prompts);
        }
      } else if (e.type === 'assistant' && message && Array.isArray(message.content)) {
        for (const block of message.content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
          if (!block || block.type !== 'tool_use' || !block.name) continue;
          const key = FILE_TOOLS[block.name];
          if (key) {
            const p = block.input?.[key];
            if (typeof p === 'string') {
              const rel = shortPath(p, opts.base);
              if (rel) pushUnique(d.filesTouched, rel, CAP.files);
              else d.filesOutside++;
            }
          } else if (SHELL_TOOLS.has(block.name)) {
            const cmd = block.input?.command;
            if (typeof cmd !== 'string') continue;
            const subject = commitSubject(cmd);
            if (subject) pushUnique(d.commits, clip(redact(subject), opts.maxChars), CAP.commits);
            const flat = clip(stripCd(redact(cmd)), CAP.commandChars);
            if (CONSEQUENTIAL.test(flat) && !READ_ONLY_GIT.test(flat)) {
              pushUnique(d.commands, flat, CAP.commands);
            }
          }
        }
      }
    }
  } finally {
    // `destroy`, not `close`: readline's close leaves the fd open, and on Windows a lingering
    // handle blocks the directory from being removed by whoever owns it.
    rl.close();
    stream.destroy();
  }
  return d;
}

/** Every ancestor of `dir`, nearest first — where a workspace-rooted agent session would be filed. */
function ancestors(dir: string): string[] {
  const out: string[] = [];
  let cur = resolve(dir);
  for (let parent = dirname(cur); parent !== cur; parent = dirname(cur)) {
    cur = parent;
    out.push(cur);
  }
  return out;
}

async function transcriptsIn(root: string, dirNames: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const d of dirNames) {
    let names: string[];
    try {
      names = await readdir(join(root, d));
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith('.jsonl')) files.push(join(root, d, n));
  }
  return files;
}

/**
 * Digest the Claude Code sessions that worked on `dir`, newest first.
 *
 * Sessions are filed by the *cwd the agent ran in*, which is often not the project folder —
 * people open one agent at a workspace root and work across several repos from there. So we
 * look in three places, in order of confidence: the project's own slug, slugs beneath it
 * (an agent run from a subfolder), and — only if those turn up nothing — its ancestors,
 * keeping just the sessions that actually wrote files inside this project.
 */
export async function readSessions(dir: string, options: SessionsOptions = {}): Promise<SessionDigest[]> {
  const { since, limit = DEFAULTS.limit, maxChars = DEFAULTS.maxChars, home } = options;
  const root = claudeProjectsDir(home);
  const slug = slugForPath(dir);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return []; // no Claude Code history on this machine
  }

  const base = resolve(dir);
  const digest = async (files: string[]): Promise<SessionDigest[]> => {
    const out: SessionDigest[] = [];
    for (const f of files) {
      try {
        out.push(await digestFile(f, { since, maxChars, base }));
      } catch {
        // Unreadable transcript (locked, deleted mid-read) — a missing session beats a crash.
      }
    }
    return out.filter((d) => d.end !== undefined);
  };

  const own = new Set(entries.filter((n) => n === slug || n.startsWith(`${slug}-`)));
  let digests = await digest(await transcriptsIn(root, [...own]));

  if (digests.length === 0) {
    const upstream = new Set(ancestors(dir).map(slugForPath).filter((s) => entries.includes(s) && !own.has(s)));
    // `filesTouched` only ever holds paths under `base`, so a non-empty list is exactly the
    // evidence we need: this parent-folder session did work inside this project.
    digests = (await digest(await transcriptsIn(root, [...upstream])))
      .filter((d) => d.filesTouched.length > 0)
      .map((d) => ({ ...d, scope: 'ancestor' as const }));
  }

  return digests.sort((a, b) => (b.end ?? '').localeCompare(a.end ?? '')).slice(0, Math.max(1, limit));
}

/** True when `p` is `root` or sits inside it — used to keep the ancestor label honest. */
function isUnder(p: string, root: string): boolean {
  const rel = relative(root, resolve(p));
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Render digests as the compact plain-text block the `/blip sync` routine reads.
 * `projectDir` is only needed to describe an ancestor-scoped session accurately.
 */
export function formatSessions(digests: SessionDigest[], projectDir = process.cwd()): string {
  if (!digests.length) return 'No Claude Code sessions found for this folder.\n';
  const base = resolve(projectDir);
  const out: string[] = [];
  for (const d of digests) {
    out.push(
      `## session ${d.sessionId.slice(0, 8)}  ${d.start ?? '?'} → ${d.end ?? '?'}` +
        `${d.gitBranch ? `  [${d.gitBranch}]` : ''}` +
        // `cwd` is whatever the session last cd'd to, so it can even be *inside* the project —
        // saying "run from <this project>" while filing it as an ancestor session reads as
        // nonsense. Only name a folder when it is genuinely outside.
        `${d.scope === 'ancestor' ? `  (filed under a parent folder${d.cwd && !isUnder(d.cwd, base) ? `, ${d.cwd}` : ''} — only its work in this project is shown)` : ''}`,
    );
    for (const p of d.prompts) out.push(`  ask: ${p}`);
    for (const f of d.filesTouched) out.push(`  wrote: ${f}`);
    for (const c of d.commits) out.push(`  commit: ${c}`);
    for (const c of d.commands) out.push(`  ran: ${c}`);
    out.push('');
  }
  return out.join('\n');
}
