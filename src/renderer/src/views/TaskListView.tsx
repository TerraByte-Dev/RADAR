import { AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Plus } from 'lucide-react'
import { Fragment, useMemo } from 'react'
import { TaskRow } from '../components/TaskRow'
import { daysFromToday } from '../lib/date'
import { tasksForView, viewTitle } from '../lib/selectors'
import { useStore } from '../store/useStore'

export function TaskListView(): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const view = useStore((s) => s.view)
  const showCompleted = useStore((s) => s.showCompleted)
  const { setQuickAddOpen, toggleShowCompleted } = useStore.getState()

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const visible = useMemo(
    () => tasksForView(tasks, view, new Date(), showCompleted),
    [tasks, view, showCompleted]
  )

  // Completion toggle only matters in the action views (not Completed/Logbook).
  const inlineCompletable = ['today', 'upcoming', 'inbox', 'project'].includes(view.kind)
  const completedHere = useMemo(
    () => tasksForView(tasks, view, new Date(), true).filter((t) => t.completed).length,
    [tasks, view]
  )

  const activeProject = view.kind === 'project' ? projectById.get(view.id) : undefined
  const title = viewTitle(view, activeProject?.name)
  const openCount = visible.filter((t) => !t.completed).length

  // In the merged Today view, future-dated tasks render faded under a "horizon"
  // divider; flag the first one so we can draw the divider before it.
  const isFutureRow = (t: (typeof visible)[number]): boolean =>
    view.kind === 'today' && !t.completed && (daysFromToday(t.due?.date) ?? -1) > 0
  const firstFutureId = useMemo(() => visible.find(isFutureRow)?.id, [visible, view.kind])

  return (
    <main className="relative flex h-full flex-1 flex-col bg-bg">
      <header className="drag-region flex items-center gap-3 px-9 pb-3 pt-5">
        <span className="font-term text-2xl leading-none text-phosphor">{'>'}</span>
        {activeProject && (
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: activeProject.color, boxShadow: `0 0 8px ${activeProject.color}` }}
          />
        )}
        <h1 className="font-term text-3xl uppercase tracking-wide text-phosphor phosphor-glow">
          {title}
        </h1>
        <span className="font-mono text-base text-faint">
          [{String(openCount).padStart(2, '0')}]
        </span>

        <div className="no-drag ml-auto flex items-center gap-2">
          {inlineCompletable && completedHere > 0 && (
            <button
              onClick={toggleShowCompleted}
              title={showCompleted ? 'Hide completed' : 'Show completed'}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint transition-colors hover:text-phosphor"
            >
              {showCompleted ? <Eye size={13} /> : <EyeOff size={13} />}
              {completedHere} done
            </button>
          )}
          <button
            onClick={() => setQuickAddOpen(true)}
            aria-label="Add task"
            className="metal-key is-primary h-8 w-8"
          >
            <Plus size={16} />
          </button>
        </div>
      </header>

      <div className="track-scan flex-1 overflow-y-auto px-6 pb-10">
        {visible.length === 0 ? (
          <div className="mt-24 flex flex-col items-center gap-2 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-faint">
              {'// no entries'}
            </p>
            <button
              onClick={() => setQuickAddOpen(true)}
              className="no-drag font-mono text-xs uppercase tracking-[0.1em] text-phosphor hover:underline"
            >
              + add your first task
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl pt-2">
            <AnimatePresence initial={false}>
              {visible.map((task) => (
                <Fragment key={task.id}>
                  {task.id === firstFutureId && (
                    <div className="my-2 flex items-center gap-2 px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-phosphor/60">
                      <span>▾ horizon</span>
                      <span className="h-px flex-1 bg-rule" />
                    </div>
                  )}
                  <TaskRow
                    task={task}
                    projectName={task.projectId ? projectById.get(task.projectId)?.name : undefined}
                    projectColor={
                      task.projectId ? projectById.get(task.projectId)?.color : undefined
                    }
                    hideProject={view.kind === 'project'}
                    faded={isFutureRow(task)}
                  />
                </Fragment>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </main>
  )
}
