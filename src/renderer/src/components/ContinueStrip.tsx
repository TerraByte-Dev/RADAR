// The Continue strip (renderer spec 6.1) and the rule line (6.4). The strip states a fact, the
// project last worked on (`pickOrder[0]`), and offers one filled button, which follows its state:
// Resume when nothing is in the way, Open when an agent is in there now, and Pick one for me when
// it is waiting on someone. A selected row or an open overlay takes the fill (rule 5) and the keys
// R, C and Enter, so buttons 1 and 2 lose their keycaps; Pick one for me keeps P.
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import type { ProjectRecord } from '@shared/model'
import { ageLabel, days, displayTitle, startCost } from '../lib/derive'
import { copyPrompt, openPick, openProject, resume } from '../lib/projectActions'
import { Button } from './atoms'
import { LiveMark } from './ProjectRow'

/** TITLE_MAX (radar-v3-spec 4.3): only a title past it, which lint flags `title-long`, is clamped, and always with Show all. */
export const TITLE_MAX = 80

/** A detail line verbatim; only backtick spans are styled as code. */
export function Verbatim({ line }: { line: string }): JSX.Element {
  const parts = line.split(/`([^`]+)`/)
  return <>{parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))}</>
}

/** A next step's title, whole; a legacy title past TITLE_MAX is clamped at three lines with a Show all that opens the project page. */
export function StepTitle({ r, title }: { r: ProjectRecord; title: string }): JSX.Element {
  if (title.length <= TITLE_MAX) return <h3>{title}</h3>
  return (
    <>
      <h3 className="clamp">{title}</h3>
      <p className="long">
        Written before titles had a length limit.{' '}
        <button type="button" onClick={() => openProject(r)}>
          Show all
        </button>
      </p>
    </>
  )
}

export const RuleLine = ({ long = false }: { long?: boolean }): JSX.Element =>
  long ? (
    <p className="rule">
      <b>One order:</b> the project last worked on, then your focus pins, then the rest of this week. Continue shows the first. Pick one for me deals
      the next, steps an agent can start before steps that need you.
    </p>
  ) : (
    <p className="rule">
      <b>Order:</b> last worked on, then your pins, then this week.
    </p>
  )

type Act = 'open' | 'resume' | 'copy' | 'pick'

export interface ContinueStripProps {
  order: ProjectRecord[]
  owner: string | null
  now: number
  /** Another project's row is selected or an overlay is open: the strip's filled button goes ghost, and R, C and Enter belong elsewhere. */
  muted: boolean
}

/**
 * The strip never grows (158px) and the title is never cut (rule 6), so the detail line gives way:
 * it shows when its two lines fit under the title, and not at all otherwise. It is never cut to
 * one line with an ellipsis, as the path in it is the part the reader acts on (6.1).
 */
function useDetailFits(...content: unknown[]): [RefObject<HTMLDivElement>, RefObject<HTMLParagraphElement>] {
  const box = useRef<HTMLDivElement>(null)
  const dl = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const c = box.current
    if (!c) return
    // the detail must end inside the strip's content box; the strip clips at its border
    const fit = (): void => {
      const d = dl.current
      const strip = c.parentElement
      if (!d || !strip) return
      const over = (): boolean =>
        d.getBoundingClientRect().bottom > strip.getBoundingClientRect().bottom - parseFloat(getComputedStyle(strip).paddingBottom) + 0.5
      d.style.display = ''
      if (over()) d.style.display = 'none'
    }
    fit()
    // checked again when the column's width or the title's height changes (a resize, a font load)
    const ro = new ResizeObserver(fit)
    ro.observe(c)
    const title = c.querySelector('h3')
    if (title) ro.observe(title)
    return () => ro.disconnect()
  }, content)
  return [box, dl]
}

export function ContinueStrip({ order, owner, now, muted }: ContinueStripProps): JSX.Element {
  const r = order[0]
  const next0 = r?.doc?.next
  // checked again whenever what the strip shows changes
  const [box, dl] = useDetailFits(r?.id, next0 && displayTitle(next0, owner), next0?.detail[0])
  if (!r?.doc?.next)
    return (
      <section className="cont empty" aria-label="Continue">
        Nothing queued anywhere. Open a project and add a task, or ask an agent to.
      </section>
    )
  const doc = r.doc
  const next = doc.next as NonNullable<typeof doc.next>
  const live = r.agent.live
  const waiting = doc.status === 'blocked'
  const d = days(r, now)
  const cost = startCost(r, next, owner)
  const fill: Act = live ? 'open' : waiting ? 'pick' : 'resume'
  const button = (id: Act, caps: string, label: string, onClick: () => void, keep = false): ReactNode => (
    <Button
      variant={fill === id && !muted ? 'primary' : 'ghost'}
      caps={muted && !keep ? undefined : caps}
      className={[fill === id && 'lead', id === 'pick' && 'pickbtn'].filter(Boolean).join(' ') || undefined}
      onClick={onClick}
    >
      {label}
    </Button>
  )
  return (
    <section className="cont" aria-label="Continue">
      <div className="c1">
        <div className="lab">Continue{d !== null && ` · last work ${d < 1 ? 'today' : `${ageLabel(d)} ago`}`}</div>
        <div className="nmline">
          {doc.focus && <span className="dia" title="Pinned as focus" />}
          <h2>{doc.name}</h2>
          <LiveMark live={live} words="session live" />
          {waiting && <span className="chip q">waiting</span>}
        </div>
        {doc.now && <p className="now">{doc.now}</p>}
      </div>
      <div className="c2" ref={box}>
        <div className="lab">
          <b>Next step</b>
          {cost && ` · ${cost}`}
        </div>
        <span className="arw one">→</span>
        <StepTitle r={r} title={displayTitle(next, owner)} />
        {next.detail[0] && (
          <p className="dl" ref={dl}>
            <Verbatim line={next.detail[0]} />
          </p>
        )}
      </div>
      <div className="c3">
        {live || waiting ? button('open', 'Enter', 'Open', () => openProject(r)) : button('resume', 'R', 'Resume', () => void resume(r))}
        {button('copy', 'C', 'Copy re-entry prompt', () => void copyPrompt(r))}
        {button('pick', 'P', 'Pick one for me', () => openPick(order), true)}
      </div>
    </section>
  )
}
