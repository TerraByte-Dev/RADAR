// The command palette (renderer spec 9.2), a jump box: 560px, 92px from the top, over a
// scrim. With an empty query it shows two groups and nothing else: the first five of pickOrder, and
// the highlighted project's six actions. Typing fuzzy-matches project names first, then every
// keymap label that can act here. `/` opens it on projects alone. Tab moves between a project and
// its actions; Enter on a project opens it. The dialog holds focus and gives it back on close.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { ProjectRecord } from '@shared/model'
import { has, run } from '../lib/actions'
import { fuzzy } from '../lib/fuzzy'
import { ageLabel, behind, days, pickOrder, visible } from '../lib/derive'
import { binding, KEYMAP, nameOf, type KeyId } from '../lib/keymap'
import {
  canPrompt,
  canResume,
  catchUp,
  copyPrompt,
  hideProject,
  markDone,
  notNow,
  openEditor,
  openProject,
  resume,
  toggleFocus,
  writable
} from '../lib/projectActions'
import { useBoard } from '../store/board'
import { useShell } from '../store/shell'
import { Keys } from './atoms'
import { LiveMark } from './ProjectRow'
import { useLogSelection } from '../views/Log'

interface Act {
  id: KeyId
  /** Whether it can act on `r`; an action that cannot is not drawn (rule 12). */
  can(r: ProjectRecord): boolean
  go(r: ProjectRecord): unknown
}

const always = (): boolean => true
/** What the project keys do, in the order the palette lists them; the first six are the empty query's. */
const ACTS: Act[] = [
  { id: 'project.open', can: always, go: openProject },
  { id: 'project.resume', can: canResume, go: resume },
  { id: 'project.copyPrompt', can: canPrompt, go: copyPrompt },
  { id: 'task.done', can: (r) => writable(r) && !!r.doc?.next, go: markDone },
  { id: 'task.notNow', can: (r) => writable(r) && (r.doc?.tasks.open.length ?? 0) > 1, go: notNow },
  { id: 'project.focus', can: writable, go: toggleFocus },
  { id: 'project.editor', can: always, go: openEditor },
  { id: 'project.catchUp', can: (r) => canPrompt(r) && behind(r), go: catchUp },
  { id: 'project.hide', can: always, go: hideProject }
]
const FIRST = 6

/** Keymap rows that are not commands to pick from a list: the palette itself, Esc, and the moves. */
const NOT_COMMANDS: KeyId[] = ['palette.open', 'palette.projects', 'nav.back', 'list.move', 'scope.move', 'project.prevNext', 'task.expand']
const COMMANDS = KEYMAP.filter((b) => b.scope !== 'A project' && !NOT_COMMANDS.includes(b.id))

const JUMP = 5
const close = (): void => useShell.setState({ overlay: null })

export interface PaletteProps {
  /** `/`: projects only, no actions and no commands. */
  projectsOnly?: boolean
}

/** The palette over the board as it is now. */
export function Palette({ projectsOnly = false }: PaletteProps): JSX.Element {
  const projects = useBoard((b) => b.projects)
  const owner = useBoard((b) => b.owner)
  const now = useBoard((b) => b.now)
  const route = useShell((s) => s.route)
  const selectedId = useShell((s) => s.selectedId)
  const logId = useLogSelection((s) => s.id)
  const board = useMemo(() => ({ projects, owner, now }), [projects, owner, now])
  const order = useMemo(() => pickOrder(board), [board])
  const all = useMemo(() => visible(board), [board])
  // the project it was opened over: the open page, the Log's entry that Enter would open, else the selection, else Continue (9.1)
  const own = route.view === 'project' ? route.id : route.view === 'log' ? logId : null
  const opener = (own ? projects[own] : undefined) ?? all.find((r) => r.id === selectedId) ?? order[0] ?? null
  return <PaletteBox order={order} all={all} opener={opener} now={now} projectsOnly={projectsOnly} />
}

export interface PaletteBoxProps extends PaletteProps {
  /** pickOrder: the empty query's first five. */
  order: ProjectRecord[]
  /** Every visible record, for a typed query. */
  all: ProjectRecord[]
  /** The project the palette was opened over, whose actions a typed query finds when no project matches. */
  opener: ProjectRecord | null
  now: number
}

