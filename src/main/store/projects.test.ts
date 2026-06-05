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
  // Two sibling projects.
  await mkdir(join(root, 'alpha'), { recursive: true })
  await writeFile(join(root, 'alpha', 'BLIP.md'), VALID) // name: Alpha
  await mkdir(join(root, 'beta'), { recursive: true })
  await writeFile(join(root, 'beta', 'BLIP.md'), VALID.replace('name: Alpha', 'name: Beta'))
  // A nested BLIP.md *inside* a project — must NOT surface (a project is a boundary).
  await mkdir(join(root, 'alpha', 'nested'), { recursive: true })
  await writeFile(join(root, 'alpha', 'nested', 'BLIP.md'), VALID.replace('name: Alpha', 'name: Nested'))
  // An un-adopted repo (.git, no BLIP.md) → a ghost blip.
  await mkdir(join(root, 'ghostrepo', '.git'), { recursive: true })
  await writeFile(join(root, 'ghostrepo', 'CLAUDE.md'), '# ghost')
  // Skipped by the scanner:
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
    expect(tracked).toEqual(['Alpha', 'Beta']) // sorted, ignored dirs excluded
  })

  it('stops at a project boundary — a BLIP.md nested inside a project never surfaces', async () => {
    const names = (await scanProjects([root], 5)).map((p) => p.name)
    expect(names).not.toContain('Nested')
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
      // No git history (inject null) → behaves like a plain create.
      const rec = await initProject(dir, { category: 'Client', deadline: '2026-09-01' }, async () => null)
      expect(rec.name).toBe(basename(dir))
      expect(rec.category).toBe('Client')
      expect(rec.deadline).toBe('2026-09-01')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('initProject seeds true recency + a first session-log entry from git history', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'radar-init-git-'))
    try {
      const rec = await initProject(dir, {}, async () => ({
        lastCommitISO: '2026-05-30T10:00:00-06:00',
        lastCommitDate: '2026-05-30',
        shortSha: 'abc1234',
        author: 'Tate',
        subject: 'feat: do a real thing'
      }))
      // last_session reflects the commit time (not "now") so neglected-detection is honest.
      expect(rec.last_session).toBe('2026-05-30T10:00:00-06:00')
      // The timeline is non-empty on first open, dated to the commit, citing the real commit.
      expect(rec.sessionLog).toContain('2026-05-30 — RADAR')
      expect(rec.sessionLog).toContain('Adopted into RADAR')
      expect(rec.sessionLog).toContain('abc1234')
      expect(rec.sessionLog).toContain('feat: do a real thing')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('initProject without git history leaves the blip un-seeded (no fake recency / log)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'radar-init-nogit-'))
    try {
      const rec = await initProject(dir, {}, async () => null)
      expect(rec.last_session).toBeUndefined()
      expect(rec.sessionLog ?? '').not.toContain('Adopted into RADAR')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
