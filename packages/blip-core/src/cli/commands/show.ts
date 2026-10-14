import { readProject } from '../../io.js';
import { PROJECT_OPTIONS, projectDir, renderDoc, type Command } from '../shared.js';

export const show: Command = {
  usage: '[--path DIR] [--json]',
  summary: 'the whole project; --json prints the read model',
  options: PROJECT_OPTIONS,
  async run(args) {
    const dir = projectDir(args);
    const doc = (await readProject(dir)).file.doc();
    return { data: doc, lines: renderDoc(doc, dir) };
  },
};
