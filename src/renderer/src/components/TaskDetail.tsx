import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { ActivityKind, Task } from '@shared/types'
import { formatTimestamp } from '../lib/date'
import { useStore } from '../store/useStore'

const ACTIVITY_LABEL: Record<Exclude<ActivityKind, 'note'>, string> = {
  created: 'Created',
  rescheduled: 'Rescheduled',
  completed: 'Completed',
  reopened: 'Reopened',
  snoozed: 'Snoozed'
}

const ACTIVITY_DOT: Record<ActivityKind, string> = {
  completed: 'bg-phosphor',
  note: 'bg-term-cyan',
  rescheduled: 'bg-faint',
  snoozed: 'bg-faint',
  reopened: 'bg-faint',
  created: 'bg-faint'
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-phosphor/70">
      {'> '}
      {children}
    </div>
  )
}

export function TaskDetail({ task }: { task: Task }): JSX.Element {
  const { setNotes, addSubtask, toggleSubtask, deleteSubtask, addActivityNote } =
    useStore.getState()

  const [notes, setNotesLocal] = useState(task.notes ?? '')
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const notesRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setNotesLocal(task.notes ?? '')
  }, [task.id])

  useEffect(() => {
    const el = notesRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [notes])

  const done = task.subtasks.filter((s) => s.completed).length

  function saveNotes(): void {
    if (notes !== (task.notes ?? '')) setNotes(task.id, notes)
  }

  function commitSubtask(): void {
    if (subtaskDraft.trim()) {
      addSubtask(task.id, subtaskDraft)
      setSubtaskDraft('')
    }
  }

  function commitNote(): void {
    if (noteDraft.trim()) {
      addActivityNote(task.id, noteDraft)
      setNoteDraft('')
    }
  }

  return (
    <div
      className="lcd-panel ml-[30px] mr-2 mb-1 space-y-4 p-4"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Notes */}
      <div>
        <SectionLabel>Notes</SectionLabel>
        <textarea
          ref={notesRef}
          value={notes}
          placeholder="Add notes, links, context…"
          onChange={(e) => setNotesLocal(e.target.value)}
          onBlur={saveNotes}
          rows={1}
          className="w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint"
        />
      </div>

      {/* Subtasks */}
      <div>
        <SectionLabel>
          Subtasks{task.subtasks.length > 0 && ` · ${done}/${task.subtasks.length}`}
        </SectionLabel>
        <div className="space-y-0.5">
          {task.subtasks.map((s) => (
            <div key={s.id} className="group/sub flex items-center gap-2">
              <button
                onClick={() => toggleSubtask(task.id, s.id)}
                aria-label={s.completed ? 'Uncheck step' : 'Check step'}
                className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border transition-colors ${
                  s.completed ? 'border-phosphor bg-phosphor' : 'border-faint hover:border-phosphor'
                }`}
              >
                {s.completed && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-black" fill="none">
                    <path
                      d="M2.5 6.5l2 2 5-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
              <span
                className={`flex-1 font-mono text-[13px] ${
                  s.completed ? 'text-faint line-through' : 'text-ink'
                }`}
              >
                {s.title}
              </span>
              <button
                onClick={() => deleteSubtask(task.id, s.id)}
                aria-label="Delete step"
                className="text-faint opacity-0 transition-opacity hover:text-p1 group-hover/sub:opacity-100"
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-0.5">
            <Plus size={14} className="shrink-0 text-phosphor" />
            <input
              value={subtaskDraft}
              placeholder="Add a step"
              onChange={(e) => setSubtaskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitSubtask()
              }}
              className="flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-faint"
            />
          </div>
        </div>
      </div>

      {/* Activity */}
      <div>
        <SectionLabel>Activity</SectionLabel>
        <div className="space-y-1.5">
          {[...task.activity].reverse().map((a) => (
            <div key={a.id} className="flex items-center gap-2 font-mono text-[12px]">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACTIVITY_DOT[a.kind]}`} />
              <span className="w-16 shrink-0 text-faint">{formatTimestamp(a.ts)}</span>
              {a.kind === 'note' ? (
                <span className="text-ink">{a.text}</span>
              ) : (
                <span className="text-muted uppercase tracking-[0.06em]">{ACTIVITY_LABEL[a.kind]}</span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={noteDraft}
            placeholder="Add a follow-up note…"
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNote()
            }}
            className="lcd-inset flex-1 px-2.5 py-1.5 font-mono text-[12px] outline-none placeholder:text-faint"
          />
        </div>
      </div>
    </div>
  )
}
