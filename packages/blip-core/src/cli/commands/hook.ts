import { runHook } from '../../agents/claude/hook.js';
import type { Command } from '../shared.js';

/** Hook input is a small JSON object; anything past this is not one. */
const STDIN_MAX = 1024 * 1024;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > STDIN_MAX) {
      process.stdin.destroy();
      return '';
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The hook protocol output for `radar-blip hook <event>`, never an error: the CLI runs this
 * before any argument checking and exits 0 whatever it gets.
 */
export async function hookMain(argv: readonly string[]): Promise<string> {
  try {
    const out = await runHook(argv[0] ?? '', await readStdin());
    return out ? `${out}\n` : '';
  } catch {
    return '';
  }
}

/** Listed for usage only: main.ts runs {@link hookMain} for `hook` and never parses its arguments. */
export const hook: Command = {
  usage: '<session-start | stop | session-end>',
  summary: 'the Claude Code hooks: reads the event JSON on stdin, prints the hook reply or nothing, always exits 0',
  positionals: { min: 1, max: 1 },
  async run(args) {
    return { data: null, lines: [await hookMain(args.positionals)].filter(Boolean).map((l) => l.trimEnd()) };
  },
};
