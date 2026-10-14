import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLock } from '../src/lock.js';
import { spawn, tmp } from './helpers.js';

const HOLD = fileURLToPath(new URL('./procs/hold-lock.mjs', import.meta.url));

/** Every "start" is followed by that same process's "end": nobody held the lock at the same time as anyone else. */
function expectNoOverlap(log: string, holders: number): void {
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(holders * 2);
  for (let i = 0; i < lines.length; i += 2) {
    expect(lines[i]).toMatch(/^start \d+$/);
    expect(lines[i + 1]).toBe(lines[i]!.replace('start', 'end'));
  }
  expect(new Set(lines.filter((l) => l.startsWith('start'))).size).toBe(holders);
}

describe('withLock', () => {
  it('runs the function, returns its value and removes the lock file', async () => {
    const lock = join(tmp(), 'locks', 'a.lock');
    const value = await withLock(lock, async () => {
      expect(JSON.parse(readFileSync(lock, 'utf8'))).toMatchObject({ pid: process.pid });
      return 42;
    });
    expect(value).toBe(42);
    expect(existsSync(lock)).toBe(false);
  });

  it('releases the lock when the function throws', async () => {
    const lock = join(tmp(), 'a.lock');
    await expect(withLock(lock, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('holders in one process queue up', async () => {
    const lock = join(tmp(), 'a.lock');
    const order: string[] = [];
    await Promise.all(
      ['a', 'b', 'c'].map((name) =>
        withLock(lock, async () => {
          order.push(`start ${name}`);
          await new Promise((r) => setTimeout(r, 30));
          order.push(`end ${name}`);
        }),
      ),
    );
    for (let i = 0; i < order.length; i += 2) expect(order[i + 1]).toBe(order[i]!.replace('start', 'end'));
  });

  it('gives up with E_BUSY after five seconds when a live lock is never released', async () => {
    const lock = join(tmp(), 'a.lock');
    writeFileSync(lock, '{}');
    const started = Date.now();
    await expect(withLock(lock, async () => 1)).rejects.toMatchObject({ code: 'E_BUSY' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    // The lock was live: it is still there, untouched.
    expect(readFileSync(lock, 'utf8')).toBe('{}');
  });

  it('a stale lock is taken over by exactly one of several waiting processes at a time', async () => {
    const dir = tmp();
    const lock = join(dir, 'a.lock');
    const log = join(dir, 'log.txt');
    writeFileSync(lock, JSON.stringify({ pid: 1, at: '2026-01-01T00:00:00.000Z' }));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);

    const ran = await Promise.all(Array.from({ length: 6 }, () => spawn(HOLD, [lock, log, '150'])));
    expect(ran.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
    expectNoOverlap(log, 6);
    // Nothing is left behind: no lock, no set-aside stale file.
    expect(readdirSync(dir)).toEqual(['log.txt']);
  });

  it('many processes on a free lock never overlap', async () => {
    const dir = tmp();
    const log = join(dir, 'log.txt');
    const ran = await Promise.all(Array.from({ length: 8 }, () => spawn(HOLD, [join(dir, 'a.lock'), log, '20'])));
    expect(ran.every((r) => r.code === 0)).toBe(true);
    expectNoOverlap(log, 8);
  });
});
