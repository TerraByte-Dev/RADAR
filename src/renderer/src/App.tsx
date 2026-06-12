import { useEffect } from 'react'
import { BootSplash } from './components/BootSplash'
import { CommandPalette } from './components/CommandPalette'
import { CrtOverlay } from './components/CrtOverlay'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Onboarding } from './components/Onboarding'
import { QuickAdd } from './components/QuickAdd'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { useKeyboard } from './lib/useKeyboard'
import { useStore } from './store/useStore'
import { CalendarView } from './views/CalendarView'
import { LogbookView } from './views/LogbookView'
import { ProjectListView } from './views/ProjectListView'
import { RadarView } from './views/RadarView'

function ActiveView({ kind }: { kind: string }): JSX.Element {
  if (kind === 'radar') return <RadarView />
  if (kind === 'logbook') return <LogbookView />
  if (kind === 'calendar') return <CalendarView />
  return <ProjectListView />
}

export default function App(): JSX.Element {
  const loaded = useStore((s) => s.loaded)
  const viewKind = useStore((s) => s.view.kind)
  const bootDone = useStore((s) => s.bootDone)
  const onboarded = useStore((s) => s.onboarded)
  const config = useStore((s) => s.config)
  const { init, setQuickAddOpen } = useStore.getState()

  // First run: no workspace root beyond the app-managed default has been added yet.
  const needsOnboarding =
    !!config && config.roots.filter((r) => r !== config.workspace).length === 0

  useKeyboard()

  useEffect(() => {
    init()
  }, [])

  // Global quick-add hotkey fired from the main process.
  useEffect(() => {
    return window.api.onOpenQuickAdd(() => setQuickAddOpen(true))
  }, [])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-bg">
      <TitleBar />

      <div className="relative z-[1] flex flex-1 overflow-hidden">
        <div className="term-grid-bg" aria-hidden />
        {loaded && (
          <>
            <Sidebar />
            {/* keyed so switching views retries a fresh render after a fault */}
            <ErrorBoundary key={viewKind}>
              <ActiveView kind={viewKind} />
            </ErrorBoundary>
          </>
        )}
      </div>

      <QuickAdd />
      <CommandPalette />
      <CrtOverlay />
      {loaded && bootDone && !onboarded && needsOnboarding && <Onboarding />}
      {!bootDone && <BootSplash />}
    </div>
  )
}
