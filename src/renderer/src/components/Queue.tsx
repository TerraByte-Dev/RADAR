// The queue (renderer spec 6.5): the tasks after the next step. Five rows, then one row that
// shows the rest in place (remembered per project for the session), adds a task and shows what
// is done. Nothing states how many remain and no row carries a position number. A row with
// detail expands inline; its checkbox marks it done; Alt and the arrows, or a drag, move it.
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MutableRefObject, type RefObject } from 'react'
import type { ApiError } from '@shared/ipc'
import type { ProjectRecord, Task } from '@shared/model'
import { displayTitle, dueLabel, ownerOnly } from '../lib/derive'
import { edit } from '../lib/edits'
import { doneTask, reopenTask, writable } from '../lib/projectActions'
import { useShell } from '../store/shell'
import { Chip, Keys, Segmented } from './atoms'
import { keepUndo } from './Editor'
import { DetailLines, LongTitle, taskKey, toggleExpanded } from './NextCard'
import { dayMon } from './ProjectFacts'

/** Rows shown before Show the rest of the queue. */
export const QUEUE_SHOWN = 5
/** Past this many rows the rest loads in steps of as many, as the list is scrolled. */
export const QUEUE_WINDOW = 200

export type Who = 'all' | 'you' | 'agent'

/** The queue's rows: every open task after the next step, narrowed by the owner filter and the text filter. */
export function queueRows(r: ProjectRecord, owner: string | null, who: Who, q: string): Task[] {
  const needle = q.trim().toLowerCase()
  return (r.doc?.tasks.open ?? [])
    .slice(1)
    .filter((t) => who === 'all' || owner === null || ownerOnly(t, owner) === (who === 'you'))
    .filter((t) => !needle || t.title.toLowerCase().includes(needle))
}

const Chevron = (): JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 2l3 3-3 3" />
  </svg>
)

/** Moves `t` one place up or down among all the open tasks: before its neighbour above, or before the one two below. */
export function moveBy(r: ProjectRecord, t: Task, step: -1 | 1): Promise<unknown> {
  const open = r.doc?.tasks.open ?? []
  const i = open.findIndex((x) => x.key === t.key)
  if (i < 0 || i + step < 0 || i + step >= open.length) return Promise.resolve()
  const before = step < 0 ? open[i - 1] : (open[i + 2] ?? null)
  return edit(r, [{ op: 'task.move', task: { title: t.title }, before: before && { title: before.title } }], `Moved: ${t.title}`)
}

/**
 * Where a row dropped on `target` goes: the engine puts a task before `before`, so a row dragged
 * down lands after the target (before the one after it) and a row dragged up lands before it.
 */
export function dropBefore(open: Task[], from: Task, target: Task): Task | null {
  const i = open.findIndex((x) => x.key === from.key)
  const j = open.findIndex((x) => x.key === target.key)
  return i < j ? (open[j + 1] ?? null) : target
}

/** A done task's date in Show done, in the page's day-month voice. */
export const doneLabel = (iso: string | null): string => (iso ? dayMon(iso) : '')

interface TaskValues {
  title: string
  detail: string
  due: string
}

/** Which field a violation belongs under, by its path; anything else goes under the last text field. */
const fieldOf = (path: string, hasDetail: boolean): keyof TaskValues =>
  path.startsWith('title') ? 'title' : path.startsWith('due') ? 'due' : hasDetail ? 'detail' : 'title'

/**
 * A task's fields edited together (title, the detail lines when `detail` is given, due), sent as
 * one change. Enter in any field saves and Shift+Enter breaks a detail line; Esc closes, and does
 * not also go back. Each violation shows under the field it names (renderer spec 8).
 */
