import { resolve } from 'node:path';
import { projectKey, resolveProject } from '../../paths.js';
import { findProjects, listProjects, registerProject, setHidden, unregisterProject } from '../../registry.js';
import { noProject, str, usageError, type Command } from '../shared.js';

export const track: Command = {
  usage: '[DIR] [--find | --remove | --hide | --show] [--json]',
  summary: 'the list of tracked projects: add one, --find every project under DIR, --hide / --show one on the board, --remove one from the list',
  options: { json: { type: 'boolean' }, find: { type: 'boolean' }, remove: { type: 'boolean' }, hide: { type: 'boolean' }, show: { type: 'boolean' } },
  positionals: { min: 0, max: 1 },
  async run(args) {
    const modes = ['find', 'remove', 'hide', 'show'].filter((m) => args.values[m] === true);
    if (modes.length > 1) throw usageError(`--${modes[0]} and --${modes[1]} cannot be used together`);
    const start = resolve(str(args.positionals[0]) ?? process.cwd());
    const mode = modes[0];

    if (mode === 'find') {
      const found = await findProjects(start);
      const added: string[] = [];
      const refused: { dir: string; reason: string }[] = [];
      for (const dir of found.dirs) {
        try {
          if (await registerProject(dir)) added.push(dir);
        } catch (err) {
          refused.push({ dir, reason: err instanceof Error ? err.message : String(err) });
        }
      }
      const lines = [`found ${found.dirs.length} project${found.dirs.length === 1 ? '' : 's'} under ${start}; ${added.length} newly tracked`];
      for (const dir of added) lines.push(`+ ${dir}`);
      for (const r of refused) lines.push(`· not tracked: ${r.dir} (${r.reason})`);
      if (found.capped) lines.push(`stopped after ${found.scanned} folders: run it again on a smaller folder`);
      return { data: { found: found.dirs, added, refused, capped: found.capped }, lines };
    }

    // A folder that is itself in the list is the one meant, whether or not its BLIP.md is
    // still there: walking up from a tracked folder that has gone would land on the project
    // above it, and hide or remove that one instead.
    const listed = mode ? (await listProjects()).projects.find((p) => p.key === projectKey(start)) : undefined;

    if (mode === 'remove') {
      // This exists to clear out entries whose folder is gone, so the path is taken as given when nothing resolves.
      const target = listed ? start : (resolveProject(start) ?? start);
      const dir = listed?.dir ?? target;
      const removed = await unregisterProject(target);
      return { data: { dir, removed }, lines: [removed ? `- no longer tracked: ${dir} (its BLIP.md is untouched)` : `· not in the list: ${dir}`] };
    }

    const target = listed ? start : resolveProject(start);
    if (!target) throw noProject(start);
    const dir = listed?.dir ?? target;
    const added = listed ? false : await registerProject(target);
    if (mode === 'hide' || mode === 'show') {
      const hidden = mode === 'hide';
      const changed = await setHidden(target, hidden);
      return { data: { dir, hidden, changed }, lines: [`${changed ? '' : 'already '}${hidden ? 'hidden' : 'shown'}: ${dir}`] };
    }
    return { data: { dir, added }, lines: [`${added ? '+ now tracked' : '· already tracked'}: ${dir}`] };
  },
};
