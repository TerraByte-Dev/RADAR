// scripts/bundle-cli.mjs — bundle the `radar-blip` CLI into one file the app ships (spec 5.4).
//
// The packaged app carries `resources/cli/radar-blip.mjs` (electron-builder `extraResources`)
// and keeps a stable shim at `<data>/bin` pointing at it, so the CLI agents run is always the
// engine the app was built with. The output is generated and not tracked.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// An output path as the one argument is for tests; the app ships the default.
const outfile = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'resources', 'cli', 'radar-blip.mjs')
// The engine's version, fixed into the bundle: next to `resources/cli` there is no manifest to read.
const { version } = JSON.parse(readFileSync(resolve(root, 'packages', 'blip-core', 'package.json'), 'utf8'))

await build({
  entryPoints: [resolve(root, 'packages', 'blip-core', 'src', 'cli', 'main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // A CommonJS dependency that calls `require` for a Node built-in needs one in ESM output.
  banner: { js: "import { createRequire as __radarRequire } from 'node:module'; const require = __radarRequire(import.meta.url);" },
  define: { __RADAR_BLIP_VERSION__: JSON.stringify(version) },
  logLevel: 'warning'
})
console.log(`bundled ${outfile} (radar-blip ${version})`)
