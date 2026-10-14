#!/usr/bin/env node
import { isAbsolute, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { BlipError } from '../core/schema.js';
import { dataDir } from '../paths.js';
import { engineVersion } from '../version.js';
import { add } from './commands/add.js';
import { brief } from './commands/brief.js';
import { doctor } from './commands/doctor.js';
import { done } from './commands/done.js';
import { hook, hookMain } from './commands/hook.js';
import { init } from './commands/init.js';
import { lint } from './commands/lint.js';
import { migrate } from './commands/migrate.js';
import { set } from './commands/set.js';
import { setup } from './commands/setup.js';
import { show } from './commands/show.js';
import { status } from './commands/status.js';
import { sync } from './commands/sync.js';
import { track } from './commands/track.js';
import type { Args, Command } from './shared.js';

const COMMANDS: Record<string, Command> = { init, show, brief, sync, add, done, set, lint, migrate, status, track, setup, doctor, hook };

/** Exit codes: 1 usage or validation (nothing written), 2 no project here, 3 the file cannot be written safely. */
const EXIT: Record<string, number> = { E_NO_PROJECT: 2, E_UNWRITABLE: 3, E_NEWER_SCHEMA: 3, E_NEEDS_MIGRATE: 3, E_BUSY: 3, E_BACKUP: 3, E_PREFLIGHT: 3, E_DATA_DIR: 3 };

/**
 * Anything thrown, as an error with a code. A filesystem failure inside the data folder is
 * the user's to fix (a wrong RADAR_BLIP_HOME, a folder that cannot be written), so it is
 * named for what it is; only what is left is "internal".
 */
function coded(err: unknown): BlipError {
  if (err instanceof BlipError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const path = (err as NodeJS.ErrnoException | null)?.path;
  if (typeof path === 'string') {
    const rel = relative(dataDir(), path);
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      return new BlipError('E_DATA_DIR', `radar-blip cannot use its data folder, so nothing was written (${message})`, {
        hint: `the folder is ${dataDir()} — make it a folder this user can write to, or set RADAR_BLIP_HOME to one`,
        path: dataDir(),
      });
    }
  }
  return new BlipError('E_INTERNAL', message);
}

function usage(name?: string): string {
  const cmd = name === undefined ? undefined : COMMANDS[name];
  if (name !== undefined && cmd) return `usage: radar-blip ${name} ${cmd.usage}\n  ${cmd.summary}`;
  const width = Math.max(...Object.keys(COMMANDS).map((n) => n.length));
  return ['usage: radar-blip <command> [options]', '', ...Object.entries(COMMANDS).map(([n, c]) => `  ${n.padEnd(width)}  ${c.summary}`), '', 'radar-blip <command> --help shows its options; radar-blip --version prints the engine version.'].join('\n');
}

/**
 * `--flag=true` and `--flag=false` for a yes/no option, which the strict parser would
 * refuse: the first is the flag, the second is its absence. Anything else is left for the
 * parser to reject.
 */
function booleans(argv: string[], cmd: Command): string[] {
  const out: string[] = [];
  for (const arg of argv) {
    const m = /^--([^=]+)=(true|false)$/.exec(arg);
    if (m && cmd.options?.[m[1]!]?.type === 'boolean') {
      if (m[2] === 'true') out.push(`--${m[1]}`);
    } else out.push(arg);
  }
  return out;
}

function parse(cmd: Command, argv: string[]): Args {
  let parsed;
  try {
    parsed = parseArgs({ args: booleans(argv, cmd), options: cmd.options ?? {}, strict: true, allowPositionals: true });
  } catch (err) {
    throw new BlipError('E_USAGE', err instanceof Error ? err.message : String(err));
  }
  const { min, max } = cmd.positionals ?? { min: 0, max: 0 };
  const n = parsed.positionals.length;
  if (n < min) throw new BlipError('E_USAGE', 'an argument is missing');
  if (n > max) throw new BlipError('E_USAGE', `unexpected argument "${parsed.positionals[max]}"${max ? ' — put a value with spaces inside quotes' : ''}`);
  return { values: parsed.values, positionals: parsed.positionals };
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  const cmd = name === undefined ? undefined : COMMANDS[name];
  // Read from the arguments as the parser will see them, so that `--json=true` is `--json` here too.
  const json = (cmd ? booleans(rest, cmd) : rest).includes('--json');
  const fail = (err: unknown, help: string | null): number => {
    const e = coded(err);
    if (json) {
      const error = { code: e.code, message: e.message, hint: e.hint ?? null, path: e.path ?? null, violations: e.violations ?? [] };
      process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
    } else {
      const lines = [`radar-blip: ${e.code}: ${e.message}`];
      if ((e.violations?.length ?? 0) > 1 || e.code === 'E_PREFLIGHT') for (const v of e.violations ?? []) lines.push(`  ${v.message}`);
      if (e.hint) lines.push(`  hint: ${e.hint.replace(/\n/g, '\n    ')}`);
      if (help) lines.push('', help);
      process.stderr.write(`${lines.join('\n')}\n`);
    }
    return EXIT[e.code] ?? 1;
  };

  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    process.stdout.write(`${usage()}\n`);
    return name === undefined ? 1 : 0;
  }
  if (name === '--version' || name === '-v') {
    process.stdout.write(`${engineVersion()}\n`);
    return 0;
  }
  if (!cmd) return fail(new BlipError('E_USAGE', `"${name}" is not a radar-blip command`), usage());
  // A hook never fails and never prints usage: whatever it is given, it answers or stays silent, and exits 0.
  if (name === 'hook' && !rest.includes('--help') && !rest.includes('-h')) {
    process.stdout.write(await hookMain(rest));
    return 0;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(`${usage(name)}\n`);
    return 0;
  }
  try {
    const out = await cmd.run(parse(cmd, rest));
    process.stdout.write(json ? `${JSON.stringify({ ok: true, data: out.data })}\n` : out.lines.length ? `${out.lines.join('\n')}\n` : '');
    return out.exit ?? 0;
  } catch (err) {
    return fail(err, err instanceof BlipError && err.code === 'E_USAGE' ? usage(name) : null);
  }
}

process.exitCode = await main(process.argv.slice(2));
