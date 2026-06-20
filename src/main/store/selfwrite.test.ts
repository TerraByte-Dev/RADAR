import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSelfWriteEcho, noteSelfWrite } from './selfwrite'

async function tempBlip(content: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'radar-selfwrite-'))
  const file = join(dir, 'BLIP.md')
  await writeFile(file, content, 'utf8')
  return { dir, file }
}

describe('content-hash self-write suppression', () => {
  it('suppresses the echo of an app write exactly once', async () => {
    const content = '---\nname: A\n---\n'
    const { dir, file } = await tempBlip(content)
    try {
      noteSelfWrite(file, content)
      await expect(isSelfWriteEcho(file)).resolves.toBe(true) // our echo — suppressed
      await expect(isSelfWriteEcho(file)).resolves.toBe(false) // record consumed — rescan
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does NOT suppress a different-content external write inside the window', async () => {
    const ours = '---\nname: A\n---\n'
    const { dir, file } = await tempBlip(ours)
    try {
      noteSelfWrite(file, ours)
      // An agent lands its own write before the watcher event for ours arrives.
      await writeFile(file, '---\nname: A\nnext_action: agent handoff\n---\n', 'utf8')
      await expect(isSelfWriteEcho(file)).resolves.toBe(false) // the agent's change must surface
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats a path it never wrote as not-an-echo without touching disk', async () => {
    await expect(isSelfWriteEcho(join(tmpdir(), 'radar-selfwrite-never', 'BLIP.md'))).resolves.toBe(
      false
    )
  })

  it('matches a recorded self-delete against the unlink echo (file gone)', async () => {
    const content = '---\nname: D\n---\n'
    const { dir, file } = await tempBlip(content)
    try {
      noteSelfWrite(file, null) // app delete — expect an unlink echo
      await unlink(file)
      await expect(isSelfWriteEcho(file)).resolves.toBe(true)
      await expect(isSelfWriteEcho(file)).resolves.toBe(false) // consumed
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not let a recorded self-delete suppress an external recreate with content', async () => {
    const { dir, file } = await tempBlip('---\nname: R\n---\n')
    try {
      noteSelfWrite(file, null)
      // File still exists with content — an `add`/`change` event must not match the delete record.
      await expect(isSelfWriteEcho(file)).resolves.toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
