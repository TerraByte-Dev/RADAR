// Pick one for me (renderer spec 6.4): a 468px dialog anchored 10px under the Pick button, right
// edges aligned, over a scrim. It deals `pickOrder` from [1], never [0], which Continue shows.
// Resume (Enter, also R) re-enters and closes, Another (A) deals the next, Not now (Esc) closes.
// Nothing is written to any file by any of the three. The dialog holds focus while it is open and
// gives it back to whatever opened it.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ProjectRecord } from '@shared/model'
import { ageLabel, days, displayTitle, pickReason, startCost } from '../lib/derive'
import { anotherPick, closePick, resume } from '../lib/projectActions'
import { Button, Chip, Kbd } from './atoms'
import { RuleLine, StepTitle } from './ContinueStrip'
import { LiveMark } from './ProjectRow'

const WIDTH = 468
/** The popover's least distance from the window's edges. */
const EDGE = 12

interface At {
  top: number
  left: number
}

/**
 * Under the Pick button, right edges aligned; in one-line density, where the strip shows no Pick
 * button, under the strip. A popover taller than the room below moves up until it ends inside the
 * window, and one taller than the window is capped by its max-height and scrolls (.pick).
 */
function anchor(height: number): At {
  const pick = document.querySelector<HTMLElement>('.cont .pickbtn')
  const el = pick?.offsetParent ? pick : document.querySelector<HTMLElement>('.cont')
  const b = el?.getBoundingClientRect()
  if (!b) return { top: 92, left: Math.max(EDGE, window.innerWidth - WIDTH - 24) }
  return { top: Math.max(EDGE, Math.min(b.bottom + 10, window.innerHeight - EDGE - height)), left: Math.max(EDGE, b.right - WIDTH) }
}

export interface PickPopoverProps {
  order: ProjectRecord[]
  index: number
  owner: string | null
  now: number
}

export function PickPopover({ order, index, owner, now }: PickPopoverProps): JSX.Element | null {
  const r = order[index]
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<At>(() => anchor(0))
  const place = (): void => {
    const next = anchor(ref.current?.offsetHeight ?? 0)
    setAt((was) => (was.top === next.top && was.left === next.left ? was : next))
  }

  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    ref.current?.focus()
    // the strip is brought on screen first, so the popover opens under its Pick button even from a
    // scrolled list or from another view (P mounts the strip with the dialog)
    document.querySelector('.cont')?.scrollIntoView({ block: 'nearest' })
    place()
    // the page behind the scrim does not scroll; only the popover itself, when it is capped
    const wheel = (e: WheelEvent): void => {
      const el = ref.current
      if (!el?.contains(e.target as Node) || el.scrollHeight <= el.clientHeight) e.preventDefault()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.addEventListener('wheel', wheel, { passive: false })
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('wheel', wheel)
      opener?.focus?.()
    }
  }, [])

  // each card has its own height
  useLayoutEffect(place, [r])

  // the order changed under it (an agent finished a step) and has nothing at this place now
  useLayoutEffect(() => {
    if (!r?.doc?.next) closePick()
  }, [r])
  if (!r?.doc?.next) return null

  const doc = r.doc
  const next = doc.next as NonNullable<typeof doc.next>
  const cost = startCost(r, next, owner)
  const go = (): void => {
    closePick()
    void resume(r)
  }

  // The dialog is modal: its keys are its own and nothing reaches the view behind it. Enter on a
  // focused button is that button's; anywhere else in the dialog it is the primary, Resume.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const onButton = (e.target as HTMLElement).tagName === 'BUTTON'
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey
    if (e.key === 'Tab') {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])]
      const i = items.indexOf(document.activeElement as HTMLElement)
      const j = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length
      items[j]?.focus()
      e.preventDefault()
    } else if (e.key === 'Escape') closePick()
    else if (plain && (e.key === 'r' || e.key === 'R' || (e.key === 'Enter' && !onButton))) go()
    else if (plain && (e.key === 'a' || e.key === 'A')) anotherPick(order)
    else {
      // anything else stays in the dialog; Enter and Space on a focused button keep their click
      e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <div className="scrim" onClick={closePick} />
      <div
        ref={ref}
        className="pop pick"
        role="dialog"
        aria-modal="true"
        aria-label="Pick one for me"
        tabIndex={-1}
        style={{ top: at.top, left: at.left }}
        onKeyDown={onKeyDown}
      >
        <div className="ph">
          <span className="lab">Pick one for me</span>
          <Kbd>Esc</Kbd>
        </div>
        <div className="nmline">
          {doc.focus && <span className="dia" title="Pinned as focus" />}
          <h2>{doc.name}</h2>
          {r.agent.live ? <LiveMark live /> : <Chip quiet>{ageLabel(days(r, now))}</Chip>}
        </div>
        {doc.now && <p className="now">{doc.now}</p>}
        <div className="step">
          <div className="lab">
            <b>Next step</b>
            {cost && ` · ${cost}`}
          </div>
          <StepTitle r={r} title={displayTitle(next, owner)} />
        </div>
        <p className="why">
          <b>Why this one.</b> {pickReason(order, index, owner)}
        </p>
        <div className="btns">
          <Button variant="primary" caps="Enter" onClick={go}>
            Resume
          </Button>
          <Button caps="A" onClick={() => anotherPick(order)}>
            Another
          </Button>
          <Button caps="Esc" onClick={closePick}>
            Not now
          </Button>
        </div>
        <RuleLine long />
      </div>
    </>
  )
}
