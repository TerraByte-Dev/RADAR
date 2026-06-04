import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { scanProjects, readProject, setFields, taskOp, handoff, initProject } from './projects'

const VALID = `---
name: Alpha
horizon: week
deadline: 2026-07-01
priority: 2
category: Product
status: active
radar_angle: 90
---

# Tasks
- [x] one
- [ ] two

# Notes
hi
`

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'radar-scan-'))
  await writeFile(join(root, 'BLIP.md'), VALID.replace('name: Alpha', 'name: Root'))
  await mkdir(join(root, 'sub', 'alpha'), { recursive: true })
  await writeFile(join(root, 'sub', 'alpha', 'BLIP.md'), VALID)
  // An un-adopted repo (.git, no BLIP.md) → a ghost blip.
  await mkdir(join(root, 'ghostrepo', '.git'), { recursive: true })
  await writeFile(join(root, 'ghostrepo', 'CLAUDE.md'), '# ghost')
  // These must be skipped by the scanner:
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'pkg', 'BLIP.md'), VALID)
  await mkdir(join(root, '.hidden'), { recursive: true })
  await writeFile(join(root, '.hidden', 'BLIP.md'), VALID)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scanProjects', () => {
  it('finds tracked BLIP.md projects, skipping node_modules and dot-dirs, sorted by name', async () => {
    const tracked = (await scanProjects([root], 5)).filter((p) => !p.ghost).map((p) => p.name)
    expect(tracked).toEqual(['Alpha', 'Root']) // sorted, ignored dirs excluded
  })

  it('surfaces an un-adopted repo as a ghost blip', async () => {
    const ghost = (await scanProjects([root], 5)).find((p) => p.name === 'ghostrepo')!
    expect(ghost.ghost).toBe(true)
    expect(ghost.ghostHints).toContain('git')
    expect(ghost.blipPath).toBe(join(root, 'ghostrepo', 'BLIP.md'))
  })

  it('maps the new radar fields onto the record', async () => {
    const alpha = (await scanProjects([root], 5)).find((p) => p.name === 'Alpha')!
    expect(alpha.deadline).toBe('2026-07-01')
    expect(alpha.radar_angle).toBe(90)
    expect(alpha.priority).toBe(2)
    expect(alpha.tasks).toHaveLength(2)
    expect(alpha.tasks.filter((t) => t.done)).toHaveLength(1)
  })
})

describe('readProject', () => {
  it('returns a signal-lost record for an unreadable BLIP.md', async () => {
    const rec = await readProject(join(root, 'does-not-exist', 'BLIP.md'))
    expect(rec.error).toBeDefined()
    expect(rec.tasks).toEqual([])
  })
})

describe('write ops (engine round-trip through the main layer)', () => {
  async function freshProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'radar-proj-'))
    await writeFile(join(dir, 'BLIP.md'), VALID)
    return join(dir, 'BLIP.md')
  }

  it('setFields writes a deadline + status and clears the deadline with null', async () => {
    const blipPath = await freshProject()
    let rec = await setFields(blipPath, { deadline: '2026-08-15', status: 'blocked' })
    expect(rec.deadline).toBe('2026-08-15')
    expect(rec.status).toBe('blocked')
    rec = await setFields(blipPath, { deadline: null })
    expect(rec.deadline).toBeUndefined()
    expect(await readFile(blipPath, 'utf8')).toContain('# Notes\nhi') // human section survives
  })

  it('taskOp adds and toggles tasks', async () => {
    const blipPath = await freshProject()
    let rec = await taskOp(blipPath, { action: 'add', text: 'three' })
    expect(rec.tasks.map((t) => t.text)).toContain('three')
    rec = await taskOp(blipPath, { action: 'toggle', ref: 'two' })
    expect(rec.tasks.find((t) => t.text === 'two')?.done).toBe(true)
  })

  it('handoff appends a session entry and updates next_action', async () => {
    const blipPath = await freshProject()
    const rec = await handoff(blipPath, ['did a thing'], 'do the next thing', 'Tester')
    expect(rec.next_action).toBe('do the next thing')
    expect(rec.sessionLog).toContain('did a thing')
    expect(rec.last_session).toBeDefined()
  })

  it('initProject creates a BLIP.md named from the folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'radar-init-'))
    try {
      const rec = await initProject(dir, { category: 'Client', deadline: '2026-09-01' })
      expect(rec.name).toBe(basename(dir))
      expect(rec.category).toBe('Client')
      expect(rec.deadline).toBe('2026-09-01')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
