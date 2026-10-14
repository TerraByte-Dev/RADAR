import { defineConfig } from '@playwright/test'

// `npm run e2e` builds the app, then runs these against out/ through the Electron driver.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 90_000,
  reporter: 'list'
})
