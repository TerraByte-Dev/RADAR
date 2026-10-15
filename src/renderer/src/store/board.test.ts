// The board store (renderer spec 2): projects.list, app.info and setup.status on start, then the
// three events; an event that lands while the list is in flight is newer than the list.
import { describe, expect, it } from 'vitest'
import type { Bridge, EventName, Events, Result } from '@shared/ipc'
import type { ProjectRecord } from '@shared/model'
import { createBoard } from './board'

const rec = (id: string, rev = '1'): ProjectRecord =>
  ({ id, dir: `/p/${id}`, state: 'ok', doc: null, activity: null, agent: { live: false, sessions: 0, lastSeenAt: null }, hidden: false, rev }) as ProjectRecord

function fakeApi(list: () => Promise<Result<{ projects: ProjectRecord[] }>>) {
  const subs = new Map<string, ((p: unknown) => void)[]>()
  const api = {
    invoke: (name: string) => {
      if (name === 'projects.list') return list()
      if (name === 'app.info') return Promise.resolve({ ok: true, data: { version: '3', engineVersion: '3', platform: 'win32', owner: 'Robin' } })
      if (name === 'setup.status') return Promise.resolve({ ok: true, data: { checks: [{ id: 'git', level: 'ok', message: 'git' }] } })
      return Promise.resolve({ ok: false, error: { code: 'E', message: name } })
    },
    on: (event: string, cb: (p: unknown) => void) => {
      subs.set(event, [...(subs.get(event) ?? []), cb])
      return () => subs.set(event, (subs.get(event) ?? []).filter((x) => x !== cb))
    }
  } as unknown as Bridge
  const emit = <E extends EventName>(event: E, payload: Events[E]): void => (subs.get(event) ?? []).forEach((cb) => cb(payload))
  return { api, emit, subs }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('board store', () => {
  it('reads the list, the owner and the doctor report, and follows the three events', async () => {
    const { api, emit } = fakeApi(async () => ({ ok: true, data: { projects: [rec('a'), rec('b')] } }))
    const board = createBoard()
    const stop = board.getState().start(api)
    expect(board.getState().status).toBe('loading')
    await flush()
    const s = board.getState()
    expect(s.status).toBe('ready')
    expect(Object.keys(s.projects)).toEqual(['a', 'b'])
    expect(s.owner).toBe('Robin')
    expect(s.setup?.[0]?.id).toBe('git')

    emit('project.changed', { record: rec('c') })
    emit('project.changed', { record: rec('a', '2') })
    emit('project.removed', { id: 'b' })
    emit('activity.changed', { id: 'a', activity: null, agent: { live: true, sessions: 1, lastSeenAt: null } })
    emit('activity.changed', { id: 'nobody', activity: null, agent: { live: true, sessions: 1, lastSeenAt: null } })
    const p = board.getState().projects
    expect(Object.keys(p).sort()).toEqual(['a', 'c'])
    expect(p.a?.rev).toBe('2')
    expect(p.a?.agent.live).toBe(true)

    stop()
    emit('project.removed', { id: 'a' })
    expect(board.getState().projects.a).toBeDefined()
  })

  it('keeps what an event said while the list was in flight', async () => {
    let answer!: (r: Result<{ projects: ProjectRecord[] }>) => void
    const { api, emit } = fakeApi(() => new Promise((r) => (answer = r)))
    const board = createBoard()
    board.getState().start(api)
    emit('project.changed', { record: rec('a', 'new') })
    emit('project.removed', { id: 'b' })
    answer({ ok: true, data: { projects: [rec('a', 'old'), rec('b'), rec('c')] } })
    await flush()
    const p = board.getState().projects
    expect(Object.keys(p).sort()).toEqual(['a', 'c'])
    expect(p.a?.rev).toBe('new')
  })

  it('keeps an activity.changed that arrives on first load, before the list has any record', async () => {
    let answer!: (r: Result<{ projects: ProjectRecord[] }>) => void
    const { api, emit } = fakeApi(() => new Promise((r) => (answer = r)))
    const board = createBoard()
    board.getState().start(api)
    const activity = { lastTouchedAt: '2026-10-14T09:00:00Z', computedAt: '2026-10-14T09:00:01Z', source: 'git' } as ProjectRecord['activity']
    const agent = { live: true, sessions: 1, lastSeenAt: null }
    emit('activity.changed', { id: 'a', activity, agent })
    emit('activity.changed', { id: 'b', activity, agent })
    emit('project.removed', { id: 'b' })
    answer({ ok: true, data: { projects: [rec('a'), rec('b')] } })
    await flush()
    const p = board.getState().projects
    expect(Object.keys(p)).toEqual(['a'])
    expect(p.a?.activity).toEqual(activity)
    expect(p.a?.agent.live).toBe(true)
  })

  it('reports a failed list, and Try again reads it again', async () => {
    let fail = true
    const { api } = fakeApi(async () => (fail ? { ok: false, error: { code: 'E_IO', message: 'disk gone' } } : { ok: true, data: { projects: [rec('a')] } }))
    const board = createBoard()
    board.getState().start(api)
    await flush()
    expect(board.getState()).toMatchObject({ status: 'error', error: { message: 'disk gone' } })
    fail = false
    await board.getState().reload(api)
    expect(board.getState()).toMatchObject({ status: 'ready', error: null })
  })

  it('tick moves the clock', () => {
    const board = createBoard()
    board.getState().tick(42)
    expect(board.getState().now).toBe(42)
  })
})
