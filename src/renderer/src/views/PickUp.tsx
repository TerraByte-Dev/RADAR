// Pick up (renderer spec 6.1 to 6.4, 10): the header, the since line, the Continue strip and its
// rule, the list grouped by section 5 with one selection that J and K move, the digest in the rail
// and Pick one for me. The home scope sits above the digest in the rail.
import { useEffect, useMemo } from 'react'
import type { ProjectRecord } from '@shared/model'
import { Button, Segmented } from '../components/atoms'
import { Banner } from '../components/Banner'
import { ContinueStrip, RuleLine } from '../components/ContinueStrip'
import { Digest, SinceLine } from '../components/Digest'
import { PickPopover } from '../components/PickPopover'
import { HomeScope } from '../components/Scope'
import { folderName, ProjectRow } from '../components/ProjectRow'
import { register } from '../lib/actions'
import { focusHeading } from '../lib/focus'
import { behind, digest, groups, lastWorkedOn, listOrder, localDate, pickOrder, type BoardData, type Group } from '../lib/derive'
import type { Density } from '../lib/prefs'
import { canPrompt, canResume, catchUp, copyPrompt, hideProject, markDone, notNow, openProject, resume, writable } from '../lib/projectActions'
import { useBoard } from '../store/board'
import { useShell } from '../store/shell'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** `Tuesday 13 October`, in local time. */
export const longDay = (d: Date): string => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`

const HEADINGS: Record<Exclude<Group, 'archived'>, [string, string]> = {
  week: ['This week', 'worked on in the last seven days'],
  recent: ['Last six weeks', ''],
  earlier: ['Earlier', 'nothing is wrong; just not now'],
  paused: ['Paused', 'parked on purpose; activity does not move it']
}

/**
 * The rows J and K move through. In one-line density the strip is the Continue project's row, so
 * the list does not repeat it and the first selectable row is the one after the strip (6.2).
 */
export function pickupRows(b: BoardData, density: Density): ProjectRecord[] {
  const rows = listOrder(b)
  if (density !== 'one-line') return rows
  const first = pickOrder(b)[0]
  return rows.filter((r) => r !== first)
}

/** The project the keys act on: the selected row, else the Continue project (9.1). */
export function usePickupTarget(): ProjectRecord | null {
  const selectedId = useShell((s) => s.selectedId)
  const density = useShell((s) => s.density)
  const projects = useBoard((b) => b.projects)
  const owner = useBoard((b) => b.owner)
  const now = useBoard((b) => b.now)
  return useMemo(() => {
    const b = { projects, owner, now }
    return pickupRows(b, density).find((r) => r.id === selectedId) ?? pickOrder(b)[0] ?? null
  }, [projects, owner, now, selectedId, density])
}

export function PickUp(): JSX.Element {
  const density = useShell((s) => s.density)
  const setDensity = useShell((s) => s.setDensity)
  const selectedId = useShell((s) => s.selectedId)
  const overlay = useShell((s) => s.overlay)
  const pickIndex = useShell((s) => s.pickIndex)
  const lastOpenedAt = useShell((s) => s.lastOpenedAt)
  const projects = useBoard((b) => b.projects)
  const owner = useBoard((b) => b.owner)
  const now = useBoard((b) => b.now)
  const ready = useBoard((b) => b.status === 'ready')
  // registry.json could not be read and its last good copy was used (section 8): said once, here
  const recovered = useBoard((b) => b.setup?.some((c) => c.id === 'registry' && c.level === 'warn' && /previous copy was used/.test(c.message)) === true)
  const recoveredSeen = useShell((s) => s.recoveredSeen)
  const board = useMemo(() => ({ projects, owner, now }), [projects, owner, now])
  const list = useMemo(() => groups(board), [board])
  const order = useMemo(() => pickupRows(board, density), [board, density])
  const picks = useMemo(() => pickOrder(board), [board])
  const since = useMemo(() => digest(board, lastOpenedAt), [board, lastOpenedAt])
  const first = picks[0]?.id ?? null
  const last = lastWorkedOn(board)?.doc?.name ?? null
  const target = usePickupTarget()
  const today = localDate(now)
  const selected = order.some((r) => r.id === selectedId) ? selectedId : null
  // every project hidden or archived: Pick up with no strip (section 8)
  const nothing = ready && listOrder(board).length === 0

  const select = (id: string | null): void => useShell.setState({ selectedId: id })

  // J K and the arrows move through the rows; K from the first row returns to none.
  useEffect(
    () =>
      register({
        'list.move': (key) => {
          const i = order.findIndex((r) => r.id === selected)
          const up = key === 'K' || key === 'ArrowUp'
          const j = up ? Math.max(-1, i - 1) : Math.min(order.length - 1, i + 1)
          select(order[j]?.id ?? null)
        }
      }),
    [order, selected]
  )

  // X and N edit only a selected row: the strip offers no Mark done or Not now, so an edit to the
  // Continue project would land from a key no button on screen shows.
  // L acts only where its line is drawn: on a project whose log is behind.
  useEffect(() => {
    if (!target) return
    return register({
      'project.open': () => openProject(target),
      ...(canResume(target) ? { 'project.resume': () => void resume(target) } : {}),
      ...(canPrompt(target) ? { 'project.copyPrompt': () => void copyPrompt(target) } : {}),
      'project.hide': () => void hideProject(target),
      ...(canPrompt(target) && behind(target) ? { 'project.catchUp': () => void catchUp(target) } : {}),
      ...(target.id === selected && writable(target) && target.doc?.next
        ? { 'task.done': () => void markDone(target), 'task.notNow': () => void notNow(target) }
        : {})
    })
  }, [target, selected])

  // the list holding the selected row takes focus, so its aria-activedescendant is read out; with
  // the selection cleared it hands focus to the view's heading, so no ring is left round the whole
  // list and focus is not lost to the page (section 11)
  useEffect(() => {
    const row = selected ? document.getElementById(`row-${selected}`) : null
    row?.scrollIntoView({ block: 'nearest' })
    if (row) row.closest<HTMLElement>('[role=listbox]')?.focus({ preventScroll: true })
    else if (document.activeElement?.getAttribute('role') === 'listbox') {
      ;(document.activeElement as HTMLElement).blur()
      focusHeading()
    }
  }, [selected])

  const dense = density === 'one-line'
  const rows = (rs: ProjectRecord[], group: Group): JSX.Element[] =>
    rs.map((r) => (
      <ProjectRow
        key={r.id}
        r={r}
        variant={r.id === first ? 'continued' : group === 'week' || group === 'recent' ? 'full' : 'line'}
        selected={r.id === selected}
        muted={overlay !== null}
        owner={owner}
        now={now}
        today={today}
        onSelect={select}
      />
    ))
  const section = (g: { group: Group; rows: ProjectRecord[] }): JSX.Element | null => {
    // in one-line density the Continue project's row is the strip; a group left empty is not drawn
    const rs = dense ? g.rows.filter((r) => r.id !== first) : g.rows
    if (g.group === 'archived' || !rs.length) return null
    const [h, why] = HEADINGS[g.group]
    return (
      // a group of options, named by its caption; the caption itself is for the eye, as a listbox holds options only
      <section key={g.group} role="group" aria-label={why ? `${h}, ${why}` : h}>
        <div className="grp" aria-hidden="true">
          <h2>{h}</h2>
          {why && <span className="why">{why}</span>}
        </div>
        {rows(rs, g.group)}
      </section>
    )
  }
  const archived = list.find((g) => g.group === 'archived')?.rows ?? []
  const all = Object.values(projects)
  const hid = all.some((r) => r.hidden && r.state !== 'missing')
  const gone = all.some((r) => r.state === 'missing')
  const off = hid && gone ? 'Hidden and missing projects' : hid ? 'Hidden projects' : gone ? 'Missing projects' : null
  const early = (g: { group: Group }): boolean => g.group === 'week' || g.group === 'recent'
  // each listbox names the selected row only when the row is in it
  const active = (inEarly: boolean): string | undefined =>
    selected && list.some((g) => early(g) === inEarly && g.rows.some((r) => r.id === selected)) ? `opt-${selected}` : undefined

  const earlyRows = list.filter(early).map(section).filter((x) => x !== null)
  const laterRows = list.filter((g) => !early(g)).map(section).filter((x) => x !== null)

  return (
    <div className={dense ? 'home view dense' : 'home view'}>
      <div className="head">
        <h1>Pick up</h1>
        <p>
          {longDay(new Date(now))}.{last !== null && ` Last worked on: ${last}.`}
        </p>
        <span className="sp" />
        <Segmented
          label="Density"
          value={density}
          onChange={setDensity}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'one-line', label: 'One line', caps: 'D' }
          ]}
        />
      </div>
      <div className="main">
        {recovered && !recoveredSeen && (
          <Banner
            actions={
              <Button size="sm" onClick={() => useShell.setState({ recoveredSeen: true })}>
                Dismiss
              </Button>
            }
          >
            Your project list was restored from its last good copy.
          </Banner>
        )}
        {ready && lastOpenedAt !== null && <SinceLine lines={since} since={lastOpenedAt} />}
        {nothing && (
          // Settings lists hidden and missing projects; archived ones are listed on this page (a spec deviation from 8's copy)
          <p className="nothing">
            Nothing on the board.
            {off && (
              <>
                {' '}
                {off} are in{' '}
                <button type="button" onClick={() => useShell.getState().go({ view: 'settings' })}>
                  Settings
                </button>
                .
              </>
            )}
            {archived.length > 0 && ' Archived ones are listed below.'}
          </p>
        )}
        {/* the Continue project's own row, selected, draws no actions: the strip keeps its fill and keys */}
        {ready && !nothing && <ContinueStrip order={picks} owner={owner} now={now} muted={(selected !== null && selected !== first) || overlay !== null} />}
        {ready && picks.length > 0 && <RuleLine />}
        {/* a listbox with no option in it is not drawn */}
        {earlyRows.length > 0 && (
          <div role="listbox" tabIndex={0} aria-label="Projects" aria-activedescendant={active(true)}>
            {earlyRows}
          </div>
        )}
      </div>
      <div className="later">
        {laterRows.length > 0 && (
          <div role="listbox" tabIndex={0} aria-label="Projects not worked on lately" aria-activedescendant={active(false)}>
            {laterRows}
          </div>
        )}
        {archived.length > 0 && (
          <p className="arch">
            Archived:{' '}
            {archived.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ', '}
                <button type="button" onClick={() => openProject(r)}>
                  {r.doc?.name ?? folderName(r.dir)}
                </button>
              </span>
            ))}
          </p>
        )}
      </div>
      <aside className="rail">
        {ready && <HomeScope selected={selected} />}
        {lastOpenedAt !== null && <Digest lines={since} since={lastOpenedAt} />}
      </aside>
      {overlay === 'pick' && <PickPopover order={picks} index={pickIndex} owner={owner} now={now} />}
    </div>
  )
}
