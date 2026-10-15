// First run (renderer spec 8.1): forced while RADAR tracks nothing. An empty scope on the left;
// on the right three steps, one screen each: what setup does, the exact diff it would write, and
// the projects found under a folder the owner picks. Settings reuses the diff step (Run setup
// again) and the found list (Find more projects).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProjectRecord } from '@shared/model'
import { Button } from '../components/atoms'
import { ScopeSvg } from '../components/Scope'
import { register } from '../lib/actions'
import { focusHeading } from '../lib/focus'
import { claudeInstalled, firstRunChecklist, parseSetupDiff, type DiffFile } from '../lib/setup'
import { layout } from '../lib/scope'
import { useBoard } from '../store/board'
import { useShell } from '../store/shell'

const say = (text: string, lead?: string): void => useShell.getState().say(lead ? { lead, text } : { text })

const Tick = (): JSX.Element => (
  <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
    <path d="M1.5 4.6L3.6 6.7L7.5 2.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
)

/** The folder picker, then `discover.find` under the folder picked; null when nothing was picked or the find failed. */
export async function findUnderPickedFolder(): Promise<Found | null> {
  const pick = await window.radar.invoke('system.pickFolder')
  if (!pick.ok) return (say(pick.error.message), null)
  if (!pick.data.dir) return null
  const res = await window.radar.invoke('discover.find', { dir: pick.data.dir })
  if (!res.ok) return (say(res.error.message), null)
  return { dir: pick.data.dir, ...res.data }
}

/** Start tracking a folder: the folder picker, then `project.create`. RADAR never overwrites a BLIP.md already there. */
export async function startTracking(): Promise<ProjectRecord | null> {
  const pick = await window.radar.invoke('system.pickFolder')
  if (!pick.ok) return (say(pick.error.message), null)
  if (!pick.data.dir) return null
  const res = await window.radar.invoke('project.create', { dir: pick.data.dir })
  if (!res.ok) return (say(res.error.message), null)
  useBoard.getState().put(res.data.record)
  const name = res.data.record.doc?.name ?? pick.data.dir
  say(res.data.created ? `Tracking ${name}. A new BLIP.md was written there.` : `Tracking ${name}. Its BLIP.md was already there; nothing was written.`)
  return res.data.record
}

/** Puts the ticked folders on the board (`discover.track`); false when the route refused. */
export async function trackFound(dirs: string[]): Promise<boolean> {
  const res = await window.radar.invoke('discover.track', { dirs })
  if (!res.ok) return (say(res.error.message), false)
  const board = useBoard.getState()
  for (const r of res.data.projects) board.put(r)
  return true
}

export interface Found {
  dir: string
  found: { dir: string; name: string }[]
  truncated: boolean
}

/** Rows shown before `and N more · show all`. */
export const FOUND_SHOWN = 6

