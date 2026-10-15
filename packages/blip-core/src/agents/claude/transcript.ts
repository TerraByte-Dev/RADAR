import { open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

/**
 * Reading a Claude Code session transcript (one JSON object per line) for the two facts the
 * Stop hook needs: which files the session edited, and which shell commands it ran. Tool
 * results are never read, and nothing but `tool_use` blocks is parsed.
 */

export type ToolCall = (
  | { kind: 'edit'; path: string; at: string | null }
  /** `dir` is where the command ran: its leading `cd`, or `git -C`, or the session's folder at the time. */
  | { kind: 'shell'; dir: string | null; commit: boolean; at: string | null }
) & {
  /** The offset just after the call's line: a scan that stops before the next line resumes here. */
  next: number;
};

export interface Scan {
  calls: ToolCall[];
  /** The offset after the last complete line: where the next scan starts. */
  end: number;
  /** Bytes read from the file by this scan. */
  bytesRead: number;
}

const FILE_TOOLS: Record<string, string> = { Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const CHUNK = 1 << 20;

/** A commit, in one command of a shell line (spec 5.2). */
export const COMMIT_RE = /\bgit\b[^|;&]*\bcommit\b/;
const CD_RE = /^\s*(?:cd|Set-Location|pushd)(?:\s+\/d)?\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;|\|\||$)/i;
const GIT_C_RE = /\bgit\s+-C\s+("[^"]+"|'[^']+'|[^\s;&|]+)[^|;&]*\bcommit\b/;

/** A path as a shell wrote it, as a native absolute path: quotes off, Git Bash's `/c/…` made `C:\…`, relative to `base`. */
function shellPath(raw: string, base: string | null): string | null {
  let p = raw.replace(/^(["'])(.*)\1$/, '$2');
  if (process.platform === 'win32') {
    const drive = /^\/([a-z])(?=\/|$)/i.exec(p);
    if (drive) p = `${drive[1]!.toUpperCase()}:${p.slice(2) || '/'}`;
  }
  if (isAbsolute(p)) return resolve(p);
  return base === null || p.startsWith('~') || p.startsWith('$') ? null : resolve(base, p);
}

function shellCall(command: string, cwd: string | null, at: string | null, next: number): ToolCall {
  const commit = COMMIT_RE.test(command);
  const gitC = commit ? GIT_C_RE.exec(command) : null;
  const cd = CD_RE.exec(command);
  const dir = (gitC && shellPath(gitC[1]!, cwd)) ?? (cd && shellPath(cd[1]!, cwd)) ?? cwd;
  return { kind: 'shell', dir, commit, at, next };
}

function callsOf(line: string, next: number, out: ToolCall[]): void {
  if (!line.includes('"tool_use"')) return;
  let e: { timestamp?: unknown; cwd?: unknown; message?: { content?: unknown } };
  try {
    e = JSON.parse(line) as typeof e;
  } catch {
    return; // a torn or damaged line
  }
  const content = e?.message?.content;
  if (!Array.isArray(content)) return;
  const at = typeof e.timestamp === 'string' ? e.timestamp : null;
  const cwd = typeof e.cwd === 'string' && isAbsolute(e.cwd) ? e.cwd : null;
  for (const block of content as { type?: unknown; name?: unknown; input?: Record<string, unknown> }[]) {
    if (!block || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
    const key = FILE_TOOLS[block.name];
    if (key) {
      const p = block.input?.[key];
      if (typeof p !== 'string' || !p) continue;
      const path = isAbsolute(p) ? resolve(p) : cwd === null ? null : resolve(cwd, p);
      if (path !== null) out.push({ kind: 'edit', path, at, next });
    } else if (SHELL_TOOLS.has(block.name)) {
      const command = block.input?.command;
      if (typeof command === 'string') out.push(shellCall(command, cwd, at, next));
    }
  }
}

/**
 * The tool calls in `path` from byte `from` to the last complete line. A file shorter than
 * `from` was replaced, and is read from the start. Only the bytes after `from` are read.
 */
export async function scanTranscript(path: string, from: number): Promise<Scan> {
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    let pos = size < from ? 0 : from;
    const calls: ToolCall[] = [];
    let bytesRead = 0;
    let carry = Buffer.alloc(0);
    let end = pos;
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
      const { bytesRead: n } = await fh.read(buf, 0, buf.length, pos);
      if (n === 0) break;
      bytesRead += n;
      pos += n;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const last = data.lastIndexOf(0x0a);
      if (last === -1) {
        carry = Buffer.from(data);
        continue;
      }
      const base = pos - data.length; // the file offset of data[0]
      for (let at = 0; at <= last; ) {
        const nl = data.indexOf(0x0a, at);
        callsOf(data.subarray(at, nl).toString('utf8'), base + nl + 1, calls);
        at = nl + 1;
      }
      end = base + last + 1;
      carry = Buffer.from(data.subarray(last + 1));
    }
    return { calls, end, bytesRead };
  } finally {
    await fh.close();
  }
}
