// The Scope view (renderer spec 6.7, 7): the stage, laid out at its measured size with the
// headline, legend and note as rectangles the labels keep off, and the right-hand column: the
// readout above the list by ring. One selection is shared with Pick up; hovering a blip or a list
// row marks both. The arrows move between blips, by bearing and by ring.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProjectRecord } from '@shared/model'
import { ScopeList, ScopeReadout, ScopeSvg, useScopeBoard } from '../components/Scope'
import { register } from '../lib/actions'
import { behind, pickOrder, touchedThisWeek, visible } from '../lib/derive'
import { canPrompt, canResume, catchUp, copyPrompt, hideProject, openEditor, openProject, resume, toggleFocus, writable } from '../lib/projectActions'
import { layout, scopeProjects, stageBox, step, type Rect } from '../lib/scope'
import { useBoard } from '../store/board'
import { useShell } from '../store/shell'

/** The project the keys act on: the selected blip, else the Continue project, as on Pick up (9.1). */
export function useScopeTarget(): ProjectRecord | null {
  const selectedId = useShell((s) => s.selectedId)
  const projects = useBoard((b) => b.projects)
  const owner = useBoard((b) => b.owner)
  const now = useBoard((b) => b.now)
  return useMemo(() => {
    const b = { projects, owner, now }
    return visible(b).find((r) => r.id === selectedId) ?? pickOrder(b)[0] ?? null
  }, [projects, owner, now, selectedId])
}

const FocusKey = (): JSX.Element => (
  <svg width="18" height="18" aria-hidden="true">
    <path d="M3 6V3H6M12 3H15V6M15 12V15H12M6 15H3V12" fill="none" stroke="var(--acc)" strokeWidth="1.6" />
    <circle cx="9" cy="9" r="3" fill="var(--fg)" />
  </svg>
)
const LiveKey = (): JSX.Element => (
  <svg width="18" height="18" aria-hidden="true">
    <circle cx="9" cy="9" r="6.5" fill="none" stroke="var(--acc)" strokeWidth="1.4" />
    <circle cx="9" cy="9" r="3" fill="var(--fg)" />
  </svg>
)
const HollowKey = (): JSX.Element => (
  <svg width="18" height="18" aria-hidden="true">
    <circle cx="9" cy="9" r="3.2" fill="none" stroke="var(--fg-3)" strokeWidth="1.3" />
  </svg>
)

