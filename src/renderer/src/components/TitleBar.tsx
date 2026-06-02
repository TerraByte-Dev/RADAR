import { useEffect, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { isSnoozed } from '../lib/selectors'
import { useStore } from '../store/useStore'

function formatClock(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} · ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`
}

/** Frameless-window title bar — brand logotype, live clock, and window controls. */
export function TitleBar(): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const [clock, setClock] = useState(() => formatClock(new Date()))

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatClock(new Date())), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Actionable open tasks — mirrors the action views (excludes snoozed).
  const open = tasks.filter((t) => !t.completed && !isSnoozed(t)).length

  return (
    <div
      className="drag-region relative z-[2] flex h-7 shrink-0 select-none items-center border-b border-rule bg-black px-3"
    >
      {/* Blinking diamond LED */}
      <span
        className="mr-2 inline-block h-[6px] w-[6px] shrink-0 bg-phosphor"
        style={{ transform: 'rotate(45deg)', boxShadow: '0 0 6px #00FF88', animation: 'term-blink 2s steps(2) infinite' }}
      />
      <span className="phosphor-glow font-term text-[13px] tracking-[1.5px] text-phosphor">
        TODOPLUS//SYS
      </span>
      <span className="mx-2 font-term text-[13px] text-faint">—</span>
      <span className="font-term text-[13px] tracking-[1px] text-term-cyan">{clock}</span>

      <div className="flex-1" />

      <div className="no-drag flex items-center gap-3">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-term-amber sm:inline">
          ● {open} OPEN
        </span>
        <div className="flex items-center gap-[3px]">
          <button
            onClick={() => window.api.minimizeWindow()}
            title="Minimize"
            aria-label="Minimize"
            className="flex h-[18px] w-[18px] items-center justify-center border border-phosphor/25 bg-phosphor/[0.06] text-ink/70 transition-colors hover:bg-phosphor/15 hover:text-phosphor"
          >
            <Minus size={9} />
          </button>
          <button
            onClick={() => window.api.maximizeWindow()}
            title="Maximize"
            aria-label="Maximize"
            className="flex h-[18px] w-[18px] items-center justify-center border border-phosphor/25 bg-phosphor/[0.06] text-ink/70 transition-colors hover:bg-phosphor/15 hover:text-phosphor"
          >
            <Square size={8} />
          </button>
          <button
            onClick={() => window.api.closeWindow()}
            title="Close"
            aria-label="Close"
            className="flex h-[18px] w-[18px] items-center justify-center border border-term-red/25 bg-term-red/[0.06] text-term-red/70 transition-colors hover:border-term-red/60 hover:bg-term-red/20 hover:text-term-red"
          >
            <X size={9} />
          </button>
        </div>
      </div>
    </div>
  )
}
