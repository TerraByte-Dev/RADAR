import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import type { Task } from '@shared/types'
import { TaskRow } from '../components/TaskRow'
import {
  buildMonthGrid,
  dayKey,
  monthLabel,
  WEEKDAY_LABELS,
  type CalendarDay
} from '../lib/date'
import { parseQuickAdd } from '../lib/nlp'
import { PRIORITY_DOT } from '../lib/palette'
import { tasksByDayKey, tasksOnDay } from '../lib/selectors'
import { useStore } from '../store/useStore'

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'short',
  day: 'numeric'
})

const TASK_DRAG_MIME = 'application/x-todoplus-task'

export function CalendarView(): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const month = useStore((s) => s.calendarMonth)
  const selectedDay = useStore((s) => s.calendarSelectedDay)
  const {
    calendarPrevMonth,
    calendarNextMonth,
    calendarGoToday,
    setCalendarSelectedDay,
    setDue,
    addTaskFromParsed
  } = useStore.getState()

  const [dragOver, setDragOver] = useState<string | null>(null)
  const [composer, setComposer] = useState('')

  // Land on today the first time the calendar opens.
  useEffect(() => {
    if (!selectedDay) setCalendarSelectedDay(dayKey(new Date()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grid = useMemo(() => buildMonthGrid(month), [month])
  const byDay = useMemo(() => tasksByDayKey(tasks), [tasks])
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const dayTasks = useMemo(
    () => (selectedDay ? tasksOnDay(tasks, selectedDay) : []),
    [tasks, selectedDay]
  )

  /** Move a task to a new day, preserving its time-of-day if it had one. */
  function rescheduleToDay(task: Task, iso: string): void {
    if (task.due?.hasTime) {
      const target = new Date(iso)
      const prev = new Date(task.due.date)
      target.setHours(prev.getHours(), prev.getMinutes(), 0, 0)
      setDue(task.id, { date: target.toISOString(), hasTime: true })
    } else {
      setDue(task.id, { date: iso, hasTime: false })
    }
  }

  function onDrop(e: React.DragEvent, iso: string): void {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData(TASK_DRAG_MIME)
    const task = tasks.find((t) => t.id === id)
    if (task) rescheduleToDay(task, iso)
  }

  function commitComposer(): void {
    const text = composer.trim()
    if (!text || !selectedDay) return
    const parsed = parseQuickAdd(text)
    // This composer always lands on the selected day (that's its promise). If the
    // user typed a time, keep the time-of-day but pin it to the selected date.
    let due = { date: selectedDay, hasTime: false }
    if (parsed.due?.hasTime) {
      const d = new Date(selectedDay)
      const t = new Date(parsed.due.date)
      d.setHours(t.getHours(), t.getMinutes(), 0, 0)
      due = { date: d.toISOString(), hasTime: true }
    }
    addTaskFromParsed({ ...parsed, title: parsed.title || text, due })
    setComposer('')
  }

  return (
    <main className="relative flex h-full flex-1 overflow-hidden bg-bg">
      {/* ── Calendar grid ── */}
      <section className="flex h-full flex-1 flex-col overflow-hidden">
        <header className="drag-region flex items-center gap-3 px-9 pb-3 pt-5">
          <h1 className="font-term text-3xl uppercase tracking-wide text-phosphor phosphor-glow">
            Calendar
          </h1>
          <div className="no-drag ml-auto flex items-center gap-1.5">
            <span className="mr-2 font-mono text-sm uppercase tracking-[0.14em] text-ink">
              {monthLabel(month)}
            </span>
            <button
              onClick={calendarPrevMonth}
              aria-label="Previous month"
              className="metal-key h-7 w-7"
            >
              <ChevronLeft size={14} />
            </button>
            <button onClick={calendarGoToday} className="btn h-7 px-3 text-[11px]">
              Today
            </button>
            <button
              onClick={calendarNextMonth}
              aria-label="Next month"
              className="metal-key h-7 w-7"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden px-6 pb-6">
          <div className="flex h-full flex-col border border-rule bg-panel">
            {/* Weekday header */}
            <div className="grid grid-cols-7 border-b border-rule">
              {WEEKDAY_LABELS.map((w) => (
                <div
                  key={w}
                  className="border-r border-ruleDim px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-faint last:border-r-0"
                >
                  {w}
                </div>
              ))}
            </div>

            {/* 6-week grid */}
            <div className="grid flex-1 grid-cols-7 grid-rows-6">
              {grid.map((cell) => (
                <DayCell
                  key={cell.iso}
                  cell={cell}
                  tasks={byDay.get(cell.iso) ?? []}
                  selected={selectedDay === cell.iso}
                  dragOver={dragOver === cell.iso}
                  onSelect={() => setCalendarSelectedDay(cell.iso)}
                  onDragEnter={() => setDragOver(cell.iso)}
                  onDragLeave={() => setDragOver((d) => (d === cell.iso ? null : d))}
                  onDrop={(e) => onDrop(e, cell.iso)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Day detail panel ── */}
      {selectedDay && (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-rule bg-panel">
          <header className="flex items-center gap-2 border-b border-rule px-4 py-3">
            <span className="led-dot shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-term text-lg uppercase tracking-wide text-phosphor">
                {DAY_FMT.format(new Date(selectedDay))}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                {dayTasks.length} {dayTasks.length === 1 ? 'task' : 'tasks'}
              </div>
            </div>
            <button
              onClick={() => setCalendarSelectedDay(null)}
              aria-label="Close day"
              className="metal-key h-6 w-6"
            >
              <X size={12} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            {dayTasks.length === 0 ? (
              <p className="mt-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-faint">
                Nothing scheduled.
              </p>
            ) : (
              dayTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  projectName={task.projectId ? projectById.get(task.projectId)?.name : undefined}
                  projectColor={
                    task.projectId ? projectById.get(task.projectId)?.color : undefined
                  }
                />
              ))
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-rule px-3 py-2.5">
            <Plus size={14} className="shrink-0 text-phosphor" />
            <input
              value={composer}
              placeholder="ADD TO THIS DAY…"
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitComposer()
              }}
              className="flex-1 bg-transparent font-mono text-[12px] uppercase tracking-[0.06em] text-ink outline-none placeholder:text-faint"
            />
          </div>
        </aside>
      )}
    </main>
  )
}

function DayCell({
  cell,
  tasks,
  selected,
  dragOver,
  onSelect,
  onDragEnter,
  onDragLeave,
  onDrop
}: {
  cell: CalendarDay
  tasks: Task[]
  selected: boolean
  dragOver: boolean
  onSelect: () => void
  onDragEnter: () => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}): JSX.Element {
  const MAX = 3
  const shown = tasks.slice(0, MAX)
  const overflow = tasks.length - shown.length

  return (
    <button
      onClick={onSelect}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group flex flex-col items-stretch gap-1 overflow-hidden border-b border-r border-ruleDim p-1.5 text-left transition-colors last:border-r-0 ${
        cell.inMonth ? '' : 'opacity-35'
      } ${dragOver ? 'bg-phosphor/15' : selected ? 'bg-phosphor/[0.06]' : 'hover:bg-phosphor/[0.04]'} ${
        selected ? 'ring-1 ring-inset ring-phosphor' : ''
      }`}
    >
      <span
        className={`mb-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center self-start font-term text-[15px] leading-none ${
          cell.isToday
            ? 'rounded-sm bg-phosphor text-black shadow-glow'
            : cell.isWeekend
              ? 'text-faint'
              : 'text-ink'
        }`}
      >
        {cell.day}
      </span>

      <span className="flex min-h-0 flex-col gap-[3px] overflow-hidden">
        {shown.map((t) => (
          <span
            key={t.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TASK_DRAG_MIME, t.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onClick={(e) => e.stopPropagation()}
            title={t.title}
            className={`flex items-center gap-1 rounded-sm border border-ruleDim bg-black/40 px-1 py-[1px] font-mono text-[10px] leading-tight ${
              t.completed ? 'text-faint line-through' : 'text-ink'
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`} />
            <span className="truncate">{t.title}</span>
          </span>
        ))}
        {overflow > 0 && (
          <span className="px-1 font-mono text-[10px] text-phosphor">+{overflow} more</span>
        )}
      </span>
    </button>
  )
}
