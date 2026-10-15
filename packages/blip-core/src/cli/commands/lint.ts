import type { Problem } from '../../core/schema.js';
import { readProject } from '../../io.js';
import { blipPath } from '../../paths.js';
import { listProjects } from '../../registry.js';
import { PROJECT_OPTIONS, projectDir, registryWarning, type Command } from '../shared.js';

export const lint: Command = {
  usage: '[--all] [--path DIR] [--json]',
  summary: 'report problems in the file (or, with --all, in every tracked project); never rewrites',
  options: { ...PROJECT_OPTIONS, all: { type: 'boolean' } },
  async run(args) {
    const all = args.values.all === true;
    const registry = all ? await listProjects() : null;
    const dirs = registry ? registry.projects.map((p) => p.dir) : [projectDir(args)];
    const files: { dir: string; problems: Problem[] | null }[] = [];
    const lines: string[] = registryWarning(registry?.warning ?? null);
    for (const dir of dirs) {
      let problems: Problem[] | null = null;
      try {
        problems = (await readProject(dir)).file.doc().problems;
      } catch {
        // a tracked project whose file is not there right now
      }
      files.push({ dir, problems });
      if (all) lines.push(`${blipPath(dir)}${problems === null ? '  (missing)' : problems.length ? '' : '  ok'}`);
      for (const p of problems ?? []) {
        lines.push(`${p.line === null ? '    ' : String(p.line).padStart(4)}  ${p.severity === 'error' ? 'error' : 'warn '}  ${p.code}  ${p.message}`);
      }
    }
    if (!all && files[0]!.problems?.length === 0) lines.push('No problems.');
    const errors = files.some((f) => f.problems?.some((p) => p.severity === 'error'));
    return { data: registry ? { files, warning: registry.warning } : { problems: files[0]!.problems }, lines, exit: errors ? 4 : 0 };
  },
};
