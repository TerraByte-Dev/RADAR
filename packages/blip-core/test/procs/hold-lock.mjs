// Child process for lock tests: take the lock, write "start"/"end" around a short hold.
import { appendFileSync } from 'node:fs';
import { withLock } from '../../dist/lock.js';

const [lock, log, holdMs] = process.argv.slice(2);
await withLock(lock, async () => {
  appendFileSync(log, `start ${process.pid}\n`);
  await new Promise((r) => setTimeout(r, Number(holdMs)));
  appendFileSync(log, `end ${process.pid}\n`);
});
