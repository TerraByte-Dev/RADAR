import { initProject } from '../../io.js';
import { blipPath } from '../../paths.js';
import { PROJECT_OPTIONS, str, strs, type Command } from '../shared.js';

export const init: Command = {
  usage: '[--name NAME] [--now TEXT] [--task TITLE]… [--path DIR] [--json]',
  summary: 'start tracking this folder: create BLIP.md if there is none (never overwrites)',
  options: { ...PROJECT_OPTIONS, name: { type: 'string' }, now: { type: 'string' }, task: { type: 'string', multiple: true } },
  async run(args) {
    const opts: { name?: string; now?: string; tasks?: string[] } = { tasks: strs(args.values.task) };
    const name = str(args.values.name);
    const now = str(args.values.now);
    if (name !== undefined) opts.name = name;
    if (now !== undefined) opts.now = now;
    const res = await initProject(str(args.values.path) ?? process.cwd(), opts);
    const lines = [`${res.created ? 'Created' : 'Already tracked'} ${blipPath(res.dir)}`];
    if (res.registry) lines.push(res.registry);
    return { data: { created: res.created, dir: res.dir, doc: res.doc, registry: res.registry }, lines };
  },
};