/** The found list (8.1 step 3): every row ticked to start with, the first six, then the rest on request. */
export function FoundList({ found, ticked, onTick }: { found: Found; ticked: Set<string>; onTick(dir: string): void }): JSX.Element {
  const [all, setAll] = useState(false)
  const rows = all ? found.found : found.found.slice(0, FOUND_SHOWN)
  const rest = found.found.length - FOUND_SHOWN
  return (
    <div className="found">
      <div className="fh">
        <span>{ticked.size === found.found.length ? 'All ticked' : ticked.size === 0 ? 'None ticked' : 'Some unticked'}</span>
        <span className="mono">BLIP.md</span>
      </div>
      <ul aria-label="Projects found">
        {rows.map((f) => (
          <li key={f.dir}>
            <button
              type="button"
              role="checkbox"
              aria-checked={ticked.has(f.dir)}
              aria-label={f.name}
              className={ticked.has(f.dir) ? 'tick' : 'tick off'}
              onClick={() => onTick(f.dir)}
            >
              {ticked.has(f.dir) && <Tick />}
            </button>
            <div>
              <b>{f.name}</b>
              <span className="mono" title={f.dir}>
                <bdi>{f.dir}</bdi>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <div className="ff">
          {all ? (
            <button type="button" onClick={() => setAll(false)}>
              Show the first {FOUND_SHOWN}
            </button>
          ) : (
            <>
              and {rest} more ·{' '}
              <button type="button" onClick={() => setAll(true)}>
                show all
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** The diff step's blocks: one per file, its path and summary in a title bar, then the unified diff. */
export function DiffBlocks({ files }: { files: DiffFile[] }): JSX.Element {
  return (
    <>
      {files.map((f) => (
        <div className="diff" key={f.path}>
          <div className="dh">
            <span>{f.path}</span>
            <span>{f.summary}</span>
          </div>
          {f.lines.length > 0 && (
            <pre tabIndex={0} aria-label={`Changes to ${f.path}`}>
              {f.lines.map((l, i) => (
                <span key={i} className={l.kind}>
                  {l.text}
                </span>
              ))}
            </pre>
          )}
        </div>
      ))}
    </>
  )
}

/** The lede of the diff step: what the blocks below change, and that nothing else is touched. */
function diffLede(files: DiffFile[]): string {
  const parts: string[] = []
  if (files.some((f) => /settings\.json$/i.test(f.path))) parts.push('Three session hooks in your Claude Code settings')
  const skills = files.filter((f) => /SKILL\.md$|blip\.md$/i.test(f.path)).length
  if (skills) parts.push(skills === 1 ? 'one new skill file' : `${skills} skill files`)
  if (files.some((f) => /radar-blip(\.cmd)?$/i.test(f.path))) parts.push('the command RADAR ships')
  if (files.some((f) => f.summary === 'PATH')) parts.push('your PATH')
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}` : (parts[0] ?? 'Nothing')
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}. Nothing else is touched.`
}

/** The empty scope, rings and ring labels only, laid out at the size its column gives it. */
function EmptyScope(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [S, setS] = useState(640)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // at most 640 square (R 250), smaller when the column is, with room for the caption below
    const measure = (): void => setS(Math.max(240, Math.min(640, el.clientWidth - 32, el.clientHeight - 120)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const box = useMemo(() => ({ W: S, H: S, cx: S / 2, cy: S / 2, R: (S * 250) / 640, dot: 4 }), [S])
  const L = useMemo(() => layout([], { ...box, labels: 'all' }), [box])
  return (
    <div className="fill" ref={ref}>
      <div className="crt">
        <ScopeSvg L={L} box={box} />
      </div>
    </div>
  )
}

export type Step = 'start' | 'diff' | 'found'

/**
 * `back`: opened by Run setup again on a board that has projects; the diff step then goes back
 * to Settings when it is done, instead of going on to find projects.
 */
export function FirstRun({ initial = 'start', back = false }: { initial?: Step; back?: boolean }): JSX.Element {
  const checks = useBoard((b) => b.setup)
  const [step, setStep] = useState<Step>(initial)
  // the button that moved the step is gone with it: focus goes to the new step's heading
  useEffect(focusHeading, [step])
  const [files, setFiles] = useState<DiffFile[] | null>(null)
  const [found, setFound] = useState<Found | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [written, setWritten] = useState(false)
  const busy = useRef(false)
  const lines = firstRunChecklist(checks)
  const done = (): void => useShell.getState().goBack()

  /** Runs `fn` unless a step is already in flight: a second press of a button does nothing. */
  const once = (fn: () => Promise<void>) => (): void => {
    if (busy.current) return
    busy.current = true
    void fn().finally(() => (busy.current = false))
  }

  const find = async (): Promise<void> => {
    const f = await findUnderPickedFolder()
    if (!f) return
    setFound(f)
    setTicked(new Set(f.found.map((x) => x.dir)))
    setStep('found')
  }

  const plan = async (): Promise<void> => {
    const res = await window.radar.invoke('setup.run', { apply: false })
    if (!res.ok) return say(res.error.message)
    setFiles(parseSetupDiff(res.data.diff))
  }

  // Run setup again opens on the diff
  useEffect(() => {
    if (initial === 'diff') void plan()
  }, [initial])

  const connect = once(async () => {
    // with Claude Code not installed there is nothing to connect: straight to the folder picker
    if (!claudeInstalled(checks)) return find()
    const res = await window.radar.invoke('setup.run', { apply: false })
    if (!res.ok) return say(res.error.message)
    const f = parseSetupDiff(res.data.diff)
    if (f.length === 0) return find()
    setFiles(f)
    setStep('diff')
  })

  const write = once(async () => {
    const api = window.radar
    const res = await api.invoke('setup.run', { apply: true })
    if (!res.ok) return say(res.error.message, 'Nothing was written.')
    // the PATH change is shown in the same diff and confirmed by the same press (spec 8.2, C.54)
    if (files?.some((f) => f.summary === 'PATH')) {
      const p = await api.invoke('setup.path', { apply: true })
      if (!p.ok) say(p.error.message)
    }
    await useBoard.getState().refreshSetup(api)
    setWritten(true)
    say('Setup is written.')
    if (back) return done()
    // the diff is written: whatever the folder picker answers, this screen does not offer it again
    setFiles(null)
    setStep('start')
    await find()
  })

  const skip = once(async () => (back ? done() : find()))
  const cancel = (): void => (back ? done() : setStep('start'))
  const put = once(async () => {
    if (await trackFound([...ticked])) setFound(null)
  })
  const another = once(find)
  const track = once(async () => void (await startTracking()))

  const primary = step === 'start' ? connect : step === 'diff' ? (files?.length ? write : undefined) : found && ticked.size ? put : undefined

  // ↵ is the screen's one filled button, as in a dialog; Esc on the diff and found steps is Cancel
  useEffect(() => register({ ...(primary ? { 'project.open': primary } : {}), ...(step === 'start' ? {} : { 'nav.back': cancel }) }), [primary, step, back])

  const caption =
    step === 'found' && found?.found.length
      ? `${ticked.size} blips are about to appear.`
      : 'Projects appear here, closest to the centre when most recently worked on.'

  return (
    <div className="first">
      <div className="l">
        <EmptyScope />
        <p className="cap">{caption}</p>
      </div>
      <div className="r">
        {step === 'start' && (
          <>
            <h1>Nothing on the scope yet.</h1>
            <p className="lede">
              RADAR shows every project you are building, read from a BLIP.md that your coding agent keeps current. One step sets that up and finds the projects
              you already have.
            </p>
            <div className="go">
              <Button variant="primary" size="lg" caps="Enter" onClick={connect}>
                Connect to Claude Code and find my projects
              </Button>
            </div>
            <ul className="chk" aria-label="What this does">
              {lines.map((l) => (
                <li key={l.title}>
                  <span className={l.done ? 'ic ok' : 'ic'}>{l.done && <Tick />}</span>
                  <span>
                    <b>{l.title}</b>
                    {l.text}
                  </span>
                  <span className="st">{l.state}</span>
                </li>
              ))}
            </ul>
            <p className="fine">
              No BLIP.md yet?{' '}
              <button type="button" className="u" onClick={track}>
                Start tracking a folder
              </button>{' '}
              creates one. RADAR never overwrites a file that is already there.
            </p>
          </>
        )}
        {step === 'diff' && (
          <>
            <div className="lab">Connect to Claude Code</div>
            <h1 className="mt-2">Here is exactly what RADAR will write.</h1>
            {files === null ? null : files.length === 0 ? (
              <p className="lede">Already set up. There is nothing to write.</p>
            ) : (
              <>
                <p className="lede">{diffLede(files)}</p>
                <DiffBlocks files={files} />
              </>
            )}
            {/* the confirm row stays in view below a long diff */}
            <div className="confirm">
              {files !== null && files.length > 0 && (
                <p className="assure">
                  <b>Nothing is written until you confirm.</b> A copy of settings.json is kept beside it first.
                </p>
              )}
              <div className="go mt-4">
                {files !== null && files.length > 0 && (
                  <Button variant="primary" size="lg" caps="Enter" onClick={write}>
                    Write these changes
                  </Button>
                )}
                {files !== null && files.length > 0 && (
                  <Button size="lg" onClick={skip}>
                    Skip the hooks
                  </Button>
                )}
                <Button size="lg" onClick={cancel}>
                  {files !== null && files.length === 0 ? 'Back' : 'Cancel'}
                </Button>
              </div>
            </div>
            {!back && (
              <p className="fine">
                Skip the hooks and RADAR still works: you find your projects next, and run /blip by hand when you want a file brought up to date.
              </p>
            )}
          </>
        )}
        {step === 'found' &&
          found &&
          (found.found.length === 0 ? (
            <>
              <h1>No BLIP.md under {found.dir}.</h1>
              <p className="lede">
                {found.truncated ? 'Stopped after 20,000 folders; pick a narrower one to be sure. ' : ''}Pick another folder, or start tracking one: RADAR
                writes a new BLIP.md there.
              </p>
              <div className="go">
                <Button size="lg" onClick={another}>
                  Pick another folder
                </Button>
                <Button size="lg" onClick={track}>
                  Start tracking a folder
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1>
                Found {found.found.length} {found.found.length === 1 ? 'project' : 'projects'} under {found.dir}.
              </h1>
              <p className="lede">Each one already has a BLIP.md. Untick anything you do not want on the board; nothing is written to any of them.</p>
              {found.truncated && <p className="lede">Stopped after 20,000 folders; pick a narrower one to be sure.</p>}
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
              <div className="go">
                {ticked.size > 0 && (
                  <Button variant="primary" size="lg" caps="Enter" onClick={put}>
                    Put them on the board
                  </Button>
                )}
                <Button size="lg" onClick={another}>
                  Pick another folder
                </Button>
              </div>
              {(written || lines[3]?.done) && (
                <p className="fine">
                  Claude Code is connected. From now on an agent keeps each BLIP.md current at the end of a session; you never fill anything in.
                </p>
              )}
            </>
          ))}
      </div>
    </div>
  )
}
