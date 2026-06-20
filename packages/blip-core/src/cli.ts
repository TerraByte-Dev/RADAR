#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readBlip, writeBlipAtomic, updateBlip, createBlip } from './index.js';
import { HORIZONS, STATUSES, coercePriority, coerceDeadline, type Horizon, type Status } from './types.js';

interface Args {
  _: string[];
  flags: Record<string, string | boolean | string[]>;
}

function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        const existing = flags[key];
        if (existing === undefined) flags[key] = next;
        else if (Array.isArray(existing)) existing.push(next);
        else flags[key] = [existing as string, next];
        i++;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

function str(v: string | boolean | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function arrify(v: string | boolean | string[] | undefined): string[] {
  if (v === undefined || v === true || v === false) return [];
  return Array.isArray(v) ? v : [v];
}
function fail(msg: string): never {
  process.stderr.write(`radar-blip: ${msg}\n`);
  process.exit(1);
}
function resolveDir(flags: Args['flags']): string {
  return resolve(str(flags.path) ?? process.cwd());
}
function resolveFile(flags: Args['flags']): string {
  return join(resolveDir(flags), 'BLIP.md');
}
function requireFile(file: string): void {
  if (!existsSync(file)) {
    fail(`no BLIP.md in ${resolve(file, '..')} — run: radar-blip init`);
  }
}
async function requireBlip(file: string) {
  requireFile(file);
  return readBlip(file);
}
function parseRef(token: string | undefined): number | string {
  if (token === undefined) fail('a task number or text is required');
  return /^\d+$/.test(token) ? Number(token) - 1 : token; // humans use 1-based
}

const HELP = `radar-blip — the BLIP.md engine CLI

Usage:
  radar-blip init     [--path DIR] [--name N] [--horizon H] [--priority 1-5] [--category C] [--status S] [--next "..."] [--deadline YYYY-MM-DD] [--operation O] [--force]
  radar-blip show     [--path DIR] [--json]
  radar-blip set      [--path DIR] [--horizon H] [--priority 1-5] [--category C] [--status S] [--next "..."] [--deadline YYYY-MM-DD] [--operation O] [--name N] [--tag T ...]
  radar-blip task add "text"        [--path DIR]
  radar-blip task done|undone|toggle|rm  <n|text>   [--path DIR]
  radar-blip task list              [--path DIR]
  radar-blip handoff  [--line "did X" --line "did Y"] [--next "..."] [--summary "..."] [--author A] [--path DIR]
  radar-blip skills install         [--claude] [--codex] [--force]

Horizons: ${HORIZONS.join(', ')}
Statuses: ${STATUSES.join(', ')}`;

function applyFieldFlags(blip: import('./index.js').Blip, flags: Args['flags']): void {
  const horizon = str(flags.horizon);
  if (horizon !== undefined) {
    if (!HORIZONS.includes(horizon as Horizon)) fail(`invalid horizon "${horizon}" (use: ${HORIZONS.join(', ')})`);
    blip.setHorizon(horizon as Horizon);
  }
  const status = str(flags.status);
  if (status !== undefined) {
    if (!STATUSES.includes(status as Status)) fail(`invalid status "${status}" (use: ${STATUSES.join(', ')})`);
    blip.setStatus(status as Status);
  }
  if (flags.priority !== undefined) blip.setPriority(coercePriority(str(flags.priority)));
  const category = str(flags.category);
  if (category !== undefined) blip.setCategory(category);
  const next = str(flags.next);
  if (next !== undefined) blip.setNextAction(next);
  const deadline = str(flags.deadline);
  if (deadline !== undefined) {
    const d = coerceDeadline(deadline);
    if (d === undefined) fail(`invalid deadline "${deadline}" (use an ISO date like 2026-07-01)`);
    blip.setDeadline(d);
  }
  const operation = str(flags.operation);
  if (operation !== undefined) blip.setOperation(operation);
  const name = str(flags.name);
  if (name !== undefined) {
    if (!name.trim()) fail('--name must not be empty');
    blip.setField('name', name);
  }
  const tags = arrify(flags.tag);
  if (tags.length) blip.setField('tags', tags);
}

function printModel(blip: import('./index.js').Blip): void {
  const m = blip.toReadModel();
  const done = m.tasks.filter((t) => t.done).length;
  process.stdout.write(
    [
      `${m.name ?? '(unnamed)'}  [${m.status}]`,
      `  horizon : ${m.horizon}`,
      `  deadline: ${m.deadline ?? '(none)'}`,
      `  priority: P${m.priority}`,
      `  category: ${m.category || '(none)'}`,
      `  operation: ${m.operation ?? '(none)'}`,
      `  next    : ${m.next_action ?? '(none)'}`,
      `  tasks   : ${done}/${m.tasks.length} done`,
      ...m.tasks.map((t) => `    [${t.done ? 'x' : ' '}] ${t.text}`),
      '',
    ].join('\n'),
  );
}

/** Directory of the bundled /blip skills: `<package>/skills` (sibling of dist/ and src/). */
function bundledSkillsDir(): string {
  return fileURLToPath(new URL('../skills', import.meta.url));
}

/** Copy the bundled /blip skills into the user's Claude Code and/or Codex config dirs. */
function installSkills(flags: Args['flags']): void {
  const both = !flags.claude && !flags.codex;
  const force = flags.force === true;
  const src = bundledSkillsDir();
  const targets: { name: string; from: string; to: string }[] = [];
  if (both || flags.claude) {
    targets.push({
      name: 'Claude Code',
      from: join(src, 'claude', 'blip', 'SKILL.md'),
      to: join(homedir(), '.claude', 'skills', 'blip', 'SKILL.md'),
    });
  }
  if (both || flags.codex) {
    targets.push({
      name: 'Codex',
      from: join(src, 'codex', 'blip.md'),
      to: join(homedir(), '.codex', 'prompts', 'blip.md'),
    });
  }
  for (const t of targets) {
    if (!existsSync(t.from)) fail(`bundled skill missing at ${t.from} (reinstall radar-blip)`);
    if (existsSync(t.to) && !force) {
      process.stdout.write(`skipped   ${t.name}: ${t.to} (exists — use --force)\n`);
      continue;
    }
    mkdirSync(dirname(t.to), { recursive: true });
    copyFileSync(t.from, t.to);
    process.stdout.write(`installed ${t.name}: ${t.to}\n`);
  }
}

async function main(): Promise<void> {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];

  if (!cmd || cmd === 'help' || flags.help) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const file = resolveFile(flags);

  switch (cmd) {
    case 'init': {
      if (existsSync(file) && !flags.force) fail(`BLIP.md already exists in ${resolveDir(flags)} (use --force)`);
      const priority = flags.priority !== undefined ? coercePriority(str(flags.priority)) : undefined;
      const horizon = str(flags.horizon);
      if (horizon !== undefined && !HORIZONS.includes(horizon as Horizon)) fail(`invalid horizon "${horizon}"`);
      const status = str(flags.status);
      if (status !== undefined && !STATUSES.includes(status as Status)) fail(`invalid status "${status}"`);
      const deadlineFlag = str(flags.deadline);
      const deadline = deadlineFlag !== undefined ? coerceDeadline(deadlineFlag) : undefined;
      if (deadlineFlag !== undefined && deadline === undefined) fail(`invalid deadline "${deadlineFlag}" (use an ISO date like 2026-07-01)`);
      const blip = createBlip({
        name: str(flags.name) ?? basename(resolveDir(flags)),
        horizon: horizon as Horizon | undefined,
        priority,
        category: str(flags.category),
        status: status as Status | undefined,
        next_action: str(flags.next),
        deadline,
        operation: str(flags.operation),
      });
      await writeBlipAtomic(file, blip);
      process.stdout.write(`Created ${file}\n`);
      return;
    }

    case 'show': {
      const blip = await requireBlip(file);
      if (flags.json) process.stdout.write(JSON.stringify(blip.toReadModel(), null, 2) + '\n');
      else printModel(blip);
      return;
    }

    case 'set': {
      requireFile(file);
      // Read-modify-write via updateBlip so a concurrent writer (the app) is never clobbered.
      await updateBlip(file, (blip) => applyFieldFlags(blip, flags));
      process.stdout.write(`Updated ${file}\n`);
      return;
    }

    case 'task': {
      const action = _[1] ?? '';
      if (action === 'list') {
        const blip = await requireBlip(file);
        blip.tasks.forEach((t, i) => process.stdout.write(`${i + 1}. [${t.done ? 'x' : ' '}] ${t.text}\n`));
        return;
      }
      if (!['add', 'done', 'undone', 'toggle', 'rm'].includes(action)) {
        fail(`unknown task action "${action}" (add|done|undone|toggle|rm|list)`);
      }
      let text = '';
      if (action === 'add') {
        text = _.slice(2).join(' ').trim();
        if (!text) fail('task text is required');
      }
      requireFile(file);
      await updateBlip(file, (blip) => {
        switch (action) {
          case 'add':
            blip.addTask(text);
            break;
          case 'done':
            blip.setTaskDone(parseRef(_[2]), true);
            break;
          case 'undone':
            blip.setTaskDone(parseRef(_[2]), false);
            break;
          case 'toggle':
            blip.toggleTask(parseRef(_[2]));
            break;
          case 'rm':
            blip.removeTask(parseRef(_[2]));
            break;
        }
      });
      process.stdout.write(`Updated tasks in ${file}\n`);
      return;
    }

    case 'handoff': {
      requireFile(file);
      const lines = arrify(flags.line);
      const summary = str(flags.summary);
      if (summary) lines.push(summary);
      const next = str(flags.next);
      await updateBlip(file, (blip) => {
        blip.appendSession({ lines, author: str(flags.author) });
        if (next) blip.setNextAction(next);
      });
      process.stdout.write(`Logged session in ${file}\n`);
      return;
    }

    case 'skills': {
      const action = _[1];
      if (action === 'install') {
        installSkills(flags);
        return;
      }
      fail(`unknown skills action "${action ?? ''}" (install)`);
    }

    default:
      fail(`unknown command "${cmd}" — run: radar-blip help`);
  }
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
