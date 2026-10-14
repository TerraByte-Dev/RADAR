// R5 (renderer spec 8): every way an edit or an undo can answer, each from a mocked route
// result. A change is shown from the record the route answers with, offers Undo for ten seconds
// and Ctrl Z for five minutes; each refusal is one toast in the spec's words; a validation error
// goes back to the field that sent it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@shared/ipc'
import type { ProjectRecord } from '@shared/model'
import { useBoard } from '../store/board'
import { TOAST_MS, UNDO_TOAST_MS, useShell } from '../store/shell'
import { edit, undo, UNDO_MS } from './edits'

const rec = (title: string, rev = 'r1'): ProjectRecord =>
  ({
    id: 'p1',
    dir: 'C:\\Work\\p1',
    state: 'ok',
    doc: { name: 'P1', next: { title }, tasks: { open: [{ title }], done: [] } },
    activity: null,
    agent: { live: false, sessions: 0, lastSeenAt: null },
    hidden: false,
    rev
  }) as unknown as ProjectRecord

const OP = [{ op: 'task.done' as const, task: { title: 'Ship it' } }]
const fail = (error: ApiError) => ({ ok: false, error })
let invoke: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  invoke = vi.fn()
  vi.stubGlobal('window', { radar: { invoke, on: () => () => {} } })
  useBoard.setState({ projects: { p1: rec('Ship it') }, status: 'ready' })
  useShell.setState({ toast: null, undo: null, writing: {} })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('edit', () => {
  it('a change: the answered record is shown, Undo is offered for ten seconds, and the slot lasts five minutes', async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { record: rec('Next', 'r2'), report: [], undoToken: 'tok' } })
    expect(await edit(rec('Ship it'), OP, 'Done: Ship it')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('project.edit', { id: 'p1', ops: OP })
    expect(useBoard.getState().projects.p1?.rev).toBe('r2')
    const t = useShell.getState().toast
    expect([t?.text, t?.action?.label, t?.action?.caps, t?.ms]).toEqual(['Done: Ship it', 'Undo', 'Ctrl Z', UNDO_TOAST_MS])
    expect(useShell.getState().undo).toEqual({ id: 'p1', token: 'tok', expiresAt: Date.now() + UNDO_MS })
    vi.advanceTimersByTime(UNDO_TOAST_MS - 1)
    expect(useShell.getState().toast).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(useShell.getState().toast).toBeNull()
  })

  it('a change that changed nothing has no undo and no toast', async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { record: rec('Ship it'), report: [], undoToken: null } })
    await edit(rec('Ship it'), OP, 'Done: Ship it')
    expect(useShell.getState().toast).toBeNull()
    expect(useShell.getState().undo).toBeNull()
  })

  it('a repeat press while the edit is in flight is ignored', async () => {
    let answer: (v: unknown) => void = () => {}
    invoke.mockReturnValueOnce(new Promise((res) => (answer = res)))
    const first = edit(rec('Ship it'), OP, 'Done')
    expect(await edit(rec('Ship it'), OP, 'Done')).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(1)
    answer({ ok: true, data: { record: rec('Next'), report: [], undoToken: null } })
    await first
  })

  it('a field saved while another change to the project is in flight waits for it and is then sent, not dropped', async () => {
    let answer: (v: unknown) => void = () => {}
    invoke.mockReturnValueOnce(new Promise((res) => (answer = res)))
    const first = edit(rec('Ship it'), OP, 'Done')
    const NOW_OP = [{ op: 'set' as const, field: 'now' as const, value: 'Typed while the box was ticking' }]
    invoke.mockResolvedValueOnce({ ok: true, data: { record: rec('Next', 'r3'), report: [], undoToken: 'tok2' } })
    const second = edit(rec('Ship it'), NOW_OP, 'Now line changed.', { inline: true })
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledTimes(1)
    answer({ ok: true, data: { record: rec('Next', 'r2'), report: [], undoToken: null } })
    await first
    expect(await second).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1]).toEqual(['project.edit', { id: 'p1', ops: NOW_OP }])
  })

  it('an edit in flight marks its project as writing, for aria-busy, until it answers', async () => {
    let answer: (v: unknown) => void = () => {}
    invoke.mockReturnValueOnce(new Promise((res) => (answer = res)))
    const first = edit(rec('Ship it'), OP, 'Done')
    expect(useShell.getState().writing).toEqual({ p1: true })
    answer({ ok: true, data: { record: rec('Next'), report: [], undoToken: null } })
    await first
    expect(useShell.getState().writing).toEqual({})
  })

  it('an inline field refused with no violations: one toast, and null to the field, so it closes; Try again is a plain edit', async () => {
    const NOW_OP = [{ op: 'set' as const, field: 'now' as const, value: 'x' }]
    invoke.mockResolvedValueOnce(fail({ code: 'E_BUSY', message: 'BLIP.md kept changing while it was being written' }))
    expect(await edit(rec('Ship it'), NOW_OP, 'Now line changed.', { inline: true })).toBeNull()
    expect(useShell.getState().toast?.action?.label).toBe('Try again')
    invoke.mockResolvedValueOnce(fail({ code: 'E_VALIDATION', message: 'now is bad', violations: [{ code: 'E_NOW_STYLE', path: 'now', message: 'now is bad' }] }))
    useShell.getState().toast?.action?.run()
    await vi.waitFor(() => expect(useShell.getState().toast?.text).toBe('now is bad'))
  })

  it('E_TASK_GONE: the fresh record is put on screen and the toast says nothing was written', async () => {
    invoke.mockResolvedValueOnce(fail({ code: 'E_TASK_GONE', message: '"Ship it": there is no task with that title' }))
    invoke.mockResolvedValueOnce({ ok: true, data: { projects: [rec('Changed by an agent', 'r9')] } })
    await edit(rec('Ship it'), OP, 'Done')
    expect(invoke).toHaveBeenLastCalledWith('projects.list')
    expect(useBoard.getState().projects.p1?.rev).toBe('r9')
    const t = useShell.getState().toast
    expect([t?.lead, t?.text, t?.action]).toEqual(['An agent just changed that task.', 'The list is up to date now; nothing was written.', undefined])
    expect(t?.ms ?? TOAST_MS).toBe(TOAST_MS)
  })

  it('E_BUSY: the toast offers Try again, which sends the same change again', async () => {
    invoke.mockResolvedValueOnce(fail({ code: 'E_BUSY', message: 'BLIP.md kept changing while it was being written' }))
    await edit(rec('Ship it'), OP, 'Done: Ship it')
    const t = useShell.getState().toast
    expect([t?.lead, t?.text, t?.action?.label]).toEqual(['An agent is writing to this file.', 'Nothing was changed. Try again in a moment.', 'Try again'])
    invoke.mockResolvedValueOnce({ ok: true, data: { record: rec('Next', 'r2'), report: [], undoToken: 'tok' } })
    t?.action?.run()
    await vi.waitFor(() => expect(useShell.getState().toast?.text).toBe('Done: Ship it'))
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1]).toEqual(['project.edit', { id: 'p1', ops: OP }])
  })

  it.each(['E_NEEDS_MIGRATE', 'E_UNWRITABLE', 'E_NEWER_SCHEMA'])('%s: a toast with the engine message', async (code) => {
    invoke.mockResolvedValueOnce(fail({ code, message: `the engine says ${code}` }))
    const e = await edit(rec('Ship it'), OP, 'Done')
    expect(e?.code).toBe(code)
    expect(useShell.getState().toast).toEqual({ text: `the engine says ${code}` })
  })

  it('a validation error goes back to the field that sent it, every violation, and no toast', async () => {
    const violations = [
      { code: 'E_NOW_LENGTH', path: 'now', message: 'now is 141 chars (max 140)' },
      { code: 'E_NOW_STYLE', path: 'now', message: 'now starts with "- ", "#" or "[" — write one plain sentence' }
    ]
    invoke.mockResolvedValueOnce(fail({ code: 'E_VALIDATION', message: violations[0]!.message, violations }))
    const e = await edit(rec('Ship it'), [{ op: 'set', field: 'now', value: 'x' }], 'Now line changed.', { inline: true })
    expect(e?.violations).toEqual(violations)
    expect(useShell.getState().toast).toBeNull()
    expect(useBoard.getState().projects.p1?.rev).toBe('r1')
  })

  it('a validation error from a key, which has no field, is a toast with every violation', async () => {
    const violations = [{ code: 'E_VALUE', path: 'focus', message: 'focus must be true or false' }]
    invoke.mockResolvedValueOnce(fail({ code: 'E_VALUE', message: violations[0]!.message, violations }))
    await edit(rec('Ship it'), [{ op: 'set', field: 'focus', value: 'yes' }], 'Pinned as focus.')
    expect(useShell.getState().toast).toEqual({ text: 'focus must be true or false' })
  })
})

