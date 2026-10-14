// The shell (renderer spec 2): top bar, the view, status bar.
import { useEffect } from 'react'
import { onKeyDown, register } from './lib/actions'
import { undo } from './lib/edits'
import { watchAway } from './lib/away'
import { readPrefs, writePrefs } from './lib/prefs'
import { openPick } from './lib/projectActions'
import { applyTheme } from './lib/theme'
import { focusHeading } from './lib/focus'
import { StatusBar } from './components/StatusBar'
import { TopBar } from './components/TopBar'
import { Toast } from './components/Toast'
import { KeysSheet } from './components/KeysSheet'
import { Palette } from './components/Palette'
import { pickOrder, rightStatus } from './lib/derive'
import { nothingTracked, useBoard } from './store/board'
import { useShell } from './store/shell'
import { usePickupTarget } from './views/PickUp'
import { useScopeTarget } from './views/Scope'
import { useLogSelection } from './views/Log'
import { FirstRun, Log, PickUp, ProjectPage, Scope, Settings } from './views/views'
import { Button } from './components/atoms'

export default function App(): JSX.Element {
  const route = useShell((s) => s.route)
  const view = route.view
  const target = usePickupTarget()
  const scopeTarget = useScopeTarget()
  const theme = useShell((s) => s.theme)
  const overlay = useShell((s) => s.overlay)
  const palette = useShell((s) => s.palette)
  const logTarget = useLogSelection((s) => s.name)
  const status = useBoard(rightStatus)
  const pageName = useBoard((b) => (route.view === 'project' ? (b.projects[route.id]?.doc?.name ?? null) : null))
  const boardStatus = useBoard((b) => b.status)
  const boardError = useBoard((b) => b.error)
  // first run is forced while RADAR tracks nothing at all (section 2, 8.1)
  const empty = useBoard(nothingTracked)
  const canPick = useBoard((b) => pickOrder(b).length > 0)
  const firstRun = empty || view === 'first-run'

  useEffect(() => applyTheme(theme), [theme])

  // a new view: focus lost with the old one goes to its heading
  const routeKey = route.view === 'project' ? `project:${route.id}` : route.view
  useEffect(focusHeading, [routeKey, boardStatus, firstRun])

  useEffect(() => {
    const board = useBoard.getState()
    const stop = board.start(window.radar)
    const tick = (): void => board.tick()
    const minute = setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    return () => {
      stop()
      clearInterval(minute)
      window.removeEventListener('focus', tick)
    }
  }, [])

  useEffect(() => {
    const s = useShell.getState()
    const off = register({
      'theme.toggle': s.toggleTheme,
      'density.toggle': s.toggleDensity,
      'nav.back': s.goBack,
      'edit.undo': () => void undo(),
      'palette.open': () => useShell.setState({ overlay: 'palette', palette: 'all' }),
      'palette.projects': () => useShell.setState({ overlay: 'palette', palette: 'projects' }),
      'keys.show': () => useShell.setState({ overlay: 'keys' })
    })
    window.addEventListener('keydown', onKeyDown)
    // The theme follows the system until one is chosen with T.
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const follow = (e: MediaQueryListEvent): void => {
      if (!readPrefs().theme) useShell.setState({ theme: e.matches ? 'light' : 'dark' })
    }
    mq.addEventListener('change', follow)
    return () => {
      off()
      window.removeEventListener('keydown', onKeyDown)
      mq.removeEventListener('change', follow)
    }
  }, [])

  // the views wait while first run is forced; P only while there is something to pick
  useEffect(() => {
    if (empty) return
    const s = useShell.getState()
    return register({
      'view.pickup': () => s.go({ view: 'pickup' }),
      'view.scope': () => s.go({ view: 'scope' }),
      'view.log': () => s.go({ view: 'log' }),
      'view.settings': () => s.go({ view: 'settings' }),
      // Pick one for me opens on Pick up, under the strip's Pick button
      ...(canPick
        ? {
            'pick.open': () => {
              s.go({ view: 'pickup' })
              openPick(pickOrder(useBoard.getState()))
            }
          }
        : {})
    })
  }, [empty, canPick])

  // lastOpenedAt (section 2): written as the window closes, and after ten minutes hidden (lib/away)
  useEffect(() => {
    const leave = (): void => writePrefs({ lastOpenedAt: Date.now() })
    const away = watchAway(() => document.hidden, {
      away: (at) => writePrefs({ lastOpenedAt: at }),
      back: (at) => {
        writePrefs({ lastOpenedAt: at })
        useShell.setState({ lastOpenedAt: at, sinceOpen: false })
      }
    })
    window.addEventListener('beforeunload', leave)
    document.addEventListener('visibilitychange', away.change)
    return () => {
      away.stop()
      window.removeEventListener('beforeunload', leave)
      document.removeEventListener('visibilitychange', away.change)
    }
  }, [])

  return (
    <>
      <TopBar />
      <main>
        {/* starting: the top bar and the status bar only; the list call answers in a tick (section 8) */}
        {boardStatus === 'loading' ? null : boardStatus === 'error' ? (
          <div className="failed" role="alert">
            <p>RADAR could not read its project list. {boardError?.message}</p>
            <Button onClick={() => void useBoard.getState().reload(window.radar)}>Try again</Button>
          </div>
        ) : firstRun ? (
          <FirstRun key={empty ? 'empty' : 'again'} initial={route.view === 'first-run' && !empty ? route.step : 'start'} back={!empty} />
        ) : (
          <>
            {view === 'pickup' && <PickUp />}
            {route.view === 'project' && <ProjectPage key={route.id} id={route.id} />}
            {view === 'scope' && <Scope />}
            {view === 'log' && <Log />}
            {route.view === 'settings' && <Settings section={route.section} />}
          </>
        )}
      </main>
      {overlay === 'palette' && <Palette key={palette} projectsOnly={palette === 'projects'} />}
      {overlay === 'keys' && <KeysSheet />}
      <Toast />
      {!firstRun && (
        <StatusBar
          view={view}
          target={view === 'pickup' ? (target?.doc?.name ?? null) : view === 'scope' ? (scopeTarget?.doc?.name ?? null) : view === 'log' ? logTarget : pageName}
          status={status}
        />
      )}
    </>
  )
}
