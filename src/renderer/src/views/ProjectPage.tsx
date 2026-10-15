// The project page (renderer spec 6.5, 6.6, 10): the rail of every project, the centre (crumb,
// name and focus pill, Now, the next-step card, the queue) and the right column (session log,
// derived facts, yours to set). Under 1180 it is one column, the rail hidden and the right column
// after the queue. The keys act on this project: R C E X N F L, A adds a task, J K and Space work
// the queue, [ and ] move to the previous or next project, / filters the queue.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectRecord, Task } from '@shared/model'
import { Keys } from '../components/atoms'
import { ReadOnlyBanner } from '../components/Banner'
import { NextCard, NowLine, taskKey, toggleExpanded } from '../components/NextCard'
import { DerivedFacts, LogTimeline, YoursToSet } from '../components/ProjectFacts'
import { folderName, LiveMark } from '../components/ProjectRow'
import { Queue } from '../components/Queue'
import { register } from '../lib/actions'
import { ageLabel, behind, days, groups, listOrder, localDate, type Group } from '../lib/derive'
import { canPrompt, canResume, catchUp, copyPrompt, hideProject, markDone, notNow, openEditor, resume, toggleFocus, writable } from '../lib/projectActions'
import { useBoard } from '../store/board'
import { useShell } from '../store/shell'

const RAIL: Partial<Record<Group, string>> = { week: 'This week', recent: 'Last six weeks', earlier: 'Earlier', paused: 'Paused' }

/** Moving between projects from the page replaces it, so Esc still goes back to where the page was opened from. */
const show = (id: string): void => useShell.setState({ route: { view: 'project', id }, overlay: null })

export function ProjectRail({ current }: { current: string }): JSX.Element {
  const projects = useBoard((b) => b.projects)
  const now = useBoard((b) => b.now)
  const list = useMemo(() => groups({ projects, owner: null, now }), [projects, now])
  return (
    <nav className="side" aria-label="Projects">
      {list
        .filter((g) => RAIL[g.group])
        .map((g) => (
          <div key={g.group}>
            <h3>{RAIL[g.group]}</h3>
            {g.rows.map((r) => (
              <button
                key={r.id}
                type="button"
                className={[r.id === current && 'on', (g.group === 'earlier' || g.group === 'paused') && 'dim'].filter(Boolean).join(' ') || undefined}
                aria-current={r.id === current ? 'page' : undefined}
                onClick={() => show(r.id)}
              >
                <span>
                  {r.doc?.focus && <span className="dia" title="Pinned as focus" />}
                  {r.doc?.name ?? folderName(r.dir)}
                </span>
                {r.agent.live ? <LiveMark live /> : <span className="mono">{ageLabel(days(r, now))}</span>}
              </button>
            ))}
          </div>
        ))}
    </nav>
  )
}

