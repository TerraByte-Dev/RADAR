// What the suite does about time. A test that spawns processes or reads the clock is only as
// fast as the machine is idle, so nothing here measures the machine: the default run checks
// what a time budget is made of (the work done, the processes started, CPU time), and the
// wall-clock numbers of the spec, and the concurrency proofs at full size, run with
// RADAR_TEST_FULL=1 (`npm run test:full`), on an idle machine.

/** The opt-in full run: heavy concurrency at full size and absolute wall-clock budgets. */
export const FULL = process.env.RADAR_TEST_FULL === '1';

/**
 * CPU time, in ms, this process spends while `fn` runs (its worker threads included, the
 * processes it starts not). Unlike wall time it does not grow when other processes hold the
 * cores, so a budget on it holds on a loaded machine; Windows counts it in 15.6 ms ticks.
 */
export async function cpuMs(fn: () => unknown): Promise<number> {
  const start = process.cpuUsage();
  await fn();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
}

/** `cpuMs` for synchronous work. */
export function cpuMsSync(fn: () => unknown): number {
  const start = process.cpuUsage();
  fn();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
}
