// Every write the renderer makes to a BLIP.md (renderer spec 8): one `project.edit` call per
// change, awaited, its record shown at once (nothing is optimistic), an undo toast for ten seconds
// and Ctrl Z for five minutes, and one toast for each way a change can be refused. A validation
// error goes back to the field that sent it, which shows every violation under itself.
import type { ApiError } from '@shared/ipc'
import type { EditOp, ProjectRecord } from '@shared/model'
import { useBoard } from '../store/board'
import { UNDO_TOAST_MS, useShell, type Toast } from '../store/shell'

/** How long Ctrl Z can still undo the last change (the engine keeps its slot as long). */
export const UNDO_MS = 5 * 60_000

/** Each project's write in flight: a repeat press is ignored until it answers. */
const inflight = new Map<string, Promise<unknown>>()

/** Marks a project's write controls busy (aria-busy) or not. */
function writing(id: string, on: boolean): void {
  const { [id]: _was, ...rest } = useShell.getState().writing
  useShell.setState({ writing: on ? { ...rest, [id]: true } : rest })
}

const say = (toast: Toast): void => useShell.getState().say(toast)

/** The record as main holds it now, after an agent changed the file under an edit. */
async function refresh(id: string): Promise<void> {
  const res = await window.radar.invoke('projects.list')
  const r = res.ok ? res.data.projects.find((p) => p.id === id) : undefined
  if (r) useBoard.getState().put(r)
}

/** The toast for a change that was refused; `retry` sends it again (Try again). */
async function refused(id: string, e: ApiError, retry: () => void): Promise<void> {
  switch (e.code) {
    case 'E_TASK_GONE':
      await refresh(id)
      return say({ lead: 'An agent just changed that task.', text: 'The list is up to date now; nothing was written.' })
    case 'E_BUSY':
      return say({ lead: 'An agent is writing to this file.', text: 'Nothing was changed. Try again in a moment.', action: { label: 'Try again', run: retry } })
    default:
      // E_NEEDS_MIGRATE, E_UNWRITABLE, E_NEWER_SCHEMA (their controls are not drawn) and anything else: the engine's words
      return say({ text: e.violations?.length ? e.violations.map((v) => v.message).join(' ') : e.message })
  }
}

export interface EditOptions {
  /** The field that sent it shows a validation error itself, under the field, so no toast is shown for one. */
  inline?: boolean
}

/**
 * Sends `ops` to the project and shows the record it answers with. `done` is the undo toast's
 * text. Answers null when the change was made, ignored as a repeat press, or refused with a
 * toast; an inline field gets its validation error back, to show under itself.
 */
export async function edit(r: ProjectRecord, ops: EditOp[], done: string, opts: EditOptions = {}): Promise<ApiError | null> {
  if (inflight.has(r.id)) {
    // a press of a control is a repeat; a field's text is not dropped, it is sent once the write in flight answers
    if (!opts.inline) return null
    while (inflight.has(r.id)) await inflight.get(r.id)
  }
  const sent = window.radar.invoke('project.edit', { id: r.id, ops })
  inflight.set(r.id, sent)
  writing(r.id, true)
  let res
  try {
    res = await sent
  } finally {
    inflight.delete(r.id)
    writing(r.id, false)
  }
  if (res.ok) {
    useBoard.getState().put(res.data.record)
    const token = res.data.undoToken
    // a change that changed nothing has no undo and says nothing
    if (token) {
      useShell.setState({ undo: { id: r.id, token, expiresAt: Date.now() + UNDO_MS } })
      say({ text: done, action: { label: 'Undo', caps: 'Ctrl Z', run: () => void undo() }, ms: UNDO_TOAST_MS })
    }
    return null
  }
  const e = res.error
  if (opts.inline && e.violations?.length) return e
  // toasted, so a field closes; Try again is a plain edit, which toasts whatever it answers
  await refused(r.id, e, () => void edit(r, ops, done))
  return opts.inline ? null : e
}

/** `Ctrl Z`: undoes the last change while the engine still can. */
export async function undo(now = Date.now()): Promise<void> {
  const slot = useShell.getState().undo
  if (!slot) return
  useShell.setState({ undo: null })
  const stale = (): void => say({ lead: 'Too late to undo.', text: 'The file has changed since.' })
  if (now > slot.expiresAt) return stale()
  const res = await window.radar.invoke('project.undo', { id: slot.id, undoToken: slot.token })
  if (res.ok) {
    useBoard.getState().put(res.data.record)
    return say({ text: 'Undone.' })
  }
  if (res.error.code === 'E_UNDO_STALE') return stale()
  say({ text: res.error.message })
}
