import { useEffect, useRef, useState } from 'react'
import { ArrowUpToLine, Check, ExternalLink, FolderOpen, RotateCcw, Sparkles, X } from 'lucide-react'
import type { BlipStatus, Horizon, ProjectRecord } from '@shared/radar'
import { BLIP_STATUSES, HORIZONS } from '@shared/radar'
import { isClickableLink, normalizeLinks } from '../lib/links'
import { parseSessionLog } from '../lib/selectors'
import { categoryColor, projectRelativeDeadline } from '../lib/projectRadar'
import { setTaskDue, taskDueDate, taskText, urgencyForDue } from '../lib/taskDue'
import { useStore } from '../store/useStore'

const PRIORITIES = [1, 2, 3, 4, 5]

function Label({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">{children}</div>
  )
}

/**
 * A committed-on-blur date field. `<input type="date">` fires `change` for every keystroke that
 * leaves a *complete* valid date, so typing a year emits four of them — writing `0002-08-12`,
 * `0020-08-12` and `0202-08-12` into the BLIP.md on the way to the real date. Each of those was a
 * full atomic write, and they raced each other because nothing awaited them. Same shape as
 * `TextField`: edit locally, commit once. `key` on the caller resyncs it when the record changes.
 */
function DateField({
  value,
  title,
  className,
  onCommit
}: {
  value: string
  title?: string
  className: string
  onCommit: (v: string | null) => void
}): JSX.Element {
  const [v, setV] = useState(value)
  const commit = (): void => {
    if (v !== value) onCommit(v || null)
  }
  // Escape closes the whole detail panel, and a watcher rescan can replace the row underneath an
  // open field — both unmount it. Flush on the way out so a typed date is never silently dropped.
  const latest = useRef(commit)
  latest.current = commit
  useEffect(() => () => latest.current(), [])
  return (
    <input
      type="date"
      value={v}
      title={title}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className={className}
    />
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
  const showCompleted = useStore((s) => s.showCompleted)
  const [newTask, setNewTask] = useState('')
  const p = project
  const log = parseSessionLog(p.sessionLog)
  const done = p.tasks.filter((t) => t.done).length
  const links = normalizeLinks(p.links)
  // The head of the queue — no separate "next action" field; the list's order says it.
  const nextIndex = p.tasks.findIndex((t) => !t.done)

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
              <Label>Hard deadline · optional</Label>
              <DateField
                key={p.deadline?.slice(0, 10) ?? ''}
                value={p.deadline?.slice(0, 10) ?? ''}
                onCommit={(v) => setFields(p.blipPath, { deadline: v })}
                className="w-full border border-rule bg-lcd px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-phosphor"
              />
              <div className="mt-1 font-mono text-[9px] leading-snug text-faint">
                Usually unset — the radar places this blip by its soonest task{' '}
                <span className="text-muted">(due …)</span>. Set a hard date only when the whole
                project is due then.
              </div>
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

          </div>

          {/* Tasks — the queue IS the plan; its head is the next action. */}
          <div className="mt-4">
            <Label>
              Tasks · {done}/{p.tasks.length}
              <span className="ml-1.5 normal-case tracking-normal text-faint/70">
                — in order; the first open one is next
              </span>
            </Label>
            <div className="flex flex-col">
              {p.tasks.map((t, i) => {
                if (!showCompleted && t.done) return null
                const due = t.done ? null : taskDueDate(t.text)
                const urg = due ? urgencyForDue(due) : null
                const isNext = i === nextIndex
                return (
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
                    <span
                      className={`flex-1 font-mono text-[12px] ${
                        t.done
                          ? 'text-faint line-through'
                          : isNext
                            ? 'text-phosphor phosphor-glow'
                            : 'text-ink'
                      }`}
                    >
                      {isNext && <span className="mr-1 text-phosphor/70">▸</span>}
                      {taskText(t.text)}
                    </span>
                    {!t.done && !isNext && (
                      <button
                        onClick={() => taskOp(p.blipPath, { action: 'mv', ref: i, to: 0 })}
                        aria-label="Make this the next action"
                        title="Make this the next action"
                        className="shrink-0 text-faint opacity-0 transition-opacity hover:text-phosphor group-hover:opacity-100"
                      >
                        <ArrowUpToLine size={11} />
                      </button>
                    )}
                    {!t.done && (
                      <DateField
                        // Keyed and referenced by the task's own text, not its index: the commit
                        // now lands on blur rather than per keystroke, so a rescan can reorder the
                        // queue in between. A text ref follows the task; a stale one throws and the
                        // store resyncs, instead of quietly dating whatever slid into slot `i`.
                        key={t.text}
                        value={due ?? ''}
                        title={due ? `due ${due}` : 'set a due date'}
                        onCommit={(v) =>
                          taskOp(p.blipPath, { action: 'edit', ref: t.text, text: setTaskDue(t.text, v) })
                        }
                        className={`w-[6.7rem] shrink-0 border border-rule bg-lcd px-1 py-0.5 font-mono text-[10px] outline-none focus:border-phosphor ${
                          urg === 'overdue'
                            ? 'text-p1'
                            : urg === 'soon'
                              ? 'text-term-amber'
                              : due
                                ? 'text-ink'
                                : 'text-faint'
                        }`}
                      />
                    )}
                    <button
                      onClick={() => taskOp(p.blipPath, { action: 'rm', ref: i })}
                      aria-label="Remove"
                      className="shrink-0 text-faint opacity-0 transition-opacity hover:text-p1 group-hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
            <input
              value={newTask}
              placeholder="+ add task — optional “(due fri)”"
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

          {/* Links — string entries and the schema's {label: url} object form alike */}
          {links.length > 0 && (
            <div className="mt-4">
              <Label>Links</Label>
              {links.map((l, i) => {
                // links: come from agent/repo-written files — only allowlisted URL schemes are
                // clickable (main re-validates); anything else renders inert.
                if (!isClickableLink(l.url)) {
                  return (
                    <div key={i} className="block truncate font-mono text-[11px] text-muted" title={`${l.url} — not an http(s) link, not clickable`}>
                      {l.label}
                    </div>
                  )
                }
                return (
                  <button
                    key={i}
                    onClick={() => window.radar.openExternal(l.url)}
                    title={l.url}
                    className="block truncate font-mono text-[11px] text-term-cyan hover:underline"
                  >
                    {l.label}
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
