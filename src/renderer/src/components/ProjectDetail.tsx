import { useState } from 'react'
import { Check, ExternalLink, FolderOpen, RotateCcw, Sparkles, X } from 'lucide-react'
import type { BlipStatus, Horizon, ProjectRecord } from '@shared/radar'
import { BLIP_STATUSES, HORIZONS } from '@shared/radar'
import { parseSessionLog } from '../lib/selectors'
import { categoryColor, projectRelativeDeadline } from '../lib/projectRadar'
import { useStore } from '../store/useStore'

const PRIORITIES = [1, 2, 3, 4, 5]

function Label({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">{children}</div>
  )
}

/** A committed-on-blur text field — avoids an IPC write per keystroke. */
function TextField({
  value,
  placeholder,
  onCommit
}: {
  value: string
  placeholder: string
  onCommit: (v: string) => void
}): JSX.Element {
  const [v, setV] = useState(value)
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="w-full border border-rule bg-lcd px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-phosphor"
    />
  )
}

export function ProjectDetail({
  project,
  onClose
}: {
  project: ProjectRecord
  onClose: () => void
}): JSX.Element {
  const { setFields, taskOp, adoptGhost } = useStore.getState()
  const [newTask, setNewTask] = useState('')
  const p = project
  const log = parseSessionLog(p.sessionLog)
  const done = p.tasks.filter((t) => t.done).length

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-rule px-3 py-3">
        <div className="flex items-start gap-2">
          <span
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: categoryColor(p.category), boxShadow: `0 0 6px ${categoryColor(p.category)}` }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[13px] text-ink">{p.name ?? 'Project'}</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              {p.error ? 'SIGNAL LOST' : p.ghost ? 'ghost · un-adopted' : `${p.status} · ${projectRelativeDeadline(p)}`}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="metal-key h-6 w-6 shrink-0">
            <X size={12} />
          </button>
        </div>
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => window.radar.openInEditor(p.path)}
            className="inline-flex items-center gap-1 border border-rule px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-faint hover:border-phosphor hover:text-phosphor"
          >
            <ExternalLink size={9} /> editor
          </button>
          <button
            onClick={() => window.radar.reveal(p.ghost ? p.path : p.blipPath)}
            className="inline-flex items-center gap-1 border border-rule px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-faint hover:border-phosphor hover:text-phosphor"
          >
            <FolderOpen size={9} /> reveal
          </button>
          {p.radar_angle != null && (
            <button
              onClick={() => setFields(p.blipPath, { radar_angle: null })}
              className="inline-flex items-center gap-1 border border-rule px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-faint hover:border-phosphor hover:text-phosphor"
            >
              <RotateCcw size={9} /> unpin
            </button>
          )}
        </div>
      </header>

      {p.ghost ? (
        <div className="px-3 py-4">
          <div className="font-mono text-[11px] leading-relaxed text-muted">
            Un-adopted repo — RADAR found{' '}
            <span className="text-phosphor">{(p.ghostHints ?? []).join(' · ') || 'a project'}</span> here
            but no <span className="text-phosphor">BLIP.md</span> yet. Adopt it to start tracking — this
            writes a fresh BLIP.md and touches nothing else.
          </div>
          <button
            onClick={() => adoptGhost(p)}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 border border-phosphor bg-phosphor/[0.08] py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-phosphor transition-colors hover:bg-phosphor/20"
          >
            <Sparkles size={12} /> Adopt project
          </button>
        </div>
      ) : p.error ? (
        <div className="px-3 py-3 font-mono text-[11px] leading-relaxed text-p1">
          BLIP.md could not be parsed — it is left untouched (never overwritten). Fix it by hand, then
          it returns to the radar.
          <div className="mt-1 text-faint">{p.error}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto track-scan px-3 py-3">
          {/* Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Horizon</Label>
              <div className="flex gap-1">
                {HORIZONS.map((h: Horizon) => (
                  <button
                    key={h}
                    onClick={() => setFields(p.blipPath, { horizon: h })}
                    className={`flex-1 border px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
                      p.horizon === h
                        ? 'border-phosphor text-phosphor'
                        : 'border-rule text-faint hover:text-ink'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div className="col-span-2">
              <Label>Deadline (overrides horizon)</Label>
              <input
                type="date"
                value={p.deadline?.slice(0, 10) ?? ''}
                onChange={(e) => setFields(p.blipPath, { deadline: e.target.value || null })}
                className="w-full border border-rule bg-lcd px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-phosphor"
              />
            </div>

            <div>
              <Label>Priority</Label>
              <div className="flex gap-1">
                {PRIORITIES.map((n) => (
                  <button
                    key={n}
                    onClick={() => setFields(p.blipPath, { priority: n })}
                    className={`flex-1 border py-1 font-mono text-[10px] transition-colors ${
                      p.priority === n
                        ? 'border-phosphor text-phosphor'
                        : 'border-rule text-faint hover:text-ink'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Status</Label>
              <select
                value={p.status}
                onChange={(e) => setFields(p.blipPath, { status: e.target.value as BlipStatus })}
                className="w-full border border-rule bg-lcd px-2 py-1 font-mono text-[11px] uppercase text-ink outline-none focus:border-phosphor"
              >
                {BLIP_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Category</Label>
              <TextField
                key={`cat-${p.blipPath}`}
                value={p.category}
                placeholder="e.g. Product"
                onCommit={(v) => setFields(p.blipPath, { category: v })}
              />
            </div>

            <div>
              <Label>Operation</Label>
              <TextField
                key={`op-${p.blipPath}`}
                value={p.operation ?? ''}
                placeholder="cluster"
                onCommit={(v) => setFields(p.blipPath, { operation: v || null })}
              />
            </div>

            <div className="col-span-2">
              <Label>Next action</Label>
              <TextField
                key={`next-${p.blipPath}`}
                value={p.next_action ?? ''}
                placeholder="one imperative line"
                onCommit={(v) => setFields(p.blipPath, { next_action: v })}
              />
            </div>
          </div>

          {/* Tasks */}
          <div className="mt-4">
            <Label>
              Tasks · {done}/{p.tasks.length}
            </Label>
            <div className="flex flex-col">
              {p.tasks.map((t, i) => (
                <div key={i} className="group flex items-center gap-2 py-0.5">
                  <button
                    onClick={() => taskOp(p.blipPath, { action: 'toggle', ref: i })}
                    aria-label="Toggle"
                    className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border transition-all ${
                      t.done ? 'border-phosphor bg-phosphor text-black' : 'border-faint hover:border-phosphor'
                    }`}
                  >
                    {t.done && <Check size={10} strokeWidth={3} />}
                  </button>
                  <span className={`flex-1 font-mono text-[12px] ${t.done ? 'text-faint line-through' : 'text-ink'}`}>
                    {t.text}
                  </span>
                  <button
                    onClick={() => taskOp(p.blipPath, { action: 'rm', ref: i })}
                    aria-label="Remove"
                    className="shrink-0 text-faint opacity-0 transition-opacity hover:text-p1 group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
            <input
              value={newTask}
              placeholder="+ add task"
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTask.trim()) {
                  taskOp(p.blipPath, { action: 'add', text: newTask.trim() })
                  setNewTask('')
                }
              }}
              className="mt-1 w-full border border-rule bg-lcd px-2 py-1 font-mono text-[12px] text-ink outline-none placeholder:text-faint focus:border-phosphor"
            />
          </div>

          {/* Session log — the activity timeline */}
          <div className="mt-4">
            <Label>Session log</Label>
            {log.length === 0 ? (
              <div className="font-mono text-[11px] text-faint">
                No entries yet — run <span className="text-phosphor">/blip handoff</span> in this repo to
                log a session.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {log
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <div key={i} className="border-l border-rule pl-2">
                      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-phosphor/80">
                        {e.date} · {e.author}
                      </div>
                      {e.lines.map((l, j) => (
                        <div key={j} className="font-mono text-[11px] leading-snug text-muted">
                          – {l}
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Links */}
          {Array.isArray(p.links) && p.links.length > 0 && (
            <div className="mt-4">
              <Label>Links</Label>
              {p.links.map((l, i) => {
                const url = typeof l === 'string' ? l : ''
                if (!url) return null
                return (
                  <button
                    key={i}
                    onClick={() => window.radar.openPath(url)}
                    className="block truncate font-mono text-[11px] text-term-cyan hover:underline"
                  >
                    {url}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