export function ProjectPage({ id }: { id: string }): JSX.Element {
  const r = useBoard((b) => b.projects[id]) as ProjectRecord | undefined
  const projects = useBoard((b) => b.projects)
  const owner = useBoard((b) => b.owner)
  const now = useBoard((b) => b.now)
  const ready = useBoard((b) => b.status === 'ready')
  const busy = useShell((s) => !!s.writing[id])
  const [sel, setSel] = useState<string | null>(null)
  const [rows, setRows] = useState<Task[]>([])
  const [adding, setAdding] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const today = localDate(now)

  // a page opens at its top, whatever the list it was opened from was scrolled to
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  // the page's keys act on this project
  useEffect(() => {
    if (!r) return
    const can = writable(r)
    const open = r.doc?.tasks.open ?? []
    const order = listOrder({ projects, owner, now })
    const step = (by: number): void => {
      const i = order.findIndex((x) => x.id === r.id)
      const next = order[(i < 0 ? 0 : i + by + order.length) % order.length]
      if (next) show(next.id)
    }
    // R, C and L only where the page draws them: none on a file that cannot be parsed, no Resume on a v2 one
    return register({
      ...(canResume(r) ? { 'project.resume': () => void resume(r) } : {}),
      ...(canPrompt(r) ? { 'project.copyPrompt': () => void copyPrompt(r) } : {}),
      'project.editor': () => void openEditor(r),
      'project.hide': () => void hideProject(r),
      ...(canPrompt(r) && behind(r) ? { 'project.catchUp': () => void catchUp(r) } : {}),
      ...(can ? { 'project.focus': () => void toggleFocus(r), 'task.add': () => setAdding(true) } : {}),
      ...(can && open[0] ? { 'task.done': () => void markDone(r) } : {}),
      ...(can && open.length > 1 ? { 'task.notNow': () => void notNow(r) } : {}),
      ...(rows.length
        ? {
            'list.move': (key?: string) => {
              const i = rows.findIndex((t) => t.key === sel)
              const up = key === 'K' || key === 'ArrowUp'
              const j = up ? i - 1 : Math.min(rows.length - 1, i + 1)
              setSel(rows[j]?.key ?? null)
            },
            // Space opens the selected row's detail; with none selected, the first row's
            'task.expand': () => {
              const t = rows.find((x) => x.key === sel) ?? rows[0]
              setSel(t.key)
              toggleExpanded(taskKey(r, t, 'detail'))
            }
          }
        : {}),
      ...(order.length > 1 ? { 'project.prevNext': (key?: string) => step(key === '[' ? -1 : 1) } : {}),
      // Esc (9.1): an overlay closes first, then the selected queue row is let go, then the page goes back
      ...(sel
        ? {
            'nav.back': () => {
              const s = useShell.getState()
              if (s.overlay) s.goBack()
              else setSel(null)
            }
          }
        : {}),
      'palette.projects': () => filterRef.current?.focus()
    })
  }, [r, projects, owner, now, rows, sel])

  // the selected row takes focus, so a screen reader reads it and Alt and the arrows move it
  useEffect(() => {
    const row = sel ? document.getElementById(`task-${sel}`) : null
    row?.scrollIntoView({ block: 'nearest' })
    row?.focus({ preventScroll: true })
  }, [sel])

  if (!r)
    return (
      <div className="detail">
        <div className="body">{ready && <p className="gone">This project is no longer on the board.</p>}</div>
      </div>
    )
  const doc = r.doc
  const name = doc?.name ?? folderName(r.dir)
  const crumb = r.dir.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ')
  const can = writable(r)
  // a file that cannot be parsed shows nothing from it (section 8): no card, no queue, no editors
  const broken = r.state === 'needs-repair'
  return (
    <div className="detail">
      <ProjectRail current={r.id} />
      <div className="body">
        <div className="crumb">
          <button type="button" onClick={() => useShell.getState().go({ view: 'pickup' })}>
            Pick up
          </button>
          <span>/</span>
          <span className="mono" title={r.dir}>
            {crumb}
          </span>
        </div>
        <div className="title">
          <h1>{name}</h1>
          {doc?.focus ? (
            can ? (
              <button type="button" className="pin" onClick={() => void toggleFocus(r)} aria-label="Focus: pinned. Unpin" aria-busy={busy || undefined}>
                <span className="dia" /> Focus
              </button>
            ) : (
              <span className="pin">
                <span className="dia" /> Focus
              </span>
            )
          ) : (
            can && (
              <button type="button" className="pin" onClick={() => void toggleFocus(r)} aria-busy={busy || undefined}>
                Pin as focus <Keys caps="F" />
              </button>
            )
          )}
        </div>
        <ReadOnlyBanner r={r} />
        {!broken && (
          <>
            <NowLine r={r} />
            <NextCard r={r} owner={owner} onAdd={() => setAdding(true)} />
            <Queue
              r={r}
              owner={owner}
              today={today}
              selected={sel}
              onSelect={setSel}
              onRows={setRows}
              adding={adding}
              setAdding={setAdding}
              filterRef={filterRef}
            />
          </>
        )}
      </div>
      <aside className="right">
        {!broken && <LogTimeline r={r} />}
        <DerivedFacts r={r} now={now} />
        {!broken && <YoursToSet r={r} today={today} />}
      </aside>
    </div>
  )
}
