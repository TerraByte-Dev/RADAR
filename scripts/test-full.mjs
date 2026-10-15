// scripts/test-full.mjs — `npm test` with RADAR_TEST_FULL=1: the engine's concurrency proofs at
// full size (2, 4 and 8 writers × 15 rounds) and its wall-clock budgets as absolute numbers
// (packages/blip-core/test/timing.ts). Run it on an idle machine; the default run holds what
// does not depend on how busy the machine is.
import { spawnSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const r = spawnSync(npm, ['test'], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, RADAR_TEST_FULL: '1' } })
process.exit(r.status ?? 1)
