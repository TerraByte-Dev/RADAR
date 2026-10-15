// What the project keys do (renderer spec 9.1, 9.3) to one record: open its page, resume, the two
// prompts, and the two edits a row offers, and what Pick one for me deals (6.4). Every edit awaits
// `project.edit` and shows the record it answers with; nothing is optimistic (section 8). The
// prompts and Resume say what they did in a toast; an edit offers Undo in its toast (lib/edits).
import type { ProjectRecord, Task } from '@shared/model'
import { useBoard } from '../store/board'
import { UNDO_TOAST_MS, useShell } from '../store/shell'
import { edit } from './edits'
import { catchUpPrompt, reEntryPrompt } from './prompts'

/** Whether the row can take an edit: a v2, broken or newer file is read-only, and its write controls are not drawn. */
export const writable = (r: ProjectRecord): boolean => r.state === 'ok' && r.doc?.writable === true

/** A file that cannot be parsed shows nothing from it (section 8), so it hands no prompt to an agent either: C and L. */
export const canPrompt = (r: ProjectRecord): boolean => r.state !== 'needs-repair'

/** Resume (R) only where its button is drawn: not on a v2 page, nor a file that cannot be parsed. */
export const canResume = (r: ProjectRecord): boolean => r.state !== 'needs-repair' && r.state !== 'needs-migrate'

const copy = (text: string): Promise<void> => navigator.clipboard.writeText(text)

export const openProject = (r: ProjectRecord): void => useShell.getState().go({ view: 'project', id: r.id })

const say = (text: string): void => useShell.getState().say({ text })

/** Resume (9.3): the re-entry prompt to the clipboard and the folder open in the editor. Writes nothing to BLIP.md. */
export async function resume(r: ProjectRecord): Promise<void> {
  await copy(reEntryPrompt(r))
  const res = await window.radar.invoke('system.openInEditor', { id: r.id })
  const name = r.doc?.name ?? r.dir
  if (!res.ok) say(`Re-entry prompt copied. ${res.error.message}`)
  else say(`Re-entry prompt copied. ${name} is open in ${res.data.opened === 'folder' ? 'its folder' : 'your editor'}.`)
}

export async function copyPrompt(r: ProjectRecord): Promise<void> {
  await copy(reEntryPrompt(r))
  say('Re-entry prompt copied. Paste it into your agent.')
}

export async function catchUp(r: ProjectRecord): Promise<void> {
  await copy(catchUpPrompt(r))
  say('Catch-up prompt copied. Paste it into your agent.')
}

// ---- Pick one for me (6.4): deals pickOrder from [1]; never [0], which Continue shows ----

const EVERYTHING = 'That is everything from this week.'

/** `P`: opens on the second project in the order, or says there is nothing more to deal. */
export function openPick(order: ProjectRecord[]): void {
  if (order.length < 2) return say(EVERYTHING)
  useShell.setState({ overlay: 'pick', pickIndex: 1 })
}

/** `A`: the next one; after the last it closes and says so. */
export function anotherPick(order: ProjectRecord[]): void {
  const next = useShell.getState().pickIndex + 1
  if (next < order.length) return useShell.setState({ pickIndex: next })
  useShell.setState({ overlay: null })
  say(EVERYTHING)
}

/** `Esc`, Not now: closes; nothing is written. */
export const closePick = (): void => useShell.setState({ overlay: null })

/** `X`, a checkbox: the task is done. */
export const doneTask = (r: ProjectRecord, t: Task): Promise<unknown> => edit(r, [{ op: 'task.done', task: { title: t.title } }], `Done: ${t.title}`)

/** A ticked box in Show done: the task is open again, at the end of the queue. */
export const reopenTask = (r: ProjectRecord, t: Task): Promise<unknown> => edit(r, [{ op: 'task.reopen', task: { title: t.title } }], `Reopened: ${t.title}`)

/** `X`: the next step is done. */
export function markDone(r: ProjectRecord): Promise<unknown> {
  const next = r.doc?.next
  return next && writable(r) ? doneTask(r, next) : Promise.resolve()
}

/** `N`: the next step moves down one. */
export function notNow(r: ProjectRecord): Promise<unknown> {
  const open = r.doc?.tasks.open ?? []
  if (!open[0] || !writable(r)) return Promise.resolve()
  return edit(r, [{ op: 'task.move', task: { title: open[0].title }, before: open[2] ? { title: open[2].title } : null }], 'Moved down one. It will come back around.')
}

/** `F`: pins the project as focus, or unpins it. */
export function toggleFocus(r: ProjectRecord): Promise<unknown> {
  if (!writable(r)) return Promise.resolve()
  const on = !r.doc?.focus
  return edit(r, [{ op: 'set', field: 'focus', value: on }], on ? 'Pinned as focus.' : 'Unpinned.')
}

/** `E`: the folder in the editor. */
export async function openEditor(r: ProjectRecord): Promise<void> {
  const res = await window.radar.invoke('system.openInEditor', { id: r.id })
  if (!res.ok) say(res.error.message)
}

/** `H`: off the board (`project.setHidden`); the file is not touched, and Settings lists it. Undo in the toast. */
export async function hideProject(r: ProjectRecord): Promise<void> {
  const set = async (hidden: boolean): Promise<boolean> => {
    const res = await window.radar.invoke('project.setHidden', { id: r.id, hidden })
    if (!res.ok) say(res.error.message)
    else useBoard.getState().put(res.data.record)
    return res.ok
  }
  if (!(await set(true))) return
  useShell.getState().say({
    text: `${r.doc?.name ?? r.dir} is hidden from the board. Settings lists it.`,
    action: { label: 'Undo', run: () => void set(false) },
    ms: UNDO_TOAST_MS
  })
}
