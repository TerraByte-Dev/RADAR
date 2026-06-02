import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, RotateCcw, Star, Trash2, X } from 'lucide-react'
import type { Task } from '@shared/types'
import { TaskDetail } from '../components/TaskDetail'
import { isOverdue } from '../lib/date'
import {
  angleFromPoint,
  blipRadiusFrac,
  daysFromFrac,
  dragPreviewLabel,
  layoutBlipAngles,
  PRIO_SIZE,
  radiusFracForDays,
  relativeDue,
  R_SOMEDAY,
  sectorBase,
  subtaskRatio,
  TIME_RINGS
} from '../lib/radar'
import { tasksOnRadar } from '../lib/selectors'
import { useStore } from '../store/useStore'

const ACCENT = '#00FF88'
const PING_MS = 950

function hexA(hex: string, a: number): string {
  if (!hex.startsWith('#') || hex.length < 7) return hex
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Drop a dragged blip onto the timeline → an exact due date (preserving time-of-day). */
function dueForFrac(frac: number, task: Task): Task['due'] {
  const days = daysFromFrac(frac)
  if (days === null) return undefined
  const target = new Date()
  target.setHours(0, 0, 0, 0)
  target.setDate(target.getDate() + days)
  if (task.due?.hasTime) {
    const prev = new Date(task.due.date)
    target.setHours(prev.getHours(), prev.getMinutes(), 0, 0)
    return { date: target.toISOString(), hasTime: true }
  }
  return { date: target.toISOString(), hasTime: false }
}

export function RadarView(): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const selectedId = useStore((s) => s.radarSelectedId)
  const { setRadarSelected, patchTask, resetRadarLayout } = useStore.getState()

  const [hudId, setHudId] = useState<string | null>(null)

  const contacts = useMemo(() => tasksOnRadar(tasks), [tasks])
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  // Stable angular sector per project (+ an "inbox" slot for no-project tasks).
  const sectorByKey = useMemo(() => {
    const ordered = [...projects].sort((a, b) => a.order - b.order)
    const count = ordered.length + 1
    const map = new Map<string, number>()
    ordered.forEach((p, i) => map.set(p.id, sectorBase(i, count)))
    map.set('inbox', sectorBase(ordered.length, count))
    return map
  }, [projects])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({ contacts, projectById, sectorByKey, selectedId, hoveredId: null as string | null })
  stateRef.current = { contacts, projectById, sectorByKey, selectedId, hoveredId: stateRef.current.hoveredId }

  const posRef = useRef<Map<string, { x: number; y: number; r: number }>>(new Map())
  const geomRef = useRef({ cx: 0, cy: 0, R: 0 })
  const mouseRef = useRef({ x: 0, y: 0, inside: false })
  const dragRef = useRef<{ id: string; moved: boolean; startX: number; startY: number } | null>(null)

  const selected = selectedId ? tasks.find((t) => t.id === selectedId) : undefined

  // Releasing the button anywhere ends a drag — prevents a stuck-drag when the
  // cursor is released off-canvas (canvas onMouseUp handles in-canvas releases first).
  useEffect(() => {
    const onUp = (): void => {
      dragRef.current = null
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // Esc closes the selected-contact panel (keyboard-first dismissal), unless a dialog owns Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      if (!s.quickAddOpen && !s.paletteOpen && s.radarSelectedId) {
        e.stopPropagation()
        s.setRadarSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Drop a stale hover/selection if its task leaves the radar (snoozed/completed/deleted elsewhere).
  useEffect(() => {
    const ids = new Set(contacts.map((t) => t.id))
    if (selectedId && !ids.has(selectedId)) setRadarSelected(null)
    if (stateRef.current.hoveredId && !ids.has(stateRef.current.hoveredId)) setHovered(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, selectedId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let W = 0
    let H = 0
    let cx = 0
    let cy = 0
    let R = 0
    let dpr = 1
    let sweep = -45
    let prevSweep = -45
    let last = performance.now()
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const pings = new Map<string, number>()

    function resize(): void {
      const rect = canvas!.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      W = rect.width
      H = rect.height
      canvas!.width = Math.round(W * dpr)
      canvas!.height = Math.round(H * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      cx = W / 2
      cy = H / 2
      R = Math.max(0, Math.min(W, H) / 2 - 30)
      geomRef.current = { cx, cy, R }
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const pt = (r: number, b: number): [number, number] => {
      const a = (b * Math.PI) / 180
      return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
    }
    const m360 = (n: number): number => ((n % 360) + 360) % 360
    const passed = (t: number, p: number, c: number): boolean => {
      t = m360(t)
      p = m360(p)
      c = m360(c)
      return p <= c ? t > p && t <= c : t > p || t <= c
    }

    function frame(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!reduce) sweep += (360 / 7) * dt
      const ref = new Date() // recomputed each frame so distance tracks the real clock/day
      const { contacts, projectById, sectorByKey, selectedId, hoveredId } = stateRef.current

      ctx!.clearRect(0, 0, W, H)
      if (R < 1) {
        prevSweep = sweep
        raf = requestAnimationFrame(frame)
        return
      }

      // center glow
      const glow = ctx!.createRadialGradient(cx, cy, 0, cx, cy, R)
      glow.addColorStop(0, 'rgba(0,255,136,.10)')
      glow.addColorStop(0.6, 'rgba(0,255,136,.025)')
      glow.addColorStop(1, 'rgba(0,255,136,0)')
      ctx!.fillStyle = glow
      ctx!.beginPath()
      ctx!.arc(cx, cy, R, 0, 7)
      ctx!.fill()

      ctx!.save()
      ctx!.beginPath()
      ctx!.arc(cx, cy, R, 0, 7)
      ctx!.clip()

      // faint range rings (texture)
      for (let i = 1; i <= 6; i++) {
        ctx!.beginPath()
        ctx!.arc(cx, cy, (R * i) / 6, 0, 7)
        ctx!.strokeStyle = 'rgba(0,255,136,.05)'
        ctx!.lineWidth = 1
        ctx!.stroke()
      }
      // labeled time rings (the readable scale)
      for (const ring of TIME_RINGS) {
        const frac = ring.days === null ? R_SOMEDAY : radiusFracForDays(ring.days)
        ctx!.beginPath()
        ctx!.arc(cx, cy, R * frac, 0, 7)
        ctx!.strokeStyle = hexA(ring.color, ring.days === null ? 0.22 : 0.26)
        ctx!.lineWidth = 1.2
        if (ring.days === null) ctx!.setLineDash([4, 4])
        ctx!.stroke()
        ctx!.setLineDash([])
      }
      // spokes
      ctx!.strokeStyle = 'rgba(0,255,136,.08)'
      ctx!.lineWidth = 1
      for (let a = 0; a < 360; a += 30) {
        const [x, y] = pt(R, a)
        ctx!.beginPath()
        ctx!.moveTo(cx, cy)
        ctx!.lineTo(x, y)
        ctx!.stroke()
      }

      // sweep trail
      if (!reduce) {
        const N = 48
        const step = 2.6
        for (let i = 0; i < N; i++) {
          const [x1, y1] = pt(R, sweep - i * step)
          const [x2, y2] = pt(R, sweep - (i + 1) * step)
          ctx!.beginPath()
          ctx!.moveTo(cx, cy)
          ctx!.lineTo(x1, y1)
          ctx!.lineTo(x2, y2)
          ctx!.closePath()
          ctx!.fillStyle = `rgba(0,255,136,${0.16 * (1 - i / N)})`
          ctx!.fill()
        }
      }
      const [lx, ly] = pt(R, sweep)
      ctx!.beginPath()
      ctx!.moveTo(cx, cy)
      ctx!.lineTo(lx, ly)
      ctx!.strokeStyle = ACCENT
      ctx!.lineWidth = 1.6
      ctx!.shadowColor = hexA(ACCENT, 0.55)
      ctx!.shadowBlur = 12
      ctx!.stroke()
      ctx!.shadowBlur = 0
      ctx!.restore()

      // rim + ticks
      ctx!.beginPath()
      ctx!.arc(cx, cy, R, 0, 7)
      ctx!.strokeStyle = 'rgba(0,255,136,.45)'
      ctx!.lineWidth = 1.4
      ctx!.stroke()
      for (let a = 0; a < 360; a += 15) {
        const [x1, y1] = pt(R, a)
        const [x2, y2] = pt(R - (a % 90 === 0 ? 8 : 4), a)
        ctx!.beginPath()
        ctx!.moveTo(x1, y1)
        ctx!.lineTo(x2, y2)
        ctx!.strokeStyle = 'rgba(0,255,136,.3)'
        ctx!.lineWidth = 1
        ctx!.stroke()
      }

      // time-ring labels (along the top spoke)
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'middle'
      ctx!.font = '9px "IBM Plex Mono", ui-monospace, monospace'
      for (const ring of TIME_RINGS) {
        const frac = ring.days === null ? R_SOMEDAY : radiusFracForDays(ring.days)
        const [x, y] = pt(R * frac, 0)
        const w = ctx!.measureText(ring.label).width + 8
        ctx!.fillStyle = 'rgba(0,0,0,.85)'
        ctx!.fillRect(x - w / 2, y - 7, w, 13)
        ctx!.fillStyle = ring.color
        ctx!.fillText(ring.label, x, y)
      }

      // blips — resolve every angle first: manual overrides + crowd-aware fanning
      // so same-project/same-deadline tasks don't stack on one spoke.
      const wedgeSpacing = 360 / Math.max(sectorByKey.size, 1)
      const angleById = layoutBlipAngles(
        contacts.map((t) => ({
          id: t.id,
          frac: blipRadiusFrac(t, ref),
          base: sectorByKey.get(t.projectId ?? 'inbox') ?? 0,
          size: PRIO_SIZE[t.priority],
          override: t.radarAngle ?? null
        })),
        { R, wedgeSpacing }
      )
      const positions = new Map<string, { x: number; y: number; r: number }>()
      const drag = dragRef.current
      for (const task of contacts) {
        const angle = angleById.get(task.id) ?? 0
        const dragging = !!drag && drag.id === task.id && drag.moved && mouseRef.current.inside
        let x: number
        let y: number
        if (dragging) {
          x = mouseRef.current.x
          y = mouseRef.current.y
        } else {
          ;[x, y] = pt(blipRadiusFrac(task, ref) * R, angle)
        }
        const overdue = isOverdue(task.due, ref)
        const color = overdue ? '#FF3030' : projectById.get(task.projectId ?? '')?.color ?? ACCENT
        const baseSize = PRIO_SIZE[task.priority]
        let size = baseSize
        if (!reduce && task.priority === 'P1') size += Math.sin(now / 380) * 0.7
        // Hit-test against the stable base size (not the pulsing drawn size).
        positions.set(task.id, { x, y, r: baseSize })

        if (!reduce && passed(angle, prevSweep, sweep)) pings.set(task.id, now)
        const pingAge = now - (pings.get(task.id) ?? -1e9)
        if (pingAge < PING_MS) {
          const t = pingAge / PING_MS
          ctx!.beginPath()
          ctx!.arc(x, y, size + t * 16, 0, 7)
          ctx!.strokeStyle = hexA(color, (1 - t) * 0.6)
          ctx!.lineWidth = 1.5
          ctx!.stroke()
        }

        const ratio = subtaskRatio(task)
        if (ratio > 0) {
          ctx!.beginPath()
          ctx!.arc(x, y, size + 3, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2)
          ctx!.strokeStyle = hexA(ACCENT, 0.85)
          ctx!.lineWidth = 1.6
          ctx!.stroke()
        }

        ctx!.beginPath()
        ctx!.arc(x, y, size, 0, 7)
        ctx!.fillStyle = color
        ctx!.shadowColor = color
        ctx!.shadowBlur = task.starred && !reduce ? 8 + Math.sin(now / 240) * 5 : 9
        ctx!.fill()
        ctx!.shadowBlur = 0

        // live drag preview — where on the timeline this blip will land
        if (dragging) {
          const frac = Math.hypot(x - cx, y - cy) / R
          const label = dragPreviewLabel(frac)
          ctx!.font = '10px "IBM Plex Mono", ui-monospace, monospace'
          const w = ctx!.measureText(label).width + 10
          ctx!.fillStyle = 'rgba(0,0,0,.85)'
          ctx!.fillRect(x - w / 2, y - size - 20, w, 14)
          ctx!.strokeStyle = hexA(ACCENT, 0.6)
          ctx!.strokeRect(x - w / 2, y - size - 20, w, 14)
          ctx!.fillStyle = ACCENT
          ctx!.textAlign = 'center'
          ctx!.textBaseline = 'middle'
          ctx!.fillText(label, x, y - size - 13)
        }

        if (task.id === hoveredId || task.id === selectedId) {
          ctx!.setLineDash([3, 3])
          ctx!.beginPath()
          ctx!.moveTo(cx, cy)
          ctx!.lineTo(x, y)
          ctx!.strokeStyle = 'rgba(155,245,184,.35)'
          ctx!.lineWidth = 1
          ctx!.stroke()
          ctx!.setLineDash([])
          ctx!.beginPath()
          ctx!.arc(x, y, size + 6, 0, 7)
          ctx!.strokeStyle = task.id === selectedId ? ACCENT : '#fff'
          ctx!.lineWidth = 1.4
          ctx!.stroke()
        }
      }
      posRef.current = positions

      // center marker
      if (!reduce) {
        const pr = 9 + Math.sin(now / 600) * 3
        ctx!.beginPath()
        ctx!.arc(cx, cy, pr, 0, 7)
        ctx!.strokeStyle = 'rgba(0,255,136,.25)'
        ctx!.lineWidth = 1
        ctx!.stroke()
      }
      ctx!.beginPath()
      ctx!.arc(cx, cy, 3.2, 0, 7)
      ctx!.fillStyle = ACCENT
      ctx!.shadowColor = ACCENT
      ctx!.shadowBlur = 10
      ctx!.fill()
      ctx!.shadowBlur = 0

      if (!contacts.length) {
        ctx!.fillStyle = 'rgba(155,245,184,.45)'
        ctx!.textAlign = 'center'
        ctx!.font = '11px "IBM Plex Mono", ui-monospace, monospace'
        ctx!.fillText('NO CONTACTS ON RADAR', cx, cy + R * 0.5)
      }

      prevSweep = sweep
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  function hitTest(mx: number, my: number): string | null {
    let best: string | null = null
    let bestD = Infinity
    for (const [id, p] of posRef.current) {
      const d = Math.hypot(mx - p.x, my - p.y)
      if (d < p.r + 8 && d < bestD) {
        bestD = d
        best = id
      }
    }
    return best
  }

  function toCanvas(e: React.MouseEvent): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function setHovered(id: string | null): void {
    if (stateRef.current.hoveredId === id) return
    stateRef.current.hoveredId = id
    setHudId(id)
  }

  const hud = hudId ? contacts.find((t) => t.id === hudId) : undefined
  const hasPinned = contacts.some((t) => t.radarAngle != null)

  return (
    <main className="relative flex h-full flex-1 overflow-hidden bg-bg">
      <section className="relative flex h-full flex-1 flex-col overflow-hidden">
        {/* Header overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-9 pt-5">
          <div>
            <h1 className="font-term text-3xl uppercase tracking-wide text-phosphor phosphor-glow">
              Radar
            </h1>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              <span className="led-dot" /> {contacts.length} contacts · distance = deadline · drag to
              place · right-click resets
            </div>
            {hasPinned && (
              <button
                onClick={() => resetRadarLayout()}
                className="no-drag pointer-events-auto mt-1.5 inline-flex items-center gap-1 border border-rule px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint transition-colors hover:border-phosphor hover:text-phosphor"
              >
                <RotateCcw size={10} /> reset layout
              </button>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 font-mono text-[10px] uppercase tracking-[0.12em]">
            {TIME_RINGS.map((ring) => (
              <span key={ring.label} className="flex items-center gap-1.5" style={{ color: ring.color }}>
                {ring.label}
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: ring.color, boxShadow: `0 0 6px ${ring.color}` }}
                />
              </span>
            ))}
          </div>
        </div>

        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ cursor: hudId ? 'pointer' : 'crosshair' }}
          onMouseDown={(e) => {
            const { x, y } = toCanvas(e)
            const id = hitTest(x, y)
            if (id) dragRef.current = { id, moved: false, startX: x, startY: y }
          }}
          onMouseMove={(e) => {
            const { x, y } = toCanvas(e)
            mouseRef.current = { x, y, inside: true }
            const drag = dragRef.current
            if (drag) {
              // Only treat it as a drag past a small threshold, so click-jitter
              // doesn't accidentally reschedule the task.
              if (Math.hypot(x - drag.startX, y - drag.startY) > 4) drag.moved = true
            } else if (!selectedId) {
              // Skip hover while a contact is selected — only the selected blip is emphasized.
              setHovered(hitTest(x, y))
            }
          }}
          onMouseUp={(e) => {
            const drag = dragRef.current
            dragRef.current = null
            if (!drag) {
              setRadarSelected(null)
              return
            }
            if (!drag.moved) {
              setHovered(null)
              setRadarSelected(drag.id)
              return
            }
            const task = tasks.find((t) => t.id === drag.id)
            if (!task) return
            const { x, y } = toCanvas(e)
            const { cx, cy, R } = geomRef.current
            if (R <= 0) return
            const dx = x - cx
            const dy = y - cy
            const frac = Math.hypot(dx, dy) / R
            const nextDue = dueForFrac(frac, task)
            // Drop sets both axes: angle (pinned, visual) + due (radius). Only patch
            // the due when the radius actually moved it, so a pure angular nudge
            // doesn't log a phantom "rescheduled" on the activity timeline.
            const patch: Partial<Task> = { radarAngle: angleFromPoint(dx, dy) }
            if ((nextDue?.date ?? null) !== (task.due?.date ?? null)) patch.due = nextDue
            patchTask(drag.id, patch)
          }}
          onContextMenu={(e) => {
            // Right-click a repositioned blip → clear its manual angle (re-join the
            // auto layout). Always suppress the native menu over the canvas.
            e.preventDefault()
            const { x, y } = toCanvas(e)
            const id = hitTest(x, y)
            const task = id ? tasks.find((t) => t.id === id) : undefined
            if (task?.radarAngle != null) patchTask(task.id, { radarAngle: undefined })
          }}
          onMouseLeave={() => {
            mouseRef.current.inside = false
            if (!dragRef.current) setHovered(null)
          }}
        />

        {/* Hover HUD */}
        {hud && !selected && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 border border-rule bg-black/80 px-3 py-1.5 text-center">
            <div className="font-mono text-[13px] text-ink">{hud.title}</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              {hud.priority !== 'none' && `${hud.priority} · `}
              {relativeDue(hud)}
              {hud.projectId && ` · ${projectById.get(hud.projectId)?.name ?? ''}`}
            </div>
          </div>
        )}
      </section>

      {/* Selected contact detail */}
      {selected && (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-rule bg-panel">
          <ContactHeader task={selected} />
          <div className="flex-1 overflow-y-auto px-1 py-2">
            <TaskDetail task={selected} />
          </div>
        </aside>
      )}
    </main>
  )
}

function ContactHeader({ task }: { task: Task }): JSX.Element {
  const { toggleComplete, toggleStar, deleteTask, setRadarSelected, setRadarAngle } =
    useStore.getState()
  return (
    <header className="border-b border-rule px-3 py-3">
      <div className="flex items-start gap-2">
        <button
          onClick={() => toggleComplete(task.id)}
          aria-label="Complete"
          className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border transition-all ${
            task.completed ? 'border-phosphor bg-phosphor text-black' : 'border-faint hover:border-phosphor'
          }`}
        >
          {task.completed && <Check size={12} strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className={`font-mono text-[13px] leading-snug ${task.completed ? 'text-faint line-through' : 'text-ink'}`}>
            {task.title}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
            {relativeDue(task)}
          </div>
          {task.radarAngle != null && (
            <button
              onClick={() => setRadarAngle(task.id, undefined)}
              className="mt-1.5 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-faint transition-colors hover:text-phosphor"
            >
              <RotateCcw size={9} /> pinned · reset position
            </button>
          )}
        </div>
        <button
          onClick={() => toggleStar(task.id)}
          aria-label="Star"
          className={`mt-0.5 shrink-0 ${task.starred ? 'text-term-amber' : 'text-faint hover:text-phosphor'}`}
        >
          <Star size={14} fill={task.starred ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={() => {
            deleteTask(task.id)
            setRadarSelected(null)
          }}
          aria-label="Delete"
          className="mt-0.5 shrink-0 text-faint hover:text-p1"
        >
          <Trash2 size={14} />
        </button>
        <button
          onClick={() => setRadarSelected(null)}
          aria-label="Close"
          className="metal-key ml-1 h-6 w-6"
        >
          <X size={12} />
        </button>
      </div>
    </header>
  )
}
