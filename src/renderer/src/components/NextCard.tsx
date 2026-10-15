// The project page's centre (renderer spec 6.5): the Now line, edited in place, and the next-step
// card with its detail verbatim and the four actions, Mark done the one filled button. A legacy
// title past TITLE_MAX is clamped at three lines with Show all, here and in the queue.
import { Fragment, useState } from 'react'
import type { ProjectRecord, Task } from '@shared/model'
import { commitDays, displayTitle, startCost } from '../lib/derive'
import { edit } from '../lib/edits'
import { copyPrompt, markDone, notNow, openEditor, resume, writable } from '../lib/projectActions'
import { useShell } from '../store/shell'
import { Button } from './atoms'
import { TITLE_MAX, Verbatim } from './ContinueStrip'
import { Editor } from './Editor'

/** The Now line's length limit (radar-v3-spec 4.3); the counter shows past NOW_WARN. */
export const NOW_MAX = 140
export const NOW_WARN = 120

/** Where a task's expanded state lives in `shell.expanded`: its detail open, or its long title shown whole. */
export const taskKey = (r: ProjectRecord, t: Task, what: 'detail' | 'title'): string => `${r.id}:${t.key}:${what}`

export function toggleExpanded(key: string): void {
  const { expanded } = useShell.getState()
  const { [key]: on, ...rest } = expanded
  useShell.setState({ expanded: on ? rest : { ...rest, [key]: true } })
}

/** A title, whole; one past TITLE_MAX, which lint flags `title-long`, is clamped at three lines with Show all and Show less. */
export function LongTitle({ r, t, title, as: Tag = 'span', className }: { r: ProjectRecord; t: Task; title: string; as?: 'span' | 'h2'; className?: string }): JSX.Element {
  const key = taskKey(r, t, 'title')
  const whole = useShell((s) => !!s.expanded[key])
  if (title.length <= TITLE_MAX) return <Tag className={className}>{title}</Tag>
  return (
    <>
      <Tag className={[className, !whole && 'clamp'].filter(Boolean).join(' ')}>{title}</Tag>
      <span className="more">
        <span>Written before titles had a length limit.</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(key)
          }}
        >
          {whole ? 'Show less' : 'Show all'}
        </button>
      </span>
    </>
  )
}

/** Detail lines verbatim, one per line; only backtick spans are styled as code. */
export const DetailLines = ({ lines }: { lines: string[] }): JSX.Element => (
  <>
    {lines.map((l, i) => (
      <Fragment key={i}>
        {i > 0 && <br />}
        <Verbatim line={l} />
      </Fragment>
    ))}
  </>
)

export function NowLine({ r }: { r: ProjectRecord }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const now = r.doc?.now ?? null
  const can = writable(r)
  if (editing)
    return (
      <div className="nowline">
        <Editor
          value={now ?? ''}
          label="Now"
          multiline
          max={NOW_MAX}
          warnAt={NOW_WARN}
          onSave={(v) => edit(r, [{ op: 'set', field: 'now', value: v.trim() === '' ? null : v }], 'Now line changed.', { inline: true })}
          onClose={() => setEditing(false)}
        />
      </div>
    )
  const n = commitDays(r)
  const text = now ?? `No Now line yet. ${n > 0 ? `Commits on ${n} of the last 30 days.` : 'An agent writes one at its next sync.'}`
  return (
    <div
      className={now ? 'nowline' : 'nowline none'}
      role={can ? 'button' : undefined}
      tabIndex={can ? 0 : undefined}
      aria-label={can ? `Now: ${text} Click to edit.` : undefined}
      onClick={can ? () => setEditing(true) : undefined}
      onKeyDown={can ? (e) => e.key === 'Enter' && (e.preventDefault(), setEditing(true)) : undefined}
    >
      {text}
      <small>Now{can && ' · click to edit'}</small>
    </div>
  )
}

export interface NextCardProps {
  r: ProjectRecord
  owner: string | null
  /** `A`: opens the add-a-task field in the queue. */
  onAdd(): void
}

export function NextCard({ r, owner, onAdd }: NextCardProps): JSX.Element {
  const doc = r.doc
  const next = doc?.next ?? null
  const can = writable(r)
  const busy = useShell((s) => !!s.writing[r.id])
  if (!next)
    return (
      <section className="nextcard none" aria-label="Next step">
        <div className="lab">Next step</div>
        <h2>No tasks queued</h2>
        <div className="btns">
          {can && (
            <Button caps="A" onClick={onAdd}>
              Add a task
            </Button>
          )}
          <Button caps="C" onClick={() => void copyPrompt(r)}>
            Copy re-entry prompt
          </Button>
        </div>
      </section>
    )
  const cost = startCost(r, next, owner)
  const more = (doc?.tasks.open.length ?? 0) > 1
  // a v2 file (section 8): the two controls that only read stay, beside why the rest are gone
  const btns =
    r.state === 'needs-migrate' ? (
      <div className="btns">
        <Button caps="C" onClick={() => void copyPrompt(r)}>
          Copy re-entry prompt
        </Button>
        <Button caps="E" onClick={() => void openEditor(r)}>
          Open in editor
        </Button>
        <span className="hint">Mark done and Not now come back once the file is migrated.</span>
      </div>
    ) : (
      <div className="btns">
        {can && (
          <Button variant="primary" caps="X" busy={busy} onClick={() => void markDone(r)}>
            Mark done
          </Button>
        )}
        {can && more && (
          <Button caps="N" busy={busy} onClick={() => void notNow(r)}>
            Not now
          </Button>
        )}
        <Button caps="R" onClick={() => void resume(r)}>
          Resume
        </Button>
        <Button caps="C" onClick={() => void copyPrompt(r)}>
          Copy re-entry prompt
        </Button>
        {can && more && <span className="hint">Not now moves it down one. It never turns red.</span>}
      </div>
    )
  return (
    <section className="nextcard" aria-label="Next step">
      <div className="lab">
        <b>Next step</b>
        {cost && <span>· {cost}</span>}
      </div>
      <LongTitle r={r} t={next} title={displayTitle(next, owner)} as="h2" />
      {next.detail.length > 0 && (
        <div className="dt">
          <DetailLines lines={next.detail} />
        </div>
      )}
      {btns}
    </section>
  )
}