function TaskForm({
  initial,
  labels,
  onSave,
  onClose
}: {
  initial: Omit<TaskValues, 'detail'> & { detail: string | null }
  labels: { title: string; titlePlaceholder?: string; due: string }
  onSave(v: TaskValues): Promise<ApiError | null>
  onClose(): void
}): JSX.Element {
  const hasDetail = initial.detail !== null
  const [v, setV] = useState<TaskValues>({ ...initial, detail: initial.detail ?? '' })
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const e = await onSave(v)
    setBusy(false)
    if (e) setError(e)
    else onClose()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    keepUndo(e)
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter' && !(e.currentTarget.tagName === 'TEXTAREA' && e.shiftKey)) {
      e.preventDefault()
      void save()
    }
  }
  const problems = (f: keyof TaskValues): string[] =>
    !error ? [] : error.violations?.length ? error.violations.filter((x) => fieldOf(x.path, hasDetail) === f).map((x) => x.message) : f === fieldOf('', hasDetail) ? [error.message] : []
  const field = (f: keyof TaskValues, input: JSX.Element): JSX.Element => {
    const p = problems(f)
    return (
      <div className={f === 'due' ? 'ed due' : 'ed'}>
        {input}
        {p.length > 0 && (
          <ul className="viol" role="alert">
            {p.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  const props = (f: keyof TaskValues) => ({
    value: v[f],
    onChange: (e: { target: { value: string } }) => setV({ ...v, [f]: e.target.value }),
    onKeyDown,
    'aria-busy': busy || undefined,
    'aria-invalid': problems(f).length > 0 || undefined
  })
  return (
    <>
      {field('title', <input aria-label={labels.title} placeholder={labels.titlePlaceholder} autoFocus {...props('title')} />)}
      {hasDetail && field('detail', <textarea aria-label="Detail" rows={4} placeholder="Detail, one line each" {...props('detail')} />)}
      {field('due', <input aria-label={labels.due} type="date" {...props('due')} />)}
    </>
  )
}

/** An open task's editor: title, detail lines and due date, sent as one `task.edit`. */
function TaskEditor({ r, t, onClose }: { r: ProjectRecord; t: Task; onClose(): void }): JSX.Element {
  return (
    <div className="tedit" onClick={(e) => e.stopPropagation()}>
      <TaskForm
        initial={{ title: t.title, detail: t.detail.join('\n'), due: t.due ?? '' }}
        labels={{ title: 'Title', due: 'Due' }}
        onSave={({ title, detail, due }) =>
          edit(
            r,
            [{ op: 'task.edit', task: { title: t.title }, title, detail: detail.split('\n').filter((l) => l.trim() !== ''), due: due || null }],
            `Changed: ${title}`,
            { inline: true }
          )
        }
        onClose={onClose}
      />
    </div>
  )
}

interface RowProps {
  r: ProjectRecord
  t: Task
  owner: string | null
  today: string
  selected: boolean
  onSelect(key: string): void
  drag: { from: MutableRefObject<Task | null> }
}

function TaskRow({ r, t, owner, today, selected, onSelect, drag }: RowProps): JSX.Element {
  const openKey = taskKey(r, t, 'detail')
  const open = useShell((s) => !!s.expanded[openKey])
  const [editing, setEditing] = useState(false)
  const can = writable(r)
  const due = dueLabel(t.due, today)
  const toggle = (): void => {
    onSelect(t.key)
    toggleExpanded(openKey)
  }
  const busy = useShell((s) => !!s.writing[r.id])
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    const from = drag.from.current
    if (!from || from.key === t.key) return
    const before = dropBefore(r.doc?.tasks.open ?? [], from, t)
    void edit(r, [{ op: 'task.move', task: { title: from.title }, before: before && { title: before.title } }], `Moved: ${from.title}`)
  }
  return (
    <li
      id={`task-${t.key}`}
      tabIndex={-1}
      aria-current={selected || undefined}
      className={[open && 'open', selected && 'sel'].filter(Boolean).join(' ') || undefined}
      onClick={toggle}
      draggable={can && !editing}
      onDragStart={() => (drag.from.current = t)}
      onDragOver={(e) => can && e.preventDefault()}
      onDrop={onDrop}
    >
      {can ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={false}
          aria-label={`Mark done: ${t.title}`}
          aria-busy={busy || undefined}
          className="bx"
          onClick={(e) => {
            e.stopPropagation()
            void doneTask(r, t)
          }}
        />
      ) : (
        <span />
      )}
      <LongTitle r={r} t={t} title={displayTitle(t, owner)} className="t" />
      <span className="c-you">{ownerOnly(t, owner) && <Chip>you</Chip>}</span>
      <span className="c-due">{due && <Chip quiet>{due}</Chip>}</span>
      <span className={open ? 'car dn' : 'car'} title={t.detail.length ? 'Has detail' : undefined}>
        {t.detail.length > 0 && <Chevron />}
      </span>
      {open && t.detail.length > 0 && (
        <div className="dd">
          <DetailLines lines={t.detail} />
        </div>
      )}
      {open && can && !editing && (
        <div className="tacts" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
          <span>·</span>
          <button type="button" onClick={() => void edit(r, [{ op: 'task.remove', task: { title: t.title } }], `Removed: ${t.title}`)}>
            Remove
          </button>
          <span>·</span>
          <span>
            <Keys caps="Alt ↑" /> <Keys caps="Alt ↓" /> moves it
          </span>
        </div>
      )}
      {open && editing && <TaskEditor r={r} t={t} onClose={() => setEditing(false)} />}
    </li>
  )
}

function AddTask({ r, onClose }: { r: ProjectRecord; onClose(): void }): JSX.Element {
  return (
    <li className="add">
      <TaskForm
        initial={{ title: '', detail: null, due: '' }}
        labels={{ title: 'New task', titlePlaceholder: 'Add a task', due: 'Due, optional' }}
        onSave={({ title, due }) => edit(r, [{ op: 'task.add', title, ...(due ? { due } : {}) }], `Added: ${title}`, { inline: true })}
        onClose={onClose}
      />
    </li>
  )
}

export interface QueueProps {
  r: ProjectRecord
  owner: string | null
  today: string
  /** The selected row, which J K move and Space opens. */
  selected: string | null
  onSelect(key: string | null): void
  /** The rows J K move through, as shown. */
  onRows(rows: Task[]): void
  adding: boolean
  setAdding(on: boolean): void
  filterRef: RefObject<HTMLInputElement>
}

export function Queue({ r, owner, today, selected, onSelect, onRows, adding, setAdding, filterRef }: QueueProps): JSX.Element {
  const [who, setWho] = useState<Who>('all')
  const [q, setQ] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [limit, setLimit] = useState(QUEUE_WINDOW)
  const all = useShell((s) => !!s.queueOpen[r.id])
  const busy = useShell((s) => !!s.writing[r.id])
  const can = writable(r)
  const drag = { from: useRef<Task | null>(null) }
  const rows = useMemo(() => queueRows(r, owner, who, q), [r, owner, who, q])
  const shown = all ? rows.slice(0, limit) : rows.slice(0, QUEUE_SHOWN)
  const done = r.doc?.tasks.done ?? []
  const sentinel = useRef<HTMLLIElement>(null)

  useEffect(() => {
    onRows(shown)
  }, [shown.map((t) => t.key).join('\n')])

  // past QUEUE_WINDOW the rest loads as the end of the list comes into view
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setLimit((n) => n + QUEUE_WINDOW))
    io.observe(el)
    return () => io.disconnect()
  }, [all, limit < rows.length])

  const setAll = (on: boolean): void => {
    const { [r.id]: _was, ...rest } = useShell.getState().queueOpen
    useShell.setState({ queueOpen: on ? { ...rest, [r.id]: true } : rest })
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    const t = shown.find((x) => x.key === selected)
    if (!e.altKey || !t || !can || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    void moveBy(r, t, e.key === 'ArrowUp' ? -1 : 1)
  }

  return (
    <section aria-label="Queue">
      <div className="qh">
        <h3>Queue</h3>
        <span className="sp" />
        {owner !== null && (
          <Segmented<Who>
            label="Show"
            value={who}
            onChange={setWho}
            options={[
              { value: 'all', label: 'All' },
              { value: 'you', label: 'Needs you' },
              { value: 'agent', label: 'Agent can start' }
            ]}
          />
        )}
        <label className="filter">
          <input
            ref={filterRef}
            value={q}
            placeholder="Filter tasks"
            aria-label="Filter tasks"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              keepUndo(e)
              if (e.key === 'Escape') {
                e.preventDefault()
                setQ('')
                e.currentTarget.blur()
              }
            }}
          />
          <Keys caps="/" />
        </label>
      </div>
      <ul className="q" aria-label="Queue" onKeyDown={onKeyDown}>
        {shown.map((t) => (
          <TaskRow key={t.key} r={r} t={t} owner={owner} today={today} selected={t.key === selected} onSelect={onSelect} drag={drag} />
        ))}
        {all && limit < rows.length && <li ref={sentinel} className="load" aria-hidden="true" />}
        {adding && can && <AddTask r={r} onClose={() => setAdding(false)} />}
        <li className="rest">
          <span>
            {!all && rows.length > QUEUE_SHOWN && (
              <button type="button" onClick={() => setAll(true)}>
                Show the rest of the queue
              </button>
            )}
            {all && rows.length > QUEUE_SHOWN && (
              <button type="button" onClick={() => setAll(false)}>
                Show less
              </button>
            )}
          </span>
          <span className="end">
            {/* with no next step the card holds the one Add a task */}
            {can && !adding && r.doc?.next && (
              <button type="button" onClick={() => setAdding(true)}>
                Add a task <Keys caps="A" />
              </button>
            )}
            {done.length > 0 && (
              <button type="button" onClick={() => setShowDone(!showDone)}>
                {showDone ? 'Hide done' : 'Show done'}
              </button>
            )}
          </span>
        </li>
      </ul>
      {showDone && (
        <ul className="q done" aria-label="Done">
          {done.map((t) => (
            <li key={t.key}>
              {can ? (
                <button type="button" role="checkbox" aria-checked={true} aria-label={`Reopen: ${t.title}`} aria-busy={busy || undefined} className="bx on" onClick={() => void reopenTask(r, t)} />
              ) : (
                <span />
              )}
              <span className="t">{displayTitle(t, owner)}</span>
              <span />
              <span className="c-due mono">{doneLabel(t.doneOn)}</span>
              <span />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
