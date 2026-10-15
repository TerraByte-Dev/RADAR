// A project's row on the Pick up list (renderer spec 6.2) and the parts it is made of: the focus
// mark, the live mark, the next step and the facts column. Which parts show at which width and
// density is CSS (styles/app.css), so every variant renders the same next step, whole.
import type { MouseEvent } from 'react'
import type { ProjectRecord, Task } from '@shared/model'
import { activityProblem, ageLabel, ageWords, behind, branchLabel, commitDays, days, displayTitle, dueLabel, dueWords, folderName, localDate, ownerOnly, sourceGlyph, startCost } from '../lib/derive'
import { catchUp, copyPrompt, markDone, notNow, openProject, resume, writable } from '../lib/projectActions'
import { Button, Chip, Keys } from './atoms'
import { problemLine, repairProblem } from './Banner'
import { FilesGlyph, GitGlyph, LagGlyph } from './glyphs'

export type RowVariant = 'full' | 'line' | 'continued'

/** 8px green diamond when pinned, else a 5px dot (hollow in line rows, by CSS). */
export const FocusMark = ({ focus }: { focus: boolean }): JSX.Element => (
  <div className={focus ? 'mk f' : 'mk'} title={focus ? 'Pinned as focus' : undefined}>
    <i />
  </div>
)

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * A row's accessible name (section 11): "{name}. {Now}. Next: {title}. {start cost}. {due}. Last
 * worked {age} ago. {why the age fell back}." The continued row's ends "Shown in Continue above."
 * The row's text is drawn for the eye only, so everything it says is said here, in words.
 */
export function rowName(r: ProjectRecord, owner: string | null, now: number, continued = false, expanded = false): string {
  const doc = r.doc
  const parts = [doc?.name ?? folderName(r.dir)]
  if (r.state === 'needs-repair') parts.push('Read-only', problemLine(repairProblem(r)))
  else {
    if (doc?.focus) parts.push('Focus')
    if (doc?.status === 'paused') parts.push('Paused')
    if (doc?.status === 'blocked') parts.push('Waiting')
    if (doc?.now) parts.push(doc.now.replace(/[.\s]+$/, ''))
    const next = doc?.next ?? null
    parts.push(next ? `Next: ${displayTitle(next, owner).replace(/[.\s]+$/, '')}` : 'No tasks queued')
    const cost = next ? startCost(r, next, owner) : r.agent.live ? 'an agent is in here now' : null
    if (cost) parts.push(cap(cost))
    // the you chip, which a live session's start cost replaces
    if (next && r.agent.live && ownerOnly(next, owner)) parts.push('Needs you')
    const due = dueWords(next?.due ?? doc?.due ?? null, localDate(now))
    if (due) parts.push(due)
    if (r.state === 'needs-migrate') parts.push('Version 2 file, read-only')
  }
  if (r.activity !== null) {
    const d = days(r, now)
    parts.push(d === null ? 'Not worked on yet' : d < 1 ? 'Last worked today' : `Last worked ${ageWords(d)} ago`)
    const problem = activityProblem(r)
    if (problem) parts.push(problem.title.replace(/[.\s]+$/, ''))
  }
  if (r.activity === null && !r.agent.live) parts.push('Reading activity')
  if (expanded) {
    const more = (doc?.tasks.open ?? []).slice(1, 3)
    const say = (t: Task): string => displayTitle(t, owner).replace(/[.\s]+$/, '') + (ownerOnly(t, owner) ? ', needs you' : '')
    if (more.length) parts.push(`Then: ${more.map(say).join('; ')}`)
    if (behind(r)) parts.push('The log is behind the work')
  }
  if (continued) parts.push('Shown in Continue above')
  return parts.join('. ') + '.'
}

/** A detected agent session: a green dot and the word. Nothing when there is none. */
export const LiveMark = ({ live, words = 'live' }: { live: boolean; words?: string }): JSX.Element | null =>
  live ? <span className="livec">{words}</span> : null

export { folderName } from '../lib/derive'

