import { readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BlipError } from '../../core/schema.js';
import { parseSyncPayload } from '../../core/sync.js';
import { syncProject } from '../../io.js';
import { dataDir } from '../../paths.js';
import { PROJECT_OPTIONS, detectAuthor, projectDir, reportLines, str, usageError, worktreeOf, type Command } from '../shared.js';

const AGENT_MAX = 16;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

export const sync: Command = {
  usage: '(--file PATH | -) [--agent NAME] [--dry-run] [--path DIR] [--json]',
  summary: 'apply one JSON payload from an agent: log, now, and task changes ("-" reads it from stdin)',
  options: { ...PROJECT_OPTIONS, file: { type: 'string' }, agent: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  positionals: { min: 0, max: 1 },
  async run(args) {
    const file = str(args.values.file);
    const stdin = args.positionals[0] === '-';
    if (args.positionals.length && !stdin) throw usageError(`unexpected argument "${args.positionals[0]}"`);
    if ((file !== undefined) === stdin) throw usageError('give the payload with --file PATH, or "-" to read it from stdin');
    const agent = str(args.values.agent);
    if (agent !== undefined && Array.from(agent).length > AGENT_MAX) throw usageError(`--agent is at most ${AGENT_MAX} characters`);
    const dryRun = args.values['dry-run'] === true;
    const dir = projectDir(args);

    let text: string;
    try {
      text = file === undefined ? await readStdin() : await readFile(file, 'utf8');
    } catch (err) {
      throw new BlipError('E_PAYLOAD_FILE', `the payload file given with --file cannot be read (${err instanceof Error ? err.message : String(err)})`, {
        hint: 'check the path, or pipe the payload in: radar-blip sync -',
        ...(file === undefined ? {} : { path: file }),
      });
    }
    let json: unknown;
    try {
      json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (err) {
      throw new BlipError('E_PAYLOAD_JSON', `the payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const opts: Parameters<typeof syncProject>[2] = { author: await detectAuthor(dir), dryRun };
    if (agent !== undefined) opts.agent = agent;
    const worktree = worktreeOf(args, dir);
    if (worktree !== undefined) opts.worktree = worktree;
    const res = await syncProject(dir, parseSyncPayload(json), opts);

    if (file !== undefined && !dryRun) {
      // A payload written where `brief` said to write it is used once.
      const rel = relative(join(dataDir(), 'tmp'), resolve(file));
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) await unlink(file).catch(() => {});
    }

    const lines = dryRun ? ['dry run — nothing was written'] : [];
    lines.push(...reportLines(res.report));
    if (!res.report.length) lines.push('· acknowledged, nothing to log');
    const shown = new Set(res.report.filter((r) => r.kind === 'warn').map((r) => r.code));
    const older = res.doc.problems.filter((p) => !shown.has(p.code)).length;
    if (older) lines.push(`${older} older warning${older === 1 ? '' : 's'} in this file: radar-blip lint`);
    if (res.registry) lines.push(res.registry);
    return { data: { changed: res.changed, dryRun, report: res.report, rev: res.rev, registry: res.registry }, lines };
  },
};
