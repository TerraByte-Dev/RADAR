import { createInterface } from 'node:readline/promises';
import { runDoctor } from '../../doctor.js';
import { resolveProject } from '../../paths.js';
import { ensureRegistered } from '../../registry.js';
import { applySetup, defaultTargets, describePlan, planSetup } from '../../setup.js';
import type { Command } from '../shared.js';
import { checklist } from './doctor.js';

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export const setup: Command = {
  usage: '[--dry-run] [--yes] [--remove] [--json]',
  summary: 'install the /blip skill and the Claude Code hooks (--remove takes them out); shows the change and asks first, --yes applies without asking',
  options: { json: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, yes: { type: 'boolean' }, remove: { type: 'boolean' } },
  async run(args) {
    const remove = args.values.remove === true;
    const plan = await planSetup(defaultTargets(), { remove });
    const changes = describePlan(plan);
    const lines = [...changes];
    const data = { changes, applied: false, checks: [] as unknown[] };
    if (!plan.changed) lines.push(remove ? 'Nothing to remove.' : 'Already set up.');
    else if (args.values['dry-run'] === true) return { data, lines: [...lines, 'dry run — nothing was written'] };
    else if (args.values.yes !== true) {
      const tty = process.stdin.isTTY && process.stdout.isTTY && args.values.json !== true;
      if (!tty) return { data, lines: [...lines, 'nothing was written: run again with --yes to apply'], exit: 1 };
      process.stdout.write(`${lines.join('\n')}\n`);
      lines.length = 0;
      if (!(await confirm('Apply these changes? [y/N] '))) return { data, lines: ['nothing was written'], exit: 1 };
    }
    if (plan.changed) {
      await applySetup(plan);
      data.applied = true;
      lines.push(remove ? 'Removed.' : 'Done.');
    }
    if (!remove) {
      const here = resolveProject(process.cwd());
      const notice = here ? await ensureRegistered(here) : null;
      if (notice) lines.push(notice);
    }
    const checks = await runDoctor();
    data.checks = checks;
    return { data, lines: [...lines, '', ...checklist(checks)] };
  },
};
