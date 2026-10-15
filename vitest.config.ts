import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The main-process tests start the engine, git and node as processes, which start as slowly as
    // the machine is busy: under a burner on every core the slowest test on the 5 s default took
    // 12 s. Five times that; no assertion depends on it.
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
