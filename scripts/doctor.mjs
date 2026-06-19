// scripts/doctor.mjs — verify the `radar-blip` workspace link resolves.
//
// npm workspaces symlink `node_modules/radar-blip` -> `packages/blip-core` using an
// ABSOLUTE path. Moving the repo on disk leaves that link dangling, which surfaces
// downstream as a cryptic `Cannot find module 'radar-blip'` from tsc / vite / vitest
// (the engine the app bundles can no longer be found). This guard runs before
// dev/build/test/package and fails loud with the one-line fix instead.
import { realpathSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const link = resolve(root, 'node_modules', 'radar-blip')
const target = resolve(root, 'packages', 'blip-core')

function fail(detail) {
  console.error(`\n  radar-blip workspace link is broken: ${detail}`)
  console.error('  fix: run `npm install` at the repo root to relink the workspace.\n')
  process.exit(1)
}

if (!existsSync(target)) fail(`packages/blip-core is missing at ${target}`)

let resolved
try {
  resolved = realpathSync(link)
} catch {
  fail('node_modules/radar-blip is missing or dangling (did the repo move?)')
}

if (realpathSync(target) !== resolved) {
  fail(`node_modules/radar-blip -> ${resolved}\n       expected -> ${realpathSync(target)}`)
}

// Healthy: stay quiet so the guard adds no noise to dev/build/test output.
