import type { EditOp } from '../../core/edit.js';
import { updateProject } from '../../io.js';
import { PROJECT_OPTIONS, detectAuthor, projectDir, str, strs, writeOutcome, type Command } from '../shared.js';

export const add: Command = {
  usage: '"title" [--detail LINE]… [--due YYYY-MM-DD] [--top] [--path DIR] [--json]',
  summary: 'add a task to the end of the queue, or with --top as the next step',
  options: { ...PROJECT_OPTIONS, detail: { type: 'string', multiple: true }, due: { type: 'string' }, top: { type: 'boolean' } },
  positionals: { min: 1, max: 1 },
  async run(args) {
    const dir = projectDir(args);
    const res = await updateProject(
      dir,
      (doc) => {
        const op: EditOp = { op: 'task.add', title: args.positionals[0]!, detail: strs(args.values.detail) };
        const due = str(args.values.due);
        if (due !== undefined) op.due = due;
        if (args.values.top === true && doc.next) op.before = { title: doc.next.title };
        return [op];
      },
      { actor: 'human', now: new Date(), author: await detectAuthor(dir) },
    );
    return writeOutcome(res);
  },
};
