import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureInbox, inboxAddTask, inboxBlipPath } from './workspace'

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
})
