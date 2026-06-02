import { useEffect } from 'react'
import { BootSplash } from './components/BootSplash'
import { CommandPalette } from './components/CommandPalette'
import { CrtOverlay } from './components/CrtOverlay'
import { QuickAdd } from './components/QuickAdd'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { useKeyboard } from './lib/useKeyboard'
import { useStore } from './store/useStore'
import { CalendarView } from './views/CalendarView'
import { LogbookView } from './views/LogbookView'
import { RadarView } from './views/RadarView'
import { TaskListView } from './views/TaskListView'

function ActiveView({ kind }: { kind: string }): JSX.Element {
  if (kind === 'radar') return <RadarView />
  if (kind === 'logbook') return <LogbookView />
  if (kind === 'calendar') return <CalendarView />
  return <TaskListView />
}

export default function App(): JSX.Element {
  const loaded = useStore((s) => s.loaded)
  const viewKind = useStore((s) => s.view.kind)
  const bootDone = useStore((s) => s.bootDone)
  const { init, setQuickAddOpen } = useStore.getState()

  useKeyboard()

  useEffect(() => {
    init()
  }, [])

  // Global quick-add hotkey fired from the main process.
  useEffect(() => {
    return window.api.onOpenQuickAdd(() => setQuickAddOpen(true))
  }, [])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
      <TitleBar />

      <div className="relative z-[1] flex flex-1 overflow-hidden">
        <div className="term-grid-bg" aria-hidden />
        {loaded && (
          <>
            <Sidebar />
            <ActiveView kind={viewKind} />
          </>
        )}
      </div>

      <QuickAdd />
      <CommandPalette />
      <CrtOverlay />
      {!bootDone && <BootSplash />}
    </div>
  )
}
