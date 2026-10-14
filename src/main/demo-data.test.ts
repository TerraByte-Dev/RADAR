import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { buildBoard, listProjects } from 'radar-blip'
import { isolate, tmp } from './testkit'

const ROOT = resolve(__dirname, '../..')

describe('scripts/demo-data.mjs', () => {
  it('builds the placeholder set the renderer stages use: ages, sources, states and the live session read back as intended', async () => {
    const data = isolate()
    const projects = join(tmp('radar-demo-'), 'demo projects')
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'demo-data.mjs'), '--projects', projects, '--data', data], { cwd: ROOT, stdio: 'pipe' })
    const { projects: listed, warning } = await listProjects()
    expect(warning).toBeNull()
    expect(listed).toHaveLength(25)
    const now = Date.now()
    // Read the way the app reads a board: four projects at a time. All 25 at once start 110 git
    // calls together, which under a burner on every core took up to 0.77 s each against activity's
    // 2 and 3 s limits for git (0.23 s four at a time), and with the rest of the suite running too,
    // a call that runs out falls back to the files' age and the test failed at random.
    const records = await buildBoard(listed)
    const byName = new Map(records.map((r) => [r.doc?.name, r]))
    const days = (name: string): number | null => {
      const at = byName.get(name)?.activity?.lastTouchedAt
      return at ? Math.round((now - Date.parse(at)) / 86_400_000) : null
    }
    expect(records.filter((r) => r.state === 'needs-migrate').map((r) => r.doc?.name)).toEqual(['Trail maps'])
    expect(records.filter((r) => r.state !== 'ok' && r.state !== 'needs-migrate')).toEqual([])
    expect(records.filter((r) => r.agent.live).map((r) => r.doc?.name)).toEqual(['Tidewatch'])
    expect(records.filter((r) => r.doc?.status === 'paused').map((r) => r.doc?.name)).toEqual(['Dungeon Dig'])
    expect(records.filter((r) => r.doc?.status === 'archived')).toHaveLength(3)
    expect([days('Beat Looper'), days('Starmap'), days('Word Duel'), days('Yard sale lister')]).toEqual([15, 52, 210, null])
    expect(byName.get('Cloud Glide')!.activity).toMatchObject({ source: 'git', unlogged: true, git: { branch: 'main' } })
    expect(byName.get('Fermento')!.activity).toMatchObject({ unlogged: false, git: { branch: 'feat/batch-notes', dirty: true } })
    expect(byName.get('Homelab board')!.activity).toMatchObject({ source: 'files', unlogged: false })
    expect(byName.get('Yard sale lister')!.activity!.source).toBe('none')
  }, 120_000)
})
