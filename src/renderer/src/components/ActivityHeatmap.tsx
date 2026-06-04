import { useMemo } from 'react'
import { activityCounts } from '../lib/selectors'
import { useStore } from '../store/useStore'

const WEEKS = 18
const ACCENT = '#00FF88'

/** GitHub-style momentum grid: one cell per day, shaded by session-log entries that day. */
function shade(count: number): string {
  if (count <= 0) return 'rgba(0,255,136,.06)'
  if (count === 1) return 'rgba(0,255,136,.28)'
  if (count === 2) return 'rgba(0,255,136,.5)'
  if (count <= 4) return 'rgba(0,255,136,.75)'
  return ACCENT
}

function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function ActivityHeatmap(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const counts = useMemo(() => activityCounts(projects), [projects])

  // Build columns of weeks (Sun→Sat), ending today, oldest → newest.
  const { weeks, total } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = new Date(today)
    end.setDate(end.getDate() + (6 - end.getDay())) // pad to Saturday so the last column is full
    const start = new Date(end)
    start.setDate(start.getDate() - (WEEKS * 7 - 1))

    const cols: { date: string; count: number; future: boolean }[][] = []
    let col: { date: string; count: number; future: boolean }[] = []
    let sum = 0
    const cursor = new Date(start)
    for (let i = 0; i < WEEKS * 7; i++) {
      const key = ymd(cursor)
      const count = counts.get(key) ?? 0
      sum += count
      col.push({ date: key, count, future: cursor.getTime() > today.getTime() })
      if (cursor.getDay() === 6) {
        cols.push(col)
        col = []
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    if (col.length) cols.push(col)
    return { weeks: cols, total: sum }
  }, [counts])

  return (
    <div className="mx-auto max-w-2xl px-1">
      <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-phosphor/70">
        <span>Momentum · {total} sessions</span>
        <span className="flex items-center gap-1 text-faint">
          less
          {[0, 1, 2, 3, 5].map((c) => (
            <span key={c} className="inline-block h-2 w-2" style={{ background: shade(c) }} />
          ))}
          more
        </span>
      </div>
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {col.map((cell) => (
              <span
                key={cell.date}
                title={`${cell.date}: ${cell.count} session${cell.count === 1 ? '' : 's'}`}
                className="h-2.5 w-2.5 rounded-[1px]"
                style={{ background: cell.future ? 'transparent' : shade(cell.count) }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
