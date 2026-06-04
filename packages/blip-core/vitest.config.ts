import { defineConfig } from 'vitest/config'

// Self-contained so the engine's tests are discovered from `test/` regardless of any
// ancestor vitest config in the host monorepo (the app's root config scopes to src/).
// Dev-only — not part of the published package (`files` is dist + skills).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts']
  }
})
