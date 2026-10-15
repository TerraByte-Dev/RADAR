import { resolveRef } from '../../core/sync.js';
import { updateProject } from '../../io.js';
import { PROJECT_OPTIONS, detectAuthor, projectDir, writeOutcome, type Command } from '../shared.js';

export const done: Command = {
  usage: '<n | "title"> [--path DIR] [--json]',
  summary: 'complete a task, by its number in "show" or by (part of) its title',
  options: PROJECT_OPTIONS,
  positionals: { min: 1, max: 1 },
  async run(args) {
    const dir = projectDir(args);
    const arg = args.positionals[0]!;
    const ref = /^[1-9][0-9]*$/.test(arg) ? Number(arg) : arg;
    const res = await updateProject(dir, (doc) => [{ op: 'task.done', task: { title: resolveRef(doc.tasks, ref).title } }], {
      actor: 'human',
      now: new Date(),
      author: await detectAuthor(dir),
    });
    return writeOutcome(res);
  },
};
