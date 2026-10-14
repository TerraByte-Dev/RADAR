// The scope (renderer spec 7): the static SVG drawn from lib/scope's layout, the home panel in
// Pick up's rail (6.3), and the Scope view's readout and list (6.7). Nothing moves: the SVG is
// redrawn only when the layout's inputs change.
import { useMemo, type KeyboardEvent } from 'react'
import type { ProjectRecord } from '@shared/model'
import { ageLabel, behind, days, dueLabel, groups, localDate, pickOrder, sourceGlyph, touchedThisWeek, type BoardData, type Group } from '../lib/derive'
import { HOME_PANEL, HOME_PANEL_WIDE, layout, scopeProjects, STOPS, syncBearings, type ScopeLayout, type ScopeOptions } from '../lib/scope'
import { useBoard } from '../store/board'
import { useShell } from '../store/shell'
import { Chip, Kbd } from './atoms'
import { FilesGlyph, GitGlyph } from './glyphs'
import { folderName, LiveMark, NextStep } from './ProjectRow'

const n1 = (v: number): string => v.toFixed(1)

/** The board as the selectors read it, and the stored bearings for every record it holds. */
export function useScopeBoard(): { board: BoardData; slots: Record<string, number> } {
  const projects = useBoard((b) => b.projects)
  const owner = useBoard((b) => b.owner)
  const now = useBoard((b) => b.now)
  const ready = useBoard((b) => b.status === 'ready')
  const board = useMemo(() => ({ projects, owner, now }), [projects, owner, now])
  const ids = Object.keys(projects).sort().join(' ')
  // only once the list is read: before that an empty board would let every stored bearing go
  const slots = useMemo(() => (ready ? syncBearings(ids ? ids.split(' ') : []) : {}), [ids, ready])
  return { board, slots }
}

export interface ScopeSvgProps {
  L: ScopeLayout
  box: Pick<ScopeOptions, 'W' | 'H' | 'cx' | 'cy' | 'R' | 'dot' | 'stops'>
  /** Blips are buttons on the Scope view; on the home panel the whole panel is one link. */
  interactive?: boolean
  hover?: string | null
  onHover?(id: string | null): void
  onSelect?(id: string): void
  onOpen?(id: string): void
}

