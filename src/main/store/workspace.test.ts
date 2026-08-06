import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, access, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureInbox, inboxAddTask, inboxBlipPath, inboxDir } from './workspace'

describe('Inbox workspace (universal capture)', () => {
  it('ensureInbox creates the Inbox BLIP.md and is idempotent', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'radar-ws-'))
    try {
      const file = await ensureInbox(ws)
      expect(file).toBe(inboxBlipPath(ws))
      await expect(access(file)).resolves.toBeUndefined()
      expect(await ensureInbox(ws)).toBe(file) // second call: no throw, no duplicate
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('seeds the Inbox with a first task, not a frontmatter field', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'radar-ws-'))
    try {
      const raw = await readFile(await ensureInbox(ws), 'utf8')
      expect(raw).toContain('- [ ] Capture loose tasks & deadlines')
      expect(raw).not.toContain('next_action')
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('inboxAddTask appends a captured task to the Inbox blip', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'radar-ws-'))
    try {
      const rec = await inboxAddTask(ws, 'Pay rent')
      expect(rec.name).toBe('Inbox')
      expect(rec.tasks.map((t) => t.text)).toContain('Pay rent')
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('retires a legacy Inbox next_action through quick capture', async () => {
    // Capture goes through `updateBlip` like every other write, so an Inbox created by an
    // older build migrates the moment you capture into it.
    const ws = await mkdtemp(join(tmpdir(), 'radar-ws-'))
    try {
      await mkdir(inboxDir(ws), { recursive: true })
      await writeFile(
        inboxBlipPath(ws),
        '---\nname: Inbox\nnext_action: Capture loose tasks\n---\n\n# Tasks\n',
        'utf8'
      )
      const rec = await inboxAddTask(ws, 'Pay rent')
      expect(rec.tasks.map((t) => t.text)).toEqual(['Capture loose tasks', 'Pay rent'])
      expect(await readFile(inboxBlipPath(ws), 'utf8')).not.toContain('next_action')
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('never clobbers an existing Inbox (exclusive create — the TOCTOU clobber primitive)', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'radar-ws-'))
    try {
      // Simulate a just-captured Inbox that lands before ensureInbox's create.
      const existing = '---\nname: Inbox\n---\n\n# Tasks\n- [ ] precious capture\n'
      await mkdir(inboxDir(ws), { recursive: true })
      await writeFile(inboxBlipPath(ws), existing, 'utf8')
      await ensureInbox(ws)
      expect(await readFile(inboxBlipPath(ws), 'utf8')).toBe(existing)
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('serializes concurrent ensureInbox calls onto one creation (no lost writes)', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'radar-ws-'))
    try {
      const paths = await Promise.all([ensureInbox(ws), ensureInbox(ws), ensureInbox(ws)])
      expect(new Set(paths)).toEqual(new Set([inboxBlipPath(ws)]))
      // A capture racing the next ensureInbox (scan) must survive.
      const [rec] = await Promise.all([inboxAddTask(ws, 'Renew passport'), ensureInbox(ws)])
      expect(rec.tasks.map((t) => t.text)).toContain('Renew passport')
      expect(await readFile(inboxBlipPath(ws), 'utf8')).toContain('Renew passport')
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