export function PaletteBox({ order, all, opener, now, projectsOnly = false }: PaletteBoxProps): JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim()

  const jump: ProjectRecord[] = q
    ? all
        .map((r) => ({ r, s: fuzzy(r.doc?.name ?? '', q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r)
    : order.slice(0, JUMP)

  const [value, setValue] = useState(() => (jump[0] ? `p:${jump[0].id}` : ''))
  const [pid, setPid] = useState<string | null>(jump[0]?.id ?? opener?.id ?? null)
  // the actions belong to the project last highlighted, while it is still listed; else the first listed, else the opener
  const target = (jump.find((r) => r.id === pid) ?? jump[0] ?? (q ? opener : null)) || null
  const acts = projectsOnly || !target ? [] : ACTS.filter((a) => a.can(target)).filter((a) => (q ? fuzzy(nameOf(binding(a.id)), q) > 0 : true)).slice(0, q ? undefined : FIRST)
  const commands = projectsOnly || !q ? [] : COMMANDS.filter((b) => has(b.id) && fuzzy(nameOf(b), q) > 0)
  const values = [...jump.map((r) => `p:${r.id}`), ...acts.map((a) => `a:${a.id}`), ...commands.map((b) => `c:${b.id}`)]
  // the highlighted row: the one last moved to while it is listed, else the first listed, whatever its group
  const cur = values.includes(value) ? value : (values[0] ?? '')

  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    ref.current?.querySelector('input')?.focus()
    return () => opener?.focus?.()
  }, [])

  const highlight = (v: string): void => {
    setValue(v)
    if (v.startsWith('p:')) setPid(v.slice(2))
  }
  // a new query highlights its first row, and the actions go to its first project
  const onQuery = (text: string): void => {
    setQuery(text)
    setValue('')
    setPid(null)
  }

  const act = (a: Act): void => {
    if (!target) return
    close()
    void a.go(target)
  }
  const command = (id: KeyId): void => {
    if (id === 'keys.show') return useShell.setState({ overlay: 'keys' })
    close()
    run(id)
  }
  /** Runs the item `v`: a project opens, an action acts on the target, a command runs. */
  const choose = (v: string): void => {
    const id = v.slice(2)
    if (v.startsWith('p:')) {
      const r = jump.find((x) => x.id === id)
      if (r) {
        close()
        openProject(r)
      }
    } else if (v.startsWith('a:')) {
      const a = acts.find((x) => x.id === id)
      if (a) act(a)
    } else if (v.startsWith('c:')) command(id as KeyId)
  }

  // the highlighted row stays in view as the arrows move it
  useLayoutEffect(() => {
    document.getElementById(optId(cur))?.scrollIntoView({ block: 'nearest' })
  }, [cur])

  // The dialog is modal: its keys are its own. The arrows move the highlight, Enter runs it, Tab
  // goes into the highlighted project's actions and back, and `?` on an empty query shows every key.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = values.indexOf(cur)
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const j = e.key === 'ArrowDown' ? Math.min(values.length - 1, i + 1) : Math.max(0, i - 1)
      if (values[j]) highlight(values[j])
    } else if (e.key === 'Enter') {
      if (cur) choose(cur)
    } else if (e.key === 'Tab') {
      const back = target ? `p:${target.id}` : ''
      const into = cur.startsWith('p:') && acts.length
      highlight(into ? `a:${acts[0]?.id}` : values.includes(back) ? back : (values[0] ?? ''))
    } else if (e.key === '?' && !query) useShell.setState({ overlay: 'keys' })
    else {
      // typing stays in the field, and nothing reaches the view behind
      e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const item = (v: string, body: JSX.Element): JSX.Element => (
    <li key={v} id={optId(v)} role="option" aria-selected={v === cur} className={v === cur ? 'on' : undefined} onMouseMove={() => v !== cur && highlight(v)} onClick={() => choose(v)}>
      {body}
    </li>
  )
  const group = (key: string, heading: string, rows: JSX.Element[], named = false): JSX.Element => (
    <div key={key} role="group" aria-labelledby={`pal-${key}`}>
      {/* the group's name, not a heading: a listbox holds groups and options only */}
      <div id={`pal-${key}`} className={named ? 'gl named' : 'gl'}>
        {heading}
      </div>
      <ul role="presentation">{rows}</ul>
    </div>
  )

  return (
    <>
      <div className="scrim" onClick={close} />
      <div ref={ref} className="pop pal" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown} onMouseDown={keepFocus}>
        <div className="in">
          <Glass />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={projectsOnly ? 'Jump to a project' : 'Jump to a project, or run a command'}
            aria-label="Jump to a project, or run a command"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-results"
            aria-activedescendant={cur ? optId(cur) : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <Keys caps="Esc" />
        </div>
        <div className="res" id="pal-results" role="listbox" aria-label="Results">
          {jump.length > 0 &&
            group(
              'jump',
              'Jump to a project',
              jump.map((r) =>
                item(
                  `p:${r.id}`,
                  <>
                    <span className="g">{r.doc?.focus ? <span className="dia" /> : <Dot />}</span>
                    <b>{r.doc?.name}</b>
                    <span className="r">{r.agent.live ? <LiveMark live /> : ageLabel(days(r, now))}</span>
                  </>
                )
              )
            )}
          {target &&
            acts.length > 0 &&
            group(
              'acts',
              target.doc?.name ?? '',
              acts.map((a) => item(`a:${a.id}`, <Row name={nameOf(binding(a.id))} caps={binding(a.id).caps} />)),
              true
            )}
          {commands.length > 0 && group('cmds', 'Commands', commands.map((b) => item(`c:${b.id}`, <Row name={nameOf(b)} caps={b.caps} />)))}
          {values.length === 0 && <p className="none">Nothing matches. Projects are found by name.</p>}
        </div>
        <div className="pfoot">
          <span>
            <Keys caps="↑ ↓" />
            <b>move</b>
          </span>
          <span>
            <Keys caps="Enter" />
            <b>open</b>
          </span>
          {!projectsOnly && (
            <span>
              <Keys caps="Tab" />
              <b>into its actions</b>
            </span>
          )}
          <span className="end">
            <Keys caps="?" />
            <b>all keys</b>
          </span>
        </div>
      </div>
    </>
  )
}

/** A click inside the dialog leaves focus in its field, so its keys stay its own (spec 11's focus trap). */
export const keepFocus = (e: MouseEvent): void => {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
}

const optId = (v: string): string => `pal-${v.replace(/[^\w-]/g, '_')}`

const Row = ({ name, caps }: { name: string; caps: string }): JSX.Element => (
  <>
    <span className="g" />
    <span>{name}</span>
    <span className="r">
      <Keys caps={caps} />
    </span>
  </>
)

export const Glass = (): JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <circle cx="6.5" cy="6.5" r="4.5" />
    <path d="M10 10l3.5 3.5" />
  </svg>
)

const Dot = (): JSX.Element => (
  <svg width="6" height="6" aria-hidden="true">
    <circle cx="3" cy="3" r="2.5" fill="currentColor" />
  </svg>
)
