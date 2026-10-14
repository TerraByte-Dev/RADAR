import type { EditOp } from '../../core/edit.js';
import { updateProject } from '../../io.js';
import { PROJECT_OPTIONS, detectAuthor, projectDir, usageError, writeOutcome, type Command } from '../shared.js';

const FIELDS = ['name', 'status', 'focus', 'due', 'tags'] as const;
type Field = (typeof FIELDS)[number];

function valueOf(field: Field, text: string): unknown {
  if (field === 'focus') {
    if (text !== 'on' && text !== 'off') throw usageError('focus takes "on" or "off"');
    return text === 'on';
  }
  if (field === 'due') return text === 'none' ? null : text;
  if (field === 'tags') return text === 'none' ? [] : text.split(',').map((t) => t.trim()).filter(Boolean);
  return text;
}

export const set: Command = {
  usage: '<name | status | focus | due | tags> <value> [--path DIR] [--json]',
  summary: 'change what the owner decides: name, status (active|blocked|paused|archived), focus (on|off), due (YYYY-MM-DD|none), tags (a,b|none)',
  options: PROJECT_OPTIONS,
  positionals: { min: 2, max: 2 },
  async run(args) {
    const field = args.positionals[0] as Field;
    if (!FIELDS.includes(field)) throw usageError(`"${field}" is not a field — choose from: ${FIELDS.join(', ')}`);
    const op: EditOp = { op: 'set', field, value: valueOf(field, args.positionals[1]!) };
    const dir = projectDir(args);
    return writeOutcome(await updateProject(dir, [op], { actor: 'human', now: new Date(), author: await detectAuthor(dir) }));
  },
};
