import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { buildMonthGrid, dayKey, monthLabel, WEEKDAY_LABELS, type CalendarDay } from '../lib/date'
import { calendarItemsByDay, calendarItemsOnDay, type CalendarItem } from '../lib/selectors'
import { categoryColor } from '../lib/projectRadar'
import { setTaskDue } from '../lib/taskDue'
import { useStore } from '../store/useStore'

const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
const BLIP_DRAG_MIME = 'application/x-radar-blip'

/** Local YYYY-MM-DD for a day-grid ISO (which is local midnight). */
function isoToYMD(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A dragged calendar entry — enough to reschedule the right thing on drop. */
interface DragPayload {
  blipPath: string
  kind: CalendarItem['kind']
  taskIndex?: number
}

export function CalendarView(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const month = useStore((s) => s.calendarMonth)
  const selectedDay = useStore((s) => s.calendarSelectedDay)
  const {
    calendarPrevMonth,
    calendarNextMonth,
    calendarGoToday,
    setCalendarSelectedDay,
    setFields,
    taskOp,
    setView,
    setSelectedBlip
  } = useStore.getState()

  const [dragOver, setDragOver] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedDay) setCalendarSelectedDay(dayKey(new Date()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grid = useMemo(() => buildMonthGrid(month), [month])
  const byDay = useMemo(() => calendarItemsByDay(projects), [projects])
  const dayItems = useMemo(
    () => (selectedDay ? calendarItemsOnDay(projects, selectedDay) : []),
    [projects, selectedDay]
  )

  /** Move a dropped milestone (task `(due …)`) or hard deadline to the target day. */
  function reschedule(payload: DragPayload, ymd: string): void {
    if (payload.kind === 'deadline') {
      setFields(payload.blipPath, { deadline: ymd })
      return
    }
    const proj = projects.find((p) => p.blipPath === payload.blipPath)
    const t = payload.taskIndex != null ? proj?.tasks[payload.taskIndex] : undefined
    if (t) taskOp(payload.blipPath, { action: 'edit', ref: payload.taskIndex!, text: setTaskDue(t.text, ymd) })
  }

  function onDrop(e: React.DragEvent, iso: string): void {
    e.preventDefault()
    setDragOver(null)
    const raw = e.dataTransfer.getData(BLIP_DRAG_MIME)
    if (!raw) return
    try {
      reschedule(JSON.parse(raw) as DragPayload, isoToYMD(iso))
    } catch {
      /* malformed payload — ignore */
    }
  }

  function open(blipPath: string): void {
    setView({ kind: 'radar' })
    setSelectedBlip(blipPath)
  }

  return (
    <main className="relative flex h-full flex-1 overflow-hidden bg-bg">
      <section className="flex h-full flex-1 flex-col overflow-hidden">
        <header className="drag-region flex items-center gap-3 px-9 pb-3 pt-5">
          <h1 className="font-term text-3xl uppercase tracking-wide text-phosphor phosphor-glow">
            Calendar
          </h1>
          <div className="no-drag ml-auto flex items-center gap-1.5">
            <span className="mr-2 font-mono text-sm uppercase tracking-[0.14em] text-ink">
              {monthLabel(month)}
            </span>
            <button onClick={calendarPrevMonth} aria-label="Previous month" className="metal-key h-7 w-7">
              <ChevronLeft size={14} />
            </button>
            <button onClick={calendarGoToday} className="btn h-7 px-3 text-[11px]">
              Today
            </button>
            <button onClick={calendarNextMonth} aria-label="Next month" className="metal-key h-7 w-7">
              <ChevronRight size={14} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden px-6 pb-6">
          <div className="flex h-full flex-col border border-rule bg-panel">
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
            <div className="grid flex-1 grid-cols-7 grid-rows-6">
              {grid.map((cell) => (
                <DayCell
                  key={cell.iso}
                  cell={cell}
                  items={byDay.get(cell.iso) ?? []}
                  selected={selectedDay === cell.iso}
                  dragOver={dragOver === cell.iso}
                  onSelect={() => setCalendarSelectedDay(cell.iso)}
                  onOpen={open}
                  onDragEnter={() => setDragOver(cell.iso)}
                  onDragLeave={() => setDragOver((d) => (d === cell.iso ? null : d))}
                  onDrop={(e) => onDrop(e, cell.iso)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {selectedDay && (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-rule bg-panel">
          <header className="flex items-center gap-2 border-b border-rule px-4 py-3">
            <span className="led-dot shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-term text-lg uppercase tracking-wide text-phosphor">
                {DAY_FMT.format(new Date(selectedDay))}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                {dayItems.length} {dayItems.length === 1 ? 'item' : 'items'}
              </div>
            </div>
            <button onClick={() => setCalendarSelectedDay(null)} aria-label="Close day" className="metal-key h-6 w-6">
              <X size={12} />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {dayItems.length === 0 ? (
              <p className="mt-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-faint">
                Nothing due.
              </p>
            ) : (
              dayItems.map((it, i) => (
                <button
                  key={`${it.blipPath}-${it.kind}-${it.taskIndex ?? 'd'}-${i}`}
                  onClick={() => open(it.blipPath)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-[12px] text-muted hover:text-ink"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: categoryColor(it.category) }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {it.label}
                    {it.kind === 'task' && <span className="ml-1.5 text-faint">— {it.projectName}</span>}
                  </span>
                  <span className="shrink-0 text-[9px] uppercase tracking-[0.08em] text-faint">
                    {it.kind === 'deadline' ? 'deadline' : 'task'}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>
      )}
    </main>
  )
}

function DayCell({
  cell,
  items,
  selected,
  dragOver,
  onSelect,
  onOpen,
  onDragEnter,
  onDragLeave,
  onDrop
}: {
  cell: CalendarDay
  items: CalendarItem[]
  selected: boolean
  dragOver: boolean
  onSelect: () => void
  onOpen: (blipPath: string) => void
  onDragEnter: () => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}): JSX.Element {
  const MAX = 3
  const shown = items.slice(0, MAX)
  const overflow = items.length - shown.length

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
          cell.isToday ? 'rounded-sm bg-phosphor text-black shadow-glow' : cell.isWeekend ? 'text-faint' : 'text-ink'
        }`}
      >
        {cell.day}
      </span>
      <span className="flex min-h-0 flex-col gap-[3px] overflow-hidden">
        {shown.map((it, i) => (
          <span
            key={`${it.blipPath}-${it.kind}-${it.taskIndex ?? 'd'}-${i}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                BLIP_DRAG_MIME,
                JSON.stringify({ blipPath: it.blipPath, kind: it.kind, taskIndex: it.taskIndex })
              )
              e.dataTransfer.effectAllowed = 'move'
            }}
            onClick={(e) => {
              e.stopPropagation()
              onOpen(it.blipPath)
            }}
            title={it.kind === 'task' ? `${it.label} — ${it.projectName}` : it.label}
            className={`flex items-center gap-1 rounded-sm border bg-black/40 px-1 py-[1px] font-mono text-[10px] leading-tight text-ink ${
              it.kind === 'deadline' ? 'border-p1/40' : 'border-ruleDim'
            }`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: categoryColor(it.category) }} />
            <span className="truncate">{it.label}</span>
          </span>
        ))}
        {overflow > 0 && <span className="px-1 font-mono text-[10px] text-phosphor">+{overflow} more</span>}
      </span>
    </button>
  )
}
