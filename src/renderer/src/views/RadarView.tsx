import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ProjectRecord } from '@shared/radar'
import { ProjectDetail } from '../components/ProjectDetail'
import {
  angleFromPoint,
  daysFromFrac,
  dragPreviewLabel,
  layoutBlipAngles,
  radiusFracForDays,
  R_SOMEDAY,
  sectorBase,
  TIME_RINGS
} from '../lib/radar'
import {
  categoryColor,
  deadlineForFrac,
  isOverdueProject,
  prioSize,
  projectLayoutFrac,
  projectRadiusFrac,
  projectRelativeDeadline,
  taskRatio
} from '../lib/projectRadar'
import { projectsOnRadar } from '../lib/selectors'
import { useStore } from '../store/useStore'

const ACCENT = '#00FF88'
const SIGNAL_LOST = '#FF3030'
const PING_MS = 950
const MIN_PIN_PX = 8
const NO_CATEGORY = '·'

function hexA(hex: string, a: number): string {
  if (!hex.startsWith('#') || hex.length < 7) return hex
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export function RadarView(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const selectedBlip = useStore((s) => s.selectedBlip)
  const { setSelectedBlip, setFields, resetRadarLayout } = useStore.getState()

  const [hudId, setHudId] = useState<string | null>(null)

  const contacts = useMemo(() => projectsOnRadar(projects), [projects])

  // Stable angular sector per category.
  const sectorByKey = useMemo(() => {
    const cats = [...new Set(contacts.map((p) => p.category || NO_CATEGORY))].sort()
    const map = new Map<string, number>()
    cats.forEach((c, i) => map.set(c, sectorBase(i, cats.length)))
    return map
  }, [contacts])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({ contacts, sectorByKey, selectedBlip, hoveredId: null as string | null })
  stateRef.current = { contacts, sectorByKey, selectedBlip, hoveredId: stateRef.current.hoveredId }

  const posRef = useRef<Map<string, { x: number; y: number; r: number }>>(new Map())
  const layoutCacheRef = useRef<{ sig: string; map: Map<string, number> }>({ sig: '', map: new Map() })
  const geomRef = useRef({ cx: 0, cy: 0, R: 0 })
  const mouseRef = useRef({ x: 0, y: 0, inside: false })
  const dragRef = useRef<{ id: string; moved: boolean; startX: number; startY: number } | null>(null)

  const selected = selectedBlip ? projects.find((p) => p.blipPath === selectedBlip) : undefined

  useEffect(() => {
    const onUp = (): void => {
      dragRef.current = null
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      if (!s.quickAddOpen && !s.paletteOpen && s.selectedBlip) {
        e.stopPropagation()
        s.setSelectedBlip(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Drop a stale hover/selection if its project leaves the radar.
  useEffect(() => {
    const ids = new Set(contacts.map((p) => p.blipPath))
    if (selectedBlip && !ids.has(selectedBlip)) setSelectedBlip(null)
    if (stateRef.current.hoveredId && !ids.has(stateRef.current.hoveredId)) setHovered(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, selectedBlip])

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
    const passed = (t: number, pr: number, c: number): boolean => {
      t = m360(t)
      pr = m360(pr)
      c = m360(c)
      return pr <= c ? t > pr && t <= c : t > pr || t <= c
    }

    function frame(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!reduce) sweep += (360 / 7) * dt
      const ref = new Date()
      const { contacts, sectorByKey, selectedBlip, hoveredId } = stateRef.current

      ctx!.clearRect(0, 0, W, H)
      if (R < 1) {
        prevSweep = sweep
        raf = requestAnimationFrame(frame)
        return
      }

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

      for (let i = 1; i <= 6; i++) {
        ctx!.beginPath()
        ctx!.arc(cx, cy, (R * i) / 6, 0, 7)
        ctx!.strokeStyle = 'rgba(0,255,136,.05)'
        ctx!.lineWidth = 1
        ctx!.stroke()
      }
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
      ctx!.strokeStyle = 'rgba(0,255,136,.08)'
      ctx!.lineWidth = 1
      for (let a = 0; a < 360; a += 30) {
        const [x, y] = pt(R, a)
        ctx!.beginPath()
        ctx!.moveTo(cx, cy)
        ctx!.lineTo(x, y)
        ctx!.stroke()
      }

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

      const drag = dragRef.current
      const anyDragging = !!drag && drag.moved && mouseRef.current.inside
      const wedgeSpacing = 360 / Math.max(sectorByKey.size, 1)
      const baseOf = (p: ProjectRecord): number => sectorByKey.get(p.category || NO_CATEGORY) ?? 0
      let angleById: Map<string, number>
      if (anyDragging && drag) {
        const mdx = mouseRef.current.x - cx
        const mdy = mouseRef.current.y - cy
        const liveAngle = angleFromPoint(mdx, mdy)
        const liveFrac = Math.hypot(mdx, mdy) / R
        angleById = layoutBlipAngles(
          contacts.map((p) =>
            p.blipPath === drag.id
              ? { id: p.blipPath, frac: liveFrac, base: baseOf(p), size: prioSize(p.priority), override: liveAngle }
              : {
                  id: p.blipPath,
                  frac: projectLayoutFrac(p, ref),
                  base: baseOf(p),
                  size: prioSize(p.priority),
                  override: p.radar_angle ?? null
                }
          ),
          { R, wedgeSpacing }
        )
      } else {
        const sig =
          `${R.toFixed(1)}|${wedgeSpacing.toFixed(2)}|` +
          contacts
            .map((p) => `${p.blipPath},${p.category},${p.radar_angle ?? '-'},${p.deadline ?? p.horizon},${p.priority}`)
            .join(';')
        if (layoutCacheRef.current.sig !== sig) {
          layoutCacheRef.current = {
            sig,
            map: layoutBlipAngles(
              contacts.map((p) => ({
                id: p.blipPath,
                frac: projectLayoutFrac(p, ref),
                base: baseOf(p),
                size: prioSize(p.priority),
                override: p.radar_angle ?? null
              })),
              { R, wedgeSpacing }
            )
          }
        }
        angleById = layoutCacheRef.current.map
      }

      const positions = new Map<string, { x: number; y: number; r: number }>()
      for (const proj of contacts) {
        const angle = angleById.get(proj.blipPath) ?? 0
        const dragging = !!drag && drag.id === proj.blipPath && drag.moved && mouseRef.current.inside
        let x: number
        let y: number
        if (dragging) {
          x = mouseRef.current.x
          y = mouseRef.current.y
        } else {
          ;[x, y] = pt(projectRadiusFrac(proj, ref) * R, angle)
        }
        const color = proj.error
          ? SIGNAL_LOST
          : isOverdueProject(proj, ref)
            ? '#FF3030'
            : categoryColor(proj.category)
        const baseSize = prioSize(proj.priority)
        let size = baseSize
        if (!reduce && proj.priority === 1) size += Math.sin(now / 380) * 0.7
        positions.set(proj.blipPath, { x, y, r: baseSize })

        if (proj.status === 'shipped') ctx!.globalAlpha = 0.4

        if (!reduce && passed(angle, prevSweep, sweep)) pings.set(proj.blipPath, now)
        const pingAge = now - (pings.get(proj.blipPath) ?? -1e9)
        if (pingAge < PING_MS) {
          const t = pingAge / PING_MS
          ctx!.beginPath()
          ctx!.arc(x, y, size + t * 16, 0, 7)
          ctx!.strokeStyle = hexA(color, (1 - t) * 0.6)
          ctx!.lineWidth = 1.5
          ctx!.stroke()
        }

        const ratio = taskRatio(proj)
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
        ctx!.shadowBlur = proj.status === 'blocked' && !reduce ? 6 + Math.sin(now / 200) * 6 : 9
        ctx!.fill()
        ctx!.shadowBlur = 0

        // signal-lost: a dashed warning ring
        if (proj.error) {
          ctx!.setLineDash([2, 3])
          ctx!.beginPath()
          ctx!.arc(x, y, size + 4, 0, 7)
          ctx!.strokeStyle = hexA(SIGNAL_LOST, 0.8)
          ctx!.lineWidth = 1.2
          ctx!.stroke()
          ctx!.setLineDash([])
        }
        ctx!.globalAlpha = 1

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

        if (proj.blipPath === hoveredId || proj.blipPath === selectedBlip) {
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
          ctx!.strokeStyle = proj.blipPath === selectedBlip ? ACCENT : '#fff'
          ctx!.lineWidth = 1.4
          ctx!.stroke()
        }
      }
      posRef.current = positions

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
        ctx!.fillText('NO CONTACTS — ADOPT A FOLDER OR ADD A WORKSPACE ROOT', cx, cy + R * 0.5)
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

  const hud = hudId ? contacts.find((p) => p.blipPath === hudId) : undefined
  const hasPinned = projects.some((p) => p.radar_angle != null)

  return (
    <main className="relative flex h-full flex-1 overflow-hidden bg-bg">
      <section className="relative flex h-full flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-9 pt-5">
          <div>
            <h1 className="font-term text-3xl uppercase tracking-wide text-phosphor phosphor-glow">
              Radar
            </h1>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              <span className="led-dot" /> {contacts.length} projects · distance = deadline · drag to
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
            if (e.button !== 0) return
            const { x, y } = toCanvas(e)
            const id = hitTest(x, y)
            if (id) dragRef.current = { id, moved: false, startX: x, startY: y }
          }}
          onMouseMove={(e) => {
            const { x, y } = toCanvas(e)
            mouseRef.current = { x, y, inside: true }
            const drag = dragRef.current
            if (drag) {
              if (Math.hypot(x - drag.startX, y - drag.startY) > 4) drag.moved = true
            } else if (!selectedBlip) {
              setHovered(hitTest(x, y))
            }
          }}
          onMouseUp={(e) => {
            if (e.button !== 0) return
            const drag = dragRef.current
            dragRef.current = null
            if (!drag) {
              setSelectedBlip(null)
              return
            }
            if (!drag.moved) {
              setHovered(null)
              setSelectedBlip(drag.id)
              return
            }
            const proj = projects.find((p) => p.blipPath === drag.id)
            if (!proj) return
            const { x, y } = toCanvas(e)
            const { cx, cy, R } = geomRef.current
            if (R <= 0) return
            const dx = x - cx
            const dy = y - cy
            const r = Math.hypot(dx, dy)
            const frac = r / R
            const patch: { radar_angle: number | null; deadline?: string | null } = {
              radar_angle: r > MIN_PIN_PX ? angleFromPoint(dx, dy) : null
            }
            // Reschedule only when the drop changes day-bucket (a pure angular nudge keeps the date).
            if (daysFromFrac(frac) !== daysFromFrac(projectRadiusFrac(proj, new Date()))) {
              patch.deadline = deadlineForFrac(frac)
            }
            setFields(drag.id, patch)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            const { x, y } = toCanvas(e)
            const id = hitTest(x, y)
            const proj = id ? projects.find((p) => p.blipPath === id) : undefined
            if (proj?.radar_angle != null) setFields(proj.blipPath, { radar_angle: null })
          }}
          onMouseLeave={() => {
            mouseRef.current.inside = false
            if (!dragRef.current) setHovered(null)
          }}
        />

        {hud && !selected && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 border border-rule bg-black/80 px-3 py-1.5 text-center">
            <div className="font-mono text-[13px] text-ink">{hud.name ?? 'Project'}</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              {hud.error ? 'SIGNAL LOST' : `P${hud.priority} · ${projectRelativeDeadline(hud)}`}
              {hud.category && ` · ${hud.category}`}
            </div>
          </div>
        )}
      </section>

      {selected && (
        <aside className="flex h-full w-[22rem] shrink-0 flex-col border-l border-rule bg-panel">
          <ProjectDetail project={selected} onClose={() => setSelectedBlip(null)} />
        </aside>
      )}
    </main>
  )
}
