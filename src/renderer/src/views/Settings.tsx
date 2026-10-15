// Settings (renderer spec 6.8): projects off the board (hidden and missing), what the agent loop
// needs, how RADAR looks, and the version. No button here is filled.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectRecord } from '@shared/model'
import { Button, Kbd, Segmented } from '../components/atoms'
import { folderName } from '../lib/derive'
import { setupRows } from '../lib/setup'
import { useBoard } from '../store/board'
import { useShell, type SettingsSection } from '../store/shell'
import { findUnderPickedFolder, FoundList, startTracking, trackFound, type Found } from './FirstRun'

const SECTIONS: [SettingsSection, string][] = [
  ['projects', 'Projects'],
  ['setup', 'Setup'],
  ['appearance', 'Appearance'],
  ['about', 'About']
]

const say = (text: string): void => useShell.getState().say({ text })
const nameOf = (r: ProjectRecord): string => r.doc?.name ?? folderName(r.dir)

function ProjectRows(): JSX.Element {
  const projects = useBoard((b) => b.projects)
  const off = useMemo(
    () =>
      Object.values(projects)
        .filter((r) => r.hidden || r.state === 'missing')
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [projects]
  )
  const [found, setFound] = useState<Found | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())

  const show = async (r: ProjectRecord): Promise<void> => {
    const res = await window.radar.invoke('project.setHidden', { id: r.id, hidden: false })
    if (!res.ok) return say(res.error.message)
    useBoard.getState().put(res.data.record)
    say(`${nameOf(r)} is back on the board.`)
  }
  const look = async (r: ProjectRecord): Promise<void> => {
    const res = await window.radar.invoke('activity.refresh', { ids: [r.id] })
    if (!res.ok) return say(res.error.message)
    say(`Looking for ${nameOf(r)} again. It comes back on the board once BLIP.md is there.`)
  }
  const stop = async (r: ProjectRecord): Promise<void> => {
    const res = await window.radar.invoke('project.untrack', { id: r.id })
    if (!res.ok) return say(res.error.message)
    useBoard.getState().drop(r.id)
    say(`${nameOf(r)} is no longer tracked. Nothing on disk was touched.`)
  }
  const more = async (): Promise<void> => {
    const f = await findUnderPickedFolder()
    if (!f) return
    // a folder already on the board is not offered again
    const known = new Set(Object.values(useBoard.getState().projects).map((r) => r.dir.toLowerCase()))
    const fresh = { ...f, found: f.found.filter((x) => !known.has(x.dir.toLowerCase())) }
    if (!fresh.found.length) return say(f.found.length ? `Every BLIP.md under ${f.dir} is tracked already.` : `No BLIP.md under ${f.dir}.`)
    setFound(fresh)
    setTicked(new Set(fresh.found.map((x) => x.dir)))
  }
  const put = async (): Promise<void> => {
    const dirs = [...ticked]
    if (!(await trackFound(dirs))) return
    setFound(null)
    say(`${dirs.length === 1 ? 'One project is' : `${dirs.length} projects are`} on the board.`)
  }

  return (
    <>
      {off.length === 0 && <p className="none">Every tracked project is on the board.</p>}
      {off.map((r) =>
        r.state === 'missing' ? (
          <div className="setrow" key={r.id}>
            <b>{nameOf(r)}</b>
            <span>
              BLIP.md is not at <span className="mono">{r.dir}</span>. A drive may be unplugged.
            </span>
            <span className="act">
              <Button size="sm" onClick={() => void look(r)}>
                Look again
              </Button>
              <Button size="sm" onClick={() => void stop(r)}>
                Stop tracking
              </Button>
            </span>
          </div>
        ) : (
          <div className="setrow" key={r.id}>
            <b>{nameOf(r)}</b>
            <span className="mono" title={r.dir}>
              {r.dir}
            </span>
            <span className="act">
              <span className="ok">hidden</span>
              <Button size="sm" onClick={() => void show(r)}>
                Show on the board
              </Button>
            </span>
          </div>
        )
      )}
      {found ? (
        <div className="morefound">
          <FoundList
            found={found}
            ticked={ticked}
            onTick={(d) =>
              setTicked((t) => {
                const n = new Set(t)
                if (!n.delete(d)) n.add(d)
                return n
              })
            }
          />
          {found.truncated && <p className="none">Stopped after 20,000 folders; pick a narrower one to be sure.</p>}
          <div className="btns">
            {ticked.size > 0 && <Button onClick={() => void put()}>Put them on the board</Button>}
            <Button onClick={() => setFound(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="btns">
          <Button onClick={() => void more()}>Find more projects</Button>
          <Button onClick={() => void startTracking()}>Start tracking a folder</Button>
        </div>
      )}
    </>
  )
}

export function Settings({ section }: { section?: SettingsSection }): JSX.Element {
  const checks = useBoard((b) => b.setup)
  const info = useBoard((b) => b.info)
  const theme = useShell((s) => s.theme)
  const density = useShell((s) => s.density)
  const [on, setOn] = useState<SettingsSection>(section ?? 'projects')
  const refs = useRef<Partial<Record<SettingsSection, HTMLElement | null>>>({})

  // the section picked stays marked while the page rests where picking it scrolled to
  const picked = useRef<{ s: SettingsSection; y: number } | null>(null)
  const go = (s: SettingsSection): void => {
    setOn(s)
    refs.current[s]?.scrollIntoView({ block: 'start' })
    picked.current = { s, y: window.scrollY }
  }
  // scrolled by hand, the list marks the section at the top of the window, or the last one at the end of the page
  useEffect(() => {
    const follow = (): void => {
      if (picked.current && Math.abs(window.scrollY - picked.current.y) < 2) return
      picked.current = null
      const end = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      let at: SettingsSection = SECTIONS[0][0]
      for (const [id] of SECTIONS) if ((refs.current[id]?.getBoundingClientRect().top ?? Infinity) <= 96) at = id
      setOn(end ? SECTIONS[SECTIONS.length - 1][0] : at)
    }
    window.addEventListener('scroll', follow, { passive: true })
    return () => window.removeEventListener('scroll', follow)
  }, [])
  // opened on a section (the git warning's details): that section in view
  useEffect(() => {
    if (section) go(section)
    else window.scrollTo(0, 0)
  }, [section])

  // update.check's answer arrives as update.event; said once, as a toast
  const checking = useRef(false)
  useEffect(
    () =>
      window.radar.on('update.event', (e) => {
        if (!checking.current) return
        if (e.type === 'available') say(`RADAR ${e.version} is available. It downloads in the background.`)
        else if (e.type === 'not-available') say('RADAR is up to date.')
        else if (e.type === 'error') say(`Could not check for updates. ${e.message}`)
        else return
        checking.current = false
      }),
    []
  )
  const check = async (): Promise<void> => {
    const res = await window.radar.invoke('update.check')
    if (!res.ok) return say(res.error.message)
    if (res.data.devMode) return say('Updates are checked by the installed app, not a development build.')
    checking.current = true
  }

  const section$ = (id: SettingsSection, title: string, lede: string | null, body: JSX.Element): JSX.Element => (
    <section id={`set-${id}`} aria-labelledby={`set-${id}-h`} ref={(el) => void (refs.current[id] = el)}>
      <h2 id={`set-${id}-h`}>{title}</h2>
      {lede && <p>{lede}</p>}
      {body}
    </section>
  )

  return (
    <div className="settings view">
      <div className="head">
        <h1>Settings</h1>
        <p>Projects off the board, what is connected, and how RADAR looks.</p>
      </div>
      <nav aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} type="button" className={on === id ? 'on' : undefined} aria-current={on === id ? 'true' : undefined} onClick={() => go(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div>
        {section$('projects', 'Projects', 'Every BLIP.md that RADAR tracks and does not show. Hiding never touches the file.', <ProjectRows />)}
        {section$(
          'setup',
          'Setup',
          'What the agent loop needs. Running setup again shows the exact diff before anything is written.',
          <>
            {setupRows(checks).map((l) => (
              <div className="setrow" key={l.title}>
                <b>{l.title}</b>
                {l.path ? (
                  <span className="mono" title={l.text}>
                    {l.text}
                  </span>
                ) : (
                  <span>{l.text}</span>
                )}
                <span className="act">
                  <span className="ok">{checks ? l.state : ''}</span>
                </span>
              </div>
            ))}
            <div className="btns">
              <Button onClick={() => useShell.getState().go({ view: 'first-run', step: 'diff' })}>Run setup again</Button>
            </div>
          </>
        )}
        {section$(
          'appearance',
          'Appearance',
          null,
          <>
            <div className="setrow">
              <b>Theme</b>
              <span>Follows the system until you choose.</span>
              <span className="act">
                <Segmented
                  label="Theme"
                  value={theme}
                  onChange={useShell.getState().setTheme}
                  options={[
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' }
                  ]}
                />
                <Kbd>T</Kbd>
              </span>
            </div>
            <div className="setrow">
              <b>Density</b>
              <span>One line fits every project on one screen.</span>
              <span className="act">
                <Segmented
                  label="Density"
                  value={density}
                  onChange={useShell.getState().setDensity}
                  options={[
                    { value: 'comfortable', label: 'Comfortable' },
                    { value: 'one-line', label: 'One line' }
                  ]}
                />
                <Kbd>D</Kbd>
              </span>
            </div>
          </>
        )}
        {section$(
          'about',
          'About',
          null,
          <>
            <div className="setrow">
              <b>RADAR</b>
              <span className="mono">{info ? `${info.version} · engine ${info.engineVersion} · ${info.platform}` : ''}</span>
              <span className="act">
                <Button size="sm" onClick={() => void check()}>
                  Check for updates
                </Button>
              </span>
            </div>
            <div className="setrow">
              <b>Fonts</b>
              <span>IBM Plex Mono and VT323, bundled under the SIL Open Font License 1.1.</span>
              <span className="act" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
