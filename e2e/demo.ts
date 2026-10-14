// `npm run demo [-- --extra]`: the built app on the placeholder data set, in a throwaway world
// (its own profile, data folder and HOME; see harness.ts). Nothing real is read or written.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { appArgs, makeWorld, worldEnv } from './harness'

const world = makeWorld({ demo: true, extra: process.argv.includes('--extra') })
console.log(`demo: ${world.dir}`)
const electron = createRequire(__filename)('electron') as unknown as string
spawn(electron, appArgs(world), { env: worldEnv(world), stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0))