/** The scope as static SVG, laid out at its rendered size (rule 9): never scaled by CSS. */
export function ScopeSvg({ L, box, interactive = false, hover = null, onHover, onSelect, onOpen }: ScopeSvgProps): JSX.Element {
  const { W, H, cx, cy, R, dot } = box
  const stops = box.stops ?? STOPS
  const week = stops.week
  const key = (id: string) => (e: KeyboardEvent): void => {
    if (e.key === 'Enter') onOpen?.(id)
    else if (e.key === ' ') onSelect?.(id)
    else return
    e.preventDefault()
  }
  return (
    <svg
      className="scope"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      // a group, not an img: an img's children are presentational, and each blip is a button (7.5)
      role={interactive ? 'group' : undefined}
      aria-hidden={interactive ? undefined : true}
      aria-label={interactive ? `Scope: ${L.items.length} projects placed by time since last work` : undefined}
    >
      <circle className="disc" cx={cx} cy={cy} r={n1(R)} />
      <circle className="zone" cx={cx} cy={cy} r={n1(R * week)} />
      {(
        [
          [stops.day, 'ring f'],
          [stops.week, 'ring'],
          [stops.six, 'ring'],
          [1, 'ring rim']
        ] as const
      ).map(([f, c]) => (
        <circle key={c + f} className={c} cx={cx} cy={cy} r={n1(R * f)} />
      ))}
      {L.cross && <path className="cross" d={`M${cx - 4} ${cy}H${cx + 4}M${cx} ${cy - 4}V${cy + 4}`} />}
      {L.scales.map((s) => (
        <g key={s.text}>
          <rect className={s.f <= week ? 'knock in' : 'knock'} x={n1(s.r.x)} y={n1(s.r.y + 1)} width={n1(s.r.w)} height="16" />
          <text className="scale" x={cx} y={n1(cy - R * s.f + 4)} textAnchor="middle">
            {s.text}
          </text>
        </g>
      ))}
      {L.items.map((it) => {
        const p = it.p
        const cls = [
          'blip',
          `t-${it.tier}`,
          it.on && `on-${it.on}`,
          p.status === 'archived' && 'is-arch',
          p.status === 'paused' && 'is-paused',
          it.sel && 'is-sel',
          hover === p.id && 'hov'
        ]
          .filter(Boolean)
          .join(' ')
        const q = dot + 7
        const r = it.L?.r
        return (
          <g
            key={p.id}
            className={cls}
            data-blip={p.id}
            tabIndex={interactive ? 0 : undefined}
            role={interactive ? 'button' : undefined}
            aria-label={interactive ? `${p.name}, ${p.live ? 'agent session live, ' : ''}${p.focus ? 'focus, ' : ''}last worked ${p.age}` : undefined}
            onMouseEnter={onHover && (() => onHover(p.id))}
            onMouseLeave={onHover && (() => onHover(null))}
            onClick={onSelect && (() => onSelect(p.id))}
            onDoubleClick={onOpen && (() => onOpen(p.id))}
            onKeyDown={interactive ? key(p.id) : undefined}
          >
            <circle className="hit" cx={n1(it.x)} cy={n1(it.y)} r="14" />
            {it.L?.leader && r && (
              <line
                className="leader"
                x1={n1(it.x + it.L.side * (dot + 1))}
                y1={n1(it.y + Math.sign(it.L.dy) * 2)}
                x2={n1(it.L.side > 0 ? r.x + 1 : r.x + r.w - 1)}
                y2={n1(it.y + it.L.dy)}
              />
            )}
            {p.live && <circle className="live" cx={n1(it.x)} cy={n1(it.y)} r={dot + 3.5} />}
            {p.focus && (
              <path
                className="reticle"
                d={[
                  [-1, -1],
                  [1, -1],
                  [1, 1],
                  [-1, 1]
                ]
                  .map(([u, v]) => `M${n1(it.x + u * q)} ${n1(it.y + v * (q - 4))}V${n1(it.y + v * q)}H${n1(it.x + u * (q - 4))}`)
                  .join('')}
              />
            )}
            <circle className="dot" cx={n1(it.x)} cy={n1(it.y)} r={dot} />
            {interactive && !it.L && <rect className="fsq" x={n1(it.x - q - 3)} y={n1(it.y - q - 3)} width={n1(2 * q + 6)} height={n1(2 * q + 6)} rx="2" />}
            {it.L && r && (
              <>
                <rect className="plate" x={n1(r.x - 2)} y={n1(r.y - 1)} width={n1(r.w + 4)} height="18" rx="2" />
                <text
                  className="lbl"
                  x={n1(it.L.side < 0 ? r.x + r.w - 2 : it.L.side > 0 ? r.x + 2 : r.x + r.w / 2)}
                  y={n1(r.y + 12.5)}
                  textAnchor={it.L.side < 0 ? 'end' : it.L.side > 0 ? 'start' : 'middle'}
                  fontSize={it.px}
                >
                  {p.name}
                  {it.sub && (
                    <tspan className="sub" dx="7">
                      {it.sub}
                    </tspan>
                  )}
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * The home panel (6.3): a title bar, the scope laid out at native size, and its foot. The whole
 * panel is one link to the Scope. Under 1500 it names this week's projects; from 1500 the last six
 * weeks too. Every focus project and the Continue project is named on a realistic board (see
 * PANEL_STOPS for the limit); the selected one is named only where there is room, and never moves a mark.
 */
export function HomeScope({ selected }: { selected: string | null }): JSX.Element {
  const { board, slots } = useScopeBoard()
  const projects = useMemo(() => scopeProjects(board), [board])
  const first = pickOrder(board)[0]?.id
  const keep = first ? [first] : []
  const narrow = useMemo(() => layout(projects, { ...HOME_PANEL, selected, keep, slots }), [projects, selected, first, slots])
  const wide = useMemo(() => layout(projects, { ...HOME_PANEL_WIDE, selected, keep, slots }), [projects, selected, first, slots])
  const go = (e: { preventDefault(): void }): void => {
    e.preventDefault()
    useShell.getState().go({ view: 'scope' })
  }
  return (
    <a className="panel" href="#scope" aria-label="Open the scope" onClick={go}>
      <div className="ph">
        <b>radar/scope</b>
        <span>{touchedThisWeek(board)} touched this week</span>
      </div>
      <div className="s-n crt">
        <ScopeSvg L={narrow} box={HOME_PANEL} />
      </div>
      <div className="s-w crt">
        <ScopeSvg L={wide} box={HOME_PANEL_WIDE} />
      </div>
      <div className="pf">
        <span>Closer in is more recent</span>
        <span>
          Open <Kbd>2</Kbd>
        </span>
      </div>
    </a>
  )
}

/** The hovered blip, else the selected one, else the Continue project: name, tag, Now, next step whole, and one mono line. */
export function ScopeReadout({ r, owner, now }: { r: ProjectRecord | null; owner: string | null; now: number }): JSX.Element {
  const doc = r?.doc
  const glyph = r && sourceGlyph(r)
  const branch = r?.activity?.git?.branch
  return (
    <div className="readout">
      {r && (
        <>
          <div className="nmline">
            <span className="nm">{doc?.name ?? folderName(r.dir)}</span>
            {doc?.tags[0] && <Chip quiet>{doc.tags[0]}</Chip>}
          </div>
          {doc?.now && <div className="now">{doc.now}</div>}
          <NextStep task={doc?.next ?? null} owner={owner} due={dueLabel(doc?.next?.due ?? doc?.due ?? null, localDate(now))} />
          <span className="mono">
            {r.agent.live ? <LiveMark live /> : ageLabel(days(r, now))}
            {glyph === 'branch' && <GitGlyph />}
            {glyph === 'page' && <FilesGlyph />}
            {branch && ` · ${branch}`}
            {behind(r) && ' · log behind'}
          </span>
        </>
      )}
    </div>
  )
}

const RING_HEADINGS: Record<Group, string> = {
  week: 'This week',
  recent: 'Last six weeks',
  earlier: 'Earlier',
  paused: 'Paused',
  archived: 'Archived, on the rim'
}

export interface ScopeListProps {
  board: BoardData
  selected: string | null
  hover: string | null
  onHover(id: string | null): void
  onSelect(id: string): void
  onOpen(id: string): void
}

/**
 * Every visible project by ring, the headings of Pick up and the rim, nearest first: the order of
 * distance on the disc, not Pick up's focus-first. The non-visual scope: present at every width.
 */
export function ScopeList({ board, selected, hover, onHover, onSelect, onOpen }: ScopeListProps): JSX.Element {
  const list = useMemo(() => {
    const d = (r: ProjectRecord): number => days(r, board.now) ?? Infinity
    const name = (r: ProjectRecord): string => r.doc?.name ?? folderName(r.dir)
    return groups(board).map((g) => ({ ...g, rows: g.rows.slice().sort((x, y) => d(x) - d(y) || name(x).localeCompare(name(y))) }))
  }, [board])
  return (
    <nav className="sl" aria-label="Projects by ring">
      {list.map((g) => (
        <div key={g.group}>
          <h2>{RING_HEADINGS[g.group]}</h2>
          {g.rows.map((r) => (
            <button
              key={r.id}
              type="button"
              data-id={r.id}
              className={[r.id === selected && 'on', r.id === hover && 'hov', g.group !== 'week' && g.group !== 'recent' && 'dim'].filter(Boolean).join(' ') || undefined}
              aria-pressed={r.id === selected}
              onMouseEnter={() => onHover(r.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(r.id)}
              onDoubleClick={() => onOpen(r.id)}
              // Enter opens, as on a blip; Space (the button's click) selects
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                onOpen(r.id)
              }}
            >
              <span>
                {r.doc?.focus && <span className="dia" title="Pinned as focus" />}
                {r.doc?.name ?? folderName(r.dir)}
              </span>
              {g.group !== 'archived' && (r.agent.live ? <LiveMark live /> : <span className="mono">{ageLabel(days(r, board.now))}</span>)}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
