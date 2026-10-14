import { runDoctor, type Check } from '../../doctor.js';
import type { Command } from '../shared.js';

/** One line per check: `ok    hooks         …`. */
export function checklist(checks: readonly Check[]): string[] {
  return checks.map((c) => `${c.level.padEnd(5)} ${c.id.padEnd(13)} ${c.message}`);
}

export const doctor: Command = {
  usage: '[--json]',
  summary: 'check that the CLI, node, git, the /blip skill, the hooks and the tracked projects are in order; exit 4 on any failure',
  options: { json: { type: 'boolean' } },
  async run() {
    const checks = await runDoctor();
    return { data: { checks }, lines: checklist(checks), exit: checks.some((c) => c.level === 'fail') ? 4 : 0 };
  },
};
