import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config'

// Self-contained so the engine's tests are discovered from `test/` regardless of any
// ancestor vitest config in the host monorepo (the app's root config scopes to src/).
// Dev-only — not part of the published package (`files` is dist + skills).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Most tests here run the CLI, git or a helper as a process, and a process starts as slowly
    // as the machine is busy: under a burner on every core, tests on the 5 s default took up to
    // 12 s and one with its own 30 s limit took 29 s. One limit for all, three times the worst;
    // the concurrency proof and the 50,000-file tree keep their longer ones. No assertion
    // depends on it: budgets on time are CPU time, counts of work, or opt-in (test/timing.ts).
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // One test file per process, so cpuMs() counts the test it is called in and no other.
    pool: 'forks',
    // A floor under every test: the real data directory and the real Claude config are
    // never read or written, even by a test that forgets to isolate itself.
    env: {
      RADAR_BLIP_HOME: join(tmpdir(), 'radar-blip-test-home'),
      CLAUDE_CONFIG_DIR: join(tmpdir(), 'radar-blip-test-home', 'no-claude'),
      CODEX_HOME: join(tmpdir(), 'radar-blip-test-home', 'no-codex'),
    },
  }
})