describe('undo', () => {
  it('Ctrl Z within five minutes: the earlier record is back', async () => {
    useShell.setState({ undo: { id: 'p1', token: 'tok', expiresAt: Date.now() + UNDO_MS } })
    invoke.mockResolvedValueOnce({ ok: true, data: { record: rec('Ship it', 'r0') } })
    await undo()
    expect(invoke).toHaveBeenCalledWith('project.undo', { id: 'p1', undoToken: 'tok' })
    expect(useBoard.getState().projects.p1?.rev).toBe('r0')
    expect(useShell.getState().toast?.text).toBe('Undone.')
    expect(useShell.getState().undo).toBeNull()
  })

  it('E_UNDO_STALE: too late, the file has changed since', async () => {
    useShell.setState({ undo: { id: 'p1', token: 'tok', expiresAt: Date.now() + UNDO_MS } })
    invoke.mockResolvedValueOnce(fail({ code: 'E_UNDO_STALE', message: 'too late to undo: the file has changed since, so it was left as it is' }))
    await undo()
    const t = useShell.getState().toast
    expect([t?.lead, t?.text]).toEqual(['Too late to undo.', 'The file has changed since.'])
    expect(useShell.getState().undo).toBeNull()
  })

  it('past five minutes it is too late, and the route is not called', async () => {
    useShell.setState({ undo: { id: 'p1', token: 'tok', expiresAt: Date.now() + UNDO_MS } })
    await undo(Date.now() + UNDO_MS + 1)
    expect(invoke).not.toHaveBeenCalled()
    expect(useShell.getState().toast?.lead).toBe('Too late to undo.')
  })

  it('with nothing to undo, Ctrl Z does nothing', async () => {
    await undo()
    expect(invoke).not.toHaveBeenCalled()
    expect(useShell.getState().toast).toBeNull()
  })
})
