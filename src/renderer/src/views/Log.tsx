// The Log view (renderer spec 6.7): every log entry from every visible record, newest first, under
// day headings, in a column beside a sticky filter: a text filter on `/` and a Show list of every
// project. Read-only. J K and the arrows move through the entries; Enter opens the selected entry's
// project. 60 entries are drawn at first and 60 more each time the end of the list comes into view.
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { register } from '../lib/actions'
import { groups, localDate, visible } from '../lib/derive'
import { feed, feedDays, feedMatches, type FeedEntry } from '../lib/feed'
import { openProject } from '../lib/projectActions'
import { useBoard } from '../store/board'
import { Kbd } from '../components/atoms'
import { LiveMark } from '../components/ProjectRow'

/** How many entries are drawn at first, and how many more each time the end comes into view. */
export const LOG_PAGE = 60

/** The selected entry, by key, and the project Enter opens (the selected entry's, else the first's); read by the status bar and the palette. */
export const useLogSelection = create<{ key: string | null; id: string | null; name: string | null }>(() => ({ key: null, id: null, name: null }))

export function Log(): JSX.Element {
  const projects = useBoard((b) => b.projects)
  const owner = useBoard((b) => b.owner)
  const now = useBoard((b) => b.now)
  const [query, setQuery] = useState('')
  const [only, setOnly] = useState<string | null>(null)
  const [count, setCount] = useState(LOG_PAGE)
  const sel = useLogSelection((s) => s.key)
  const filterRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const board = useMemo(() => ({ projects, owner, now }), [projects, owner, now])
  const all = useMemo(() => feed(visible(board)), [board])
  const shown = useMemo(() => all.filter((x) => (only === null || x.r.id === only) && feedMatches(x, query)), [all, only, query])
  const drawn = shown.slice(0, count)
  const days = feedDays(drawn, localDate(now))
  // the Show list: every visible project, by group; the list scrolls inside the sticky column
  const show = groups(board).flatMap((g) => g.rows)
  const selected = drawn.find((x) => x.key === sel) ?? null
  const first = drawn[0]

  const select = (x: FeedEntry | null): void => useLogSelection.setState({ key: x?.key ?? null })
  const target = (selected ?? first)?.r ?? null
  useEffect(() => useLogSelection.setState({ id: target?.id ?? null, name: target?.doc?.name ?? null }), [target])

  // the selection goes with the view, and with an entry the filter no longer shows
  useEffect(() => () => useLogSelection.setState({ key: null, id: null, name: null }), [])
  useEffect(() => {
    if (sel && !selected) select(null)
  }, [sel, selected])

  useEffect(
    () =>
      register({
        'palette.projects': () => filterRef.current?.focus(),
        ...(drawn.length
          ? {
              'list.move': (key?: string) => {
                const i = drawn.findIndex((x) => x.key === sel)
                const up = key === 'K' || key === 'ArrowUp'
                select(drawn[up ? Math.max(0, i - 1) : Math.min(drawn.length - 1, i + 1)] ?? null)
              }
            }
          : {}),
        // Enter opens the selected entry's project, else the first entry's, where J would land
        ...(first ? { 'project.open': () => openProject((selected ?? first).r) } : {}),
        ...(selected ? { 'nav.back': () => select(null) } : {})
      }),
    [drawn, sel, selected, first]
  )

  // the list takes focus with its selection, so Enter is the keymap's and not a focused button's
  useEffect(() => {
    const ent = sel ? document.getElementById(`ent-${sel}`) : null
    ent?.scrollIntoView({ block: 'nearest' })
    ent?.closest<HTMLElement>('[role=listbox]')?.focus({ preventScroll: true })
  }, [sel])

  // more entries as the end of the list comes into view
  useEffect(() => {
    const end = endRef.current
    if (!end || shown.length <= count) return
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setCount((c) => c + LOG_PAGE)
    })
    io.observe(end)
    return () => io.disconnect()
  }, [shown.length, count])

  // the author is printed on the first entry and where it differs from the entry above
  let above: string | null | undefined
  return (
    <div className="logpage view">
      <div className="head">
        <h1>Log</h1>
        <p>What happened, newest first, across every project.</p>
      </div>
      <div role="listbox" tabIndex={-1} aria-label="Log entries" aria-activedescendant={sel ? `ent-${sel}` : undefined}>
        {days.map((d) => (
          <section key={d.key} role="group" aria-label={d.sub ? `${d.head} ${d.sub}` : d.head}>
            <div className="day">
              <b>{d.head}</b>
              {d.sub && <span>{d.sub}</span>}
            </div>
            {d.entries.map((x) => {
              const author = x.e.date && x.e.author !== above ? x.e.author : null
              above = x.e.author
              return (
                <div
                  key={x.key}
                  id={`ent-${x.key}`}
                  role="option"
                  aria-selected={x.key === sel}
                  className={x.key === sel ? 'ent sel' : 'ent'}
                  onClick={() => select(x)}
                  onDoubleClick={() => openProject(x.r)}
                >
                  <div className="tm">{x.e.time}</div>
                  <div>
                    {/* no control inside an option: a click on the name opens it, Enter opens the selected entry's */}
                    <div className="pj" onClick={() => openProject(x.r)}>
                      {x.r.doc?.name}
                    </div>
                    {author && <div className="au">{author}</div>}
                  </div>
                  <div>
                    {!x.e.date && <p className="raw">{x.e.heading}</p>}
                    {x.e.bullets.map((b, i) => (
                      <p key={i}>{b}</p>
                    ))}
                  </div>
                </div>
              )
            })}
          </section>
        ))}
        {shown.length === 0 && <p className="none">{all.length ? 'Nothing in the log matches.' : 'No log entries yet. An agent writes one when it runs /blip.'}</p>}
        {shown.length > count && (
          <div ref={endRef} className="day more">
            <span>Earlier entries load as you scroll.</span>
          </div>
        )}
      </div>
      <aside className="logside">
        <label className="filter">
          <input
            ref={filterRef}
            value={query}
            placeholder="Filter the log"
            aria-label="Filter the log"
            onChange={(e) => {
              setQuery(e.target.value)
              setCount(LOG_PAGE)
            }}
            onKeyDown={(e) => {
              // Esc empties the filter, then lets it go; the view stays
              if (e.key !== 'Escape') return
              e.stopPropagation()
              if (query) setQuery('')
              else e.currentTarget.blur()
            }}
          />
          <Kbd>/</Kbd>
        </label>
        <div className="lab">Show</div>
        <nav aria-label="Show">
          {[null, ...show].map((r) => {
            const id = r?.id ?? null
            return (
              <button
                key={id ?? 'all'}
                type="button"
                className={only === id ? 'on' : undefined}
                aria-pressed={only === id}
                onClick={() => {
                  setOnly(id)
                  setCount(LOG_PAGE)
                }}
              >
                <span>{r ? r.doc?.name : 'Every project'}</span>
                {r && <LiveMark live={r.agent.live} />}
              </button>
            )
          })}
        </nav>
        <p>Entries are written by agents at the end of a session, or by you. RADAR never edits one after it is written.</p>
      </aside>
    </div>
  )
}