export function Scope(): JSX.Element {
  const { board, slots } = useScopeBoard()
  const selectedId = useShell((s) => s.selectedId)
  const target = useScopeTarget()
  const [hover, setHover] = useState<string | null>(null)
  // the blip under the pointer, for the readout; a list row hovered marks its blip but leaves the
  // readout, which sits above the list and would move the rows under the pointer as it changed
  const [hoverBlip, setHoverBlip] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ W: number; H: number; win: number } | null>(null)

  // the stage is laid out at its real size, measured; nothing is scaled by CSS (rule 9)
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = (): void =>
      setSize((s) => {
        const next = { W: el.clientWidth, H: el.clientHeight, win: window.innerWidth }
        return s && s.W === next.W && s.H === next.H && s.win === next.win ? s : next
      })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // the note as drawn, a rectangle the labels keep off: it grows when names are tucked away. It
  // only ever grows at one stage size, so a label tucked away cannot make room for itself and loop.
  const noteRef = useRef<HTMLParagraphElement>(null)
  const [note, setNote] = useState<{ at: string; r: Rect } | null>(null)
  useLayoutEffect(() => {
    const el = noteRef.current
    if (!el || !size || el.offsetHeight === 0) return
    const at = `${size.W} ${size.H} ${size.win}`
    const m = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
    setNote((n) => {
      const r = n && n.at === at ? { x: Math.min(n.r.x, m.x), y: Math.min(n.r.y, m.y), w: Math.max(n.r.x + n.r.w, m.x + m.w) - Math.min(n.r.x, m.x), h: Math.max(n.r.y + n.r.h, m.y + m.h) - Math.min(n.r.y, m.y) } : m
      return n && n.at === at && n.r.x === r.x && n.r.y === r.y && n.r.w === r.w && n.r.h === r.h ? n : { at, r }
    })
  })

  const projects = useMemo(() => scopeProjects(board), [board])
  const selected = projects.some((p) => p.id === selectedId) ? selectedId : null
  const noteAt = size && note?.at === `${size.W} ${size.H} ${size.win}` ? note.r : null
  const box = useMemo(() => (size ? stageBox(size.W, size.H, size.win, noteAt) : null), [size, noteAt])
  const L = useMemo(() => (box ? layout(projects, { ...box, selected, slots }) : null), [projects, box, selected, slots])
  const byId = (id: string | null): ProjectRecord | null => (id ? (board.projects[id] ?? null) : null)
  const shown = byId(hoverBlip) ?? target

  const select = (id: string | null): void => useShell.setState({ selectedId: id })
  const open = (id: string): void => {
    const r = byId(id)
    if (r) openProject(r)
  }

  // the arrows: left and right by bearing, up and down by ring; focus follows when it is on a blip
  useEffect(
    () =>
      register({
        'scope.move': (key) => {
          if (!L || !key) return
          const id = step(L.items, selected, key)
          select(id)
          const onBlip = (document.activeElement as Element | null)?.closest?.('[data-blip]')
          if (onBlip && id) document.querySelector<SVGGElement>(`.stage [data-blip="${id}"]`)?.focus()
        }
      }),
    [L, selected]
  )

  // the project keys act on the selected blip, else the Continue project
  useEffect(() => {
    if (!target) return
    return register({
      'project.open': () => openProject(target),
      ...(canResume(target) ? { 'project.resume': () => void resume(target) } : {}),
      ...(canPrompt(target) ? { 'project.copyPrompt': () => void copyPrompt(target) } : {}),
      'project.editor': () => void openEditor(target),
      'project.hide': () => void hideProject(target),
      ...(writable(target) ? { 'project.focus': () => void toggleFocus(target) } : {}),
      ...(canPrompt(target) && behind(target) ? { 'project.catchUp': () => void catchUp(target) } : {})
    })
  }, [target])

  const tucked = L?.dropped ?? []
  return (
    <div className="scopepage">
      <div className="stage" ref={stageRef}>
        {L && box && (
          <div className="crt">
            <ScopeSvg
              L={L}
              box={box}
              interactive
              hover={hover}
              onHover={(id) => {
                setHover(id)
                setHoverBlip(id)
              }}
              onSelect={select}
              onOpen={open}
            />
          </div>
        )}
        <div className="sc-head">
          <h1>Scope</h1>
          <p>
            {touchedThisWeek(board)} touched this week.<span className="t-l"> Every project, placed by how long ago work last happened.</span>
          </p>
        </div>
        <div className="legend">
          <FocusKey />
          <span>Focus, pinned by you</span>
          <LiveKey />
          <span>Agent session live</span>
          <HollowKey />
          <span>Paused or archived</span>
        </div>
        <p className="sc-note" ref={noteRef}>
          {tucked.length > 0 && (
            <span className="tuck">
              <b>Tucked away:</b> {tucked.slice(0, 3).join(', ')}
              {tucked.length > 3 && ' and others'}. Still in the list.
            </span>
          )}
          <span className="dist">
            <b>Distance</b> is time since last work.
            <br />
            <b>Bearing</b> never changes.
          </span>
        </p>
      </div>
      <aside className="scol">
        <ScopeReadout r={shown} owner={board.owner} now={board.now} />
        <ScopeList board={board} selected={selected} hover={hover} onHover={setHover} onSelect={select} onOpen={open} />
      </aside>
    </div>
  )
}
