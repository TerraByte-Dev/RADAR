import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectId, registerProject, syncProject } from 'radar-blip'
import { POLL_MS } from './board'
import { gitSpy, harness, isolate, project, tmp, v3 } from './testkit'

let data: string
beforeEach(() => {
  data = isolate()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(() => {
  vi.useRealTimers()
})

const count = (events: { event: string }[], name: string): number => events.filter((e) => e.event === name).length

/** Show the board and let the first tick and the first activity pass finish, then forget their events. */
async function shown(h: ReturnType<typeof harness>): Promise<void> {
  await h.board.ready()
  h.board.setVisible(true)
  await h.board.tick()
  await vi.waitFor(() => expect(h.board.list().every((r) => r.activity !== null)).toBe(true))
  await new Promise((r) => setTimeout(r, 20))
  h.events.length = 0
}

/** Run one poll interval and wait for the pass it started. */
async function oneTick(h: ReturnType<typeof harness>): Promise<void> {
  await vi.advanceTimersByTimeAsync(POLL_MS)
  await h.board.tick()
}

describe('the poll (spec 8.4)', () => {
  it('an external write: exactly one project.changed within one tick', async () => {
    const dir = await project(v3('Polled'), 'polled')
    const h = harness()
    await shown(h)
    await syncProject(dir, { now: 'An agent moved this on.' }, { author: 'Robin' })
    await oneTick(h)
    expect(count(h.events, 'project.changed')).toBe(1)
    expect((h.events[0]!.payload as any).record.doc.now).toBe('An agent moved this on.')
    await oneTick(h)
    expect(count(h.events, 'project.changed')).toBe(1)
  })

  it("the app's own write: zero events", async () => {
    const dir = await project(v3('Own'), 'own')
    const h = harness()
    await shown(h)
    const r = await h.call('project.edit', { id: projectId(dir), ops: [{ op: 'set', field: 'now', value: 'Written by the app.' }] })
    expect(r.ok).toBe(true)
    await oneTick(h)
    await oneTick(h)
    expect(h.events).toEqual([])
  })

  it("deleting the file: state 'missing'", async () => {
    const dir = await project(v3('Vanishing'), 'vanishing')
    const h = harness()
    await shown(h)
    rmSync(join(dir, 'BLIP.md'))
    await oneTick(h)
    const changed = h.events.filter((e) => e.event === 'project.changed')
    expect(changed).toHaveLength(1)
    expect((changed[0]!.payload as any).record).toMatchObject({ state: 'missing', doc: null })
  })

  it('a new registry entry: one project.changed', async () => {
    await project(v3('First'), 'first')
    const h = harness()
    await shown(h)
    const second = await project(v3('Second'), 'second', false)
    await registerProject(second)
    await oneTick(h)
    const changed = h.events.filter((e) => e.event === 'project.changed')
    expect(changed).toHaveLength(1)
    expect((changed[0]!.payload as any).record.dir).toBe(second)
    expect(h.board.list()).toHaveLength(2)
  })

  it('a state-file change alone: one activity refresh and no project.changed', async () => {
    const dir = await project(v3('Acknowledged'), 'ack')
    const h = harness()
    await shown(h)
    const queue = vi.spyOn(h.board, 'queue')
    // A no-op sync: the engine records lastSyncAt and leaves BLIP.md alone.
    await syncProject(dir, {}, { author: 'Robin' })
    await oneTick(h)
    expect(queue).toHaveBeenCalledTimes(1)
    expect(queue).toHaveBeenCalledWith([projectId(dir)])
    await vi.waitFor(() => expect(count(h.events, 'activity.changed')).toBe(1))
    expect(count(h.events, 'project.changed')).toBe(0)
  })

  it('a live marker appearing: activity.changed with the agent, no project.changed', async () => {
    const dir = await project(v3('Live'), 'live')
    const h = harness()
    await shown(h)
    const transcript = join(tmp(), 's1.jsonl')
    writeFileSync(transcript, '{}\n')
    mkdirSync(join(data, 'live'), { recursive: true })
    writeFileSync(join(data, 'live', 's1.json'), JSON.stringify({ sessionId: 's1', cwd: dir, transcriptPath: transcript }))
    await oneTick(h)
    const first = h.events.find((e) => e.event === 'activity.changed')
    expect((first!.payload as any).agent).toMatchObject({ live: true, sessions: 1 })
    expect(count(h.events, 'project.changed')).toBe(0)
  })

  it('hidden: the timer is cleared at once and nothing is spawned for two minutes; shown: one tick runs', async () => {
    const dirs = [await project(v3('Hidden one'), 'h1'), await project(v3('Hidden two'), 'h2')]
    const git = gitSpy()
    const h = harness({ git })
    await shown(h)
    expect(git.calls).toBeGreaterThan(0) // shown: activity was computed
    expect(vi.getTimerCount()).toBe(1)

    h.board.setVisible(false)
    expect(vi.getTimerCount()).toBe(0)
    git.calls = 0
    const tick = vi.spyOn(h.board, 'tick')
    // Work that would wake a visible board.
    await syncProject(dirs[0]!, { now: 'Changed while hidden.' }, { author: 'Robin' })
    const old = new Date(Date.now() - 10 * 60_000)
    utimesSync(join(dirs[1]!, 'BLIP.md'), old, old)
    await h.call('activity.refresh')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(git.calls).toBe(0)
    expect(tick).not.toHaveBeenCalled()
    expect(h.events).toEqual([])

    h.board.setVisible(true)
    expect(tick).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    await h.board.tick()
    expect(count(h.events, 'project.changed')).toBe(1)
  })

  it('an activity refresh in flight during an edit does not put the pre-edit document back', async () => {
    const dir = await project(v3('Racer', ['Alpha task here', 'Beta task here']), 'racer')
    const id = projectId(dir)
    let gate: Promise<void> | null = null
    let calls = 0
    const git = {
      run: async (): Promise<string> => {
        calls++
        if (gate) await gate
        throw new Error('no git in this test')
      }
    }
    const h = harness({ git })
    await shown(h)
    let release!: () => void
    gate = new Promise<void>((r) => (release = r))
    calls = 0
    expect((await h.call('activity.refresh', { ids: [id] })).ok).toBe(true)
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0))
    const r = await h.call('project.edit', { id, ops: [{ op: 'task.done', task: { title: 'Alpha task here' } }] })
    expect(r.data.record.doc.next.title).toBe('Beta task here')
    gate = null
    release()
    await new Promise((res) => setTimeout(res, 100))
    for (let i = 0; i < 3; i++) await oneTick(h)
    expect(h.board.get(id).doc!.next!.title).toBe('Beta task here')
    for (const e of h.events.filter((e) => e.event === 'project.changed')) expect((e.payload as any).record.doc.next.title).toBe('Beta task here')
  })

  it('a live transcript that keeps being written: activity.changed with the new time, and no git', async () => {
    const dir = await project(v3('Livewire'), 'livewire')
    const git = { calls: 0, run: async (): Promise<string> => (git.calls++, '') }
    const h = harness({ git })
    const transcript = join(tmp(), 's1.jsonl')
    writeFileSync(transcript, '{}\n')
    mkdirSync(join(data, 'live'), { recursive: true })
    writeFileSync(join(data, 'live', 's1.json'), JSON.stringify({ sessionId: 's1', cwd: dir, transcriptPath: transcript }))
    await shown(h)
    await new Promise((r) => setTimeout(r, 50))
    git.calls = 0
    h.events.length = 0
    for (let i = 1; i <= 3; i++) {
      const t = new Date(Date.now() - 60_000 + i * 1000)
      utimesSync(transcript, t, t)
      await oneTick(h)
    }
    await new Promise((r) => setTimeout(r, 50))
    expect(git.calls).toBe(0)
    expect(count(h.events, 'activity.changed')).toBe(3)
    expect(h.events.every((e) => (e.payload as any).agent.live === true)).toBe(true)
  })

  it('hiding the window stops git calls that are already under way', async () => {
    for (let i = 0; i < 3; i++) await project(v3(`Repo ${i}`), `repo${i}`)
    let hidden = false
    let afterHide = 0
    let first!: () => void
    const started = new Promise<void>((r) => (first = r))
    const git = {
      run: async (): Promise<string> => {
        first()
        if (hidden) afterHide++
        await new Promise((r) => setTimeout(r, 50))
        return ''
      }
    }
    const h = harness({ git })
    await h.board.ready()
    h.board.setVisible(true)
    await started
    h.board.setVisible(false)
    hidden = true
    const events = h.events.length
    await new Promise((r) => setTimeout(r, 500))
    expect(afterHide).toBe(0)
    expect(h.events.length).toBe(events)
  })

  it('activity reaches activity-cache.json, and a new board starts from it', async () => {
    await project(v3('Cached'), 'cached')
    const h = harness()
    await shown(h)
    await vi.waitFor(async () => {
      const again = harness()
      const list = (await again.call('projects.list')).data.projects
      expect(list[0].activity).not.toBeNull()
    })
  })
})