/**
 * `→` and the title, whole, then the `you` chip and, where the row has no facts line 2 or tag
 * line, the due chip and the read-only chip.
 */
export function NextStep({ task, owner, due, ro = null }: { task: Task | null; owner: string | null; due: string | null; ro?: string | null }): JSX.Element {
  const dueChip = (
    <>
      {due && (
        <span className="due">
          <Chip quiet>{due}</Chip>
        </span>
      )}
      {ro && (
        <span className="ro">
          <Chip quiet>{ro}</Chip>
        </span>
      )}
    </>
  )
  if (!task)
    return (
      <div className="nx none">
        <span className="arw">·</span>
        <span className="t">No tasks queued</span>
        {dueChip}
      </div>
    )
  return (
    <div className="nx">
      <span className="arw">→</span>
      <span className="t">{displayTitle(task, owner)}</span>
      {ownerOnly(task, owner) && <Chip>you</Chip>}
      {dueChip}
    </div>
  )
}

/**
 * Line 1: status word, then age with its glyphs, or `live`. Line 2 (`l2`): a due date still ahead,
 * else why the age fell back, else the branch. For the eye: the row's name says it (rowName).
 */
export function Facts({ r, now, due, l2 = true }: { r: ProjectRecord; now: number; due: string | null; l2?: boolean }): JSX.Element {
  // activity not read yet: two neutral bars; the row is usable, and grouped from the log's date
  if (r.activity === null && !r.agent.live)
    return (
      <div className="mt" aria-hidden="true">
        <div className="l1">
          <span className="skel" style={{ width: 28 }} />
        </div>
        {l2 && (
          <div className="l2">
            <span className="skel" style={{ width: 64 }} />
          </div>
        )}
      </div>
    )
  const problem = activityProblem(r)
  const status = r.doc?.status === 'paused' ? 'paused' : r.doc?.status === 'blocked' ? 'waiting' : null
  const glyph = sourceGlyph(r)
  const branch = r.activity?.git?.branch ?? null
  return (
    <div className="mt" aria-hidden="true">
      <div className="l1">
        {status && <span className="st">{status}</span>}
        {r.agent.live ? (
          <LiveMark live />
        ) : (
          <>
            {ageLabel(days(r, now))}
            {glyph === 'branch' && <GitGlyph />}
            {glyph === 'page' && <FilesGlyph />}
            {behind(r) && <LagGlyph />}
          </>
        )}
      </div>
      {l2 && (
        <div className="l2" title={due ?? problem?.title ?? branch ?? undefined}>
          {due ? <span className="du">{due}</span> : problem ? problem.short : branch && branchLabel(branch)}
        </div>
      )}
    </div>
  )
}

function NowText({ r }: { r: ProjectRecord }): JSX.Element {
  if (r.state === 'needs-repair') return <div className="now none">RADAR cannot read this BLIP.md, so it shows nothing from it and will not write to it.</div>
  const now = r.doc?.now
  if (now) return <div className="now">{now}</div>
  const n = commitDays(r)
  return (
    <div className="now none">
      No Now line yet. {n > 0 ? `Commits on ${n} of the last 30 days.` : 'An agent writes one at its next sync.'}
    </div>
  )
}

/**
 * The selected row's expansion: tasks 2 and 3, the log-behind line, and the actions. It is drawn
 * for the eye and the mouse: the row's name says the same, and the keys on the buttons' caps do
 * what the buttons do, so nothing interactive sits inside the option (section 11).
 */
