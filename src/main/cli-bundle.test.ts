import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isolate, tmp } from './testkit'

const ROOT = resolve(__dirname, '../..')

describe('the bundled CLI (spec 5.4)', () => {
  it('is one file that runs with no manifest beside it, and reports the version injected at bundle time', () => {
    // A folder with a space and nothing else in it: no package.json to fall back on, as in resources/cli.
    const out = join(tmp('radar-bundle-'), 'packaged resources', 'cli', 'radar-blip.mjs')
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'bundle-cli.mjs'), out], { cwd: ROOT, stdio: 'pipe' })
    const { version } = JSON.parse(readFileSync(join(ROOT, 'packages', 'blip-core', 'package.json'), 'utf8'))
    const text = readFileSync(out, 'utf8')
    expect(text).not.toContain('__RADAR_BLIP_VERSION__')
    const env = { ...process.env, RADAR_BLIP_HOME: isolate() }
    expect(execFileSync(process.execPath, [out, '--version'], { env, encoding: 'utf8' })).toBe(`${version}\n`)
    expect(execFileSync(process.execPath, [out, 'status', '--json'], { env, encoding: 'utf8' })).toContain('"ok":true')
  }, 60_000)
})
