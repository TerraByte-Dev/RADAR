import { describe, expect, it } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import { resolveAutoUpdater } from './updater'

// NOTE: do not try to assert this against the real `import('electron-updater')` here. Vitest resolves
// CJS dependencies through Vite's interop, which *does* surface `autoUpdater`; node's native ESM
// loader (what the packaged app uses) does not. A namespace-shape assertion would pass under vitest
// while the packaged app stayed broken. Only the pure resolution logic is testable in-process.

/**
 * Guards the bug that made "Check for updates" spin forever in v1.0.0/v2.0.0: `autoUpdater` is a
 * lazy getter on electron-updater's `module.exports`, invisible to cjs-module-lexer, so the ESM
 * namespace from `import('electron-updater')` has no such named export and destructuring it gave
 * `undefined`. The next property write threw before any listener was attached — no event, no error.
 */
describe('resolveAutoUpdater', () => {
  const stub = { autoDownload: true } as unknown as AppUpdater

  it('finds autoUpdater when it only exists as a getter on `default` (the real-world shape)', () => {
    const mod = { default: Object.defineProperty({}, 'autoUpdater', { get: () => stub }) }
    expect(resolveAutoUpdater(mod)).toBe(stub)
  })

  it('still finds it if a future Node/electron-updater restores the named export', () => {
    expect(resolveAutoUpdater({ autoUpdater: stub })).toBe(stub)
  })

  it('throws loudly instead of returning undefined when neither path resolves', () => {
    expect(() => resolveAutoUpdater({})).toThrow(/exposed no autoUpdater/)
  })
})