function Then({ r, owner, muted }: { r: ProjectRecord; owner: string | null; muted: boolean }): JSX.Element {
  const open = r.doc?.tasks.open ?? []
  const more = open.slice(1, 3)
  const edits = writable(r) && open.length > 0
  return (
    <div className="then" aria-hidden="true">
      {more.length > 0 && (
        <ul>
          {more.map((t, i) => (
            <li key={t.key}>
              <span className="ix">{i + 2}</span>
              <span>{displayTitle(t, owner)}</span>
              {ownerOnly(t, owner) && <Chip>you</Chip>}
            </li>
          ))}
        </ul>
      )}
      {behind(r) && (
        <div className="lag">
          <LagGlyph />
          <span>The log is behind the work.</span>
          <Keys caps="L" />
          <span>copies a catch-up prompt for an agent.</span>
        </div>
      )}
      <div className="acts">
        <Button tabIndex={-1} variant={muted ? 'ghost' : 'primary'} caps="Enter" onClick={() => openProject(r)}>
          Open
        </Button>
        <Button tabIndex={-1} caps="R" onClick={() => void resume(r)}>
          Resume
        </Button>
        <Button tabIndex={-1} caps="C" onClick={() => void copyPrompt(r)}>
          Copy re-entry prompt
        </Button>
        {edits && (
          <>
            <Button tabIndex={-1} caps="X" onClick={() => void markDone(r)}>
              Mark next step done
            </Button>
            <Button tabIndex={-1} caps="N" onClick={() => void notNow(r)}>
              Not now
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export interface ProjectRowProps {
  r: ProjectRecord
  variant: RowVariant
  selected: boolean
  /** An overlay is open and holds the one filled button (rule 5). */
  muted?: boolean
  owner: string | null
  now: number
  /** Today's local date, `YYYY-MM-DD`, for the due date. */
  today: string
  onSelect(id: string): void
}

const CHIP: Partial<Record<ProjectRecord['state'], string>> = { 'needs-migrate': 'v2 · read-only', 'needs-repair': 'read-only' }

export function ProjectRow({ r, variant, selected, muted = false, owner, now, today, onSelect }: ProjectRowProps): JSX.Element {
  const doc = r.doc
  const next = doc?.next ?? null
  const due = dueLabel(next?.due ?? doc?.due ?? null, today)
  const chip = CHIP[r.state]
  // a read-only row does not expand (section 8)
  const expands = selected && variant !== 'continued' && r.state === 'ok'
  const cls = ['row', variant === 'line' && 'q1', variant === 'continued' && 'c0', selected && 'sel'].filter(Boolean).join(' ')
  // a click or double click on one of the row's buttons is the button's alone
  const onButton = (e: MouseEvent): boolean => !!(e.target as HTMLElement).closest('button')
  const select = (e: MouseEvent): void => {
    if (!onButton(e)) onSelect(r.id)
  }
  const open = (e: MouseEvent): void => {
    if (!onButton(e)) openProject(r)
  }
  return (
    // The option is the mark's cell, named for the whole row (section 11); the rest is drawn for
    // the eye, so the selected row's buttons are never inside an option.
    <div id={`row-${r.id}`} className={cls} data-id={r.id} onClick={select} onDoubleClick={open}>
      <div id={`opt-${r.id}`} role="option" aria-selected={selected} aria-label={rowName(r, owner, now, variant === 'continued', expands)}>
        <FocusMark focus={doc?.focus ?? false} />
      </div>
      <div className="who" aria-hidden="true">
        <div className="nm" title={doc?.name}>
          {doc?.name ?? folderName(r.dir)}
        </div>
        {variant === 'full' && (
          <div className="ar">
            {r.state === 'needs-repair' ? 'folder name' : doc?.tags[0]}
            {chip && <Chip quiet>{chip}</Chip>}
          </div>
        )}
      </div>
      <div className="what" aria-hidden="true">
        {variant === 'continued' ? (
          <div className="up">Continued above</div>
        ) : (
          <>
            <NowText r={r} />
            {r.state === 'needs-repair' ? (
              <div className="nx none">
                <span className="arw">·</span>
                <span className="t">{problemLine(repairProblem(r))}</span>
                <span className="ro">
                  <Chip quiet>{chip}</Chip>
                </span>
              </div>
            ) : (
              <NextStep task={next} owner={owner} due={due} ro={chip} />
            )}
          </>
        )}
      </div>
      <Facts r={r} now={now} due={due} l2={variant !== 'continued'} />
      {expands && <Then r={r} owner={owner} muted={muted} />}
    </div>
  )
}
