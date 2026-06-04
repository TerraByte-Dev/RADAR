import { useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { ProjectRecord } from '@shared/radar'
import { projectsForView, viewTitle } from '../lib/selectors'
import { categoryColor, projectRelativeDeadline, taskRatio } from '../lib/projectRadar'
import { useStore } from '../store/useStore'

function ProjectRow({ p, onOpen }: { p: ProjectRecord; onOpen: () => void }): JSX.Element {
  const ratio = taskRatio(p)
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-3 border-b border-ruleDim px-3 py-2.5 text-left transition-colors hover:bg-phosphor/[0.04]"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: p.error ? '#FF3030' : categoryColor(p.category), boxShadow: `0 0 6px ${p.error ? '#FF3030' : categoryColor(p.category)}` }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[13px] text-ink">{p.name ?? 'Project'}</div>
        <div className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
          P{p.priority}
          {p.category && ` · ${p.category}`}
          {p.next_action && ` · ${p.next_action}`}
        </div>
      </div>
      {p.tasks.length > 0 && (
        <span className="shrink-0 font-mono text-[10px] text-faint">{Math.round(ratio * 100)}%</span>
      )}
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
        {projectRelativeDeadline(p)}
      </span>
    </button>
  )
}

/** The Inbox blip rendered as its loose-task checklist + capture line. */
function InboxPanel({ inbox }: { inbox: ProjectRecord | undefined }): JSX.Element {
  const { taskOp, capture } = useStore.getState()
  const [text, setText] = useState('')
  if (!inbox) {
    return (
      <div className="mt-16 text-center font-mono text-xs uppercase tracking-[0.12em] text-faint">
        // inbox not ready
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-2xl px-4 pt-2">
      <div className="flex flex-col">
        {inbox.tasks.map((t, i) => (
          <div key={i} className="group flex items-center gap-2 border-b border-ruleDim py-1.5">
            <button
              onClick={() => taskOp(inbox.blipPath, { action: 'toggle', ref: i })}
              aria-label="Toggle"
              className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-sm border transition-all ${
                t.done ? 'border-phosphor bg-phosphor text-black' : 'border-faint hover:border-phosphor'
              }`}
            >
              {t.done && <Check size={11} strokeWidth={3} />}
            </button>
            <span className={`flex-1 font-mono text-[13px] ${t.done ? 'text-faint line-through' : 'text-ink'}`}>
              {t.text}
            </span>
            <button
              onClick={() => taskOp(inbox.blipPath, { action: 'rm', ref: i })}
              aria-label="Remove"
              className="shrink-0 text-faint opacity-0 transition-opacity hover:text-p1 group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <input
        value={text}
        placeholder="+ capture an errand or deadline…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            capture(text.trim())
            setText('')
          }
        }}
        className="mt-2 w-full border border-rule bg-lcd px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-faint focus:border-phosphor"
      />
    </div>
  )
}

export function ProjectListView(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const view = useStore((s) => s.view)
  const { setView, setSelectedBlip } = useStore.getState()

  const list = useMemo(() => projectsForView(projects, view), [projects, view])
  const inbox = useMemo(() => projects.find((p) => p.name === 'Inbox'), [projects])

  function open(blipPath: string): void {
    setView({ kind: 'radar' })
    setSelectedBlip(blipPath)
  }

  return (
    <main className="relative flex h-full flex-1 flex-col bg-bg">
      <header className="drag-region flex items-center gap-3 px-9 pb-3 pt-5">
        <span className="font-term text-2xl leading-none text-phosphor">{'>'}</span>
        <h1 className="font-term text-3xl uppercase tracking-wide text-phosphor phosphor-glow">
          {viewTitle(view)}
        </h1>
      </header>

      <div className="track-scan flex-1 overflow-y-auto pb-12">
        {view.kind === 'inbox' ? (
          <InboxPanel inbox={inbox} />
        ) : list.length === 0 ? (
          <div className="mt-24 text-center font-mono text-xs uppercase tracking-[0.12em] text-faint">
            {'// nothing here'}
          </div>
        ) : (
          <div className="mx-auto max-w-2xl pt-1">
            {list.map((p) => (
              <ProjectRow key={p.blipPath} p={p} onOpen={() => open(p.blipPath)} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
