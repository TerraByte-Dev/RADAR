import * as Dialog from '@radix-ui/react-dialog'
import { useMemo, useState } from 'react'
import { CalendarClock, Flag, Hash, Tag } from 'lucide-react'
import { formatDue } from '../lib/date'
import { parseQuickAdd } from '../lib/nlp'
import { useStore } from '../store/useStore'

function Pill({
  icon: Icon,
  children,
  tone = 'text-phosphor'
}: {
  icon: typeof Hash
  children: React.ReactNode
  tone?: string
}): JSX.Element {
  return (
    <span
      className={`flex items-center gap-1 border border-rule bg-phosphor/[0.06] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.06em] ${tone}`}
    >
      <Icon size={12} />
      {children}
    </span>
  )
}

export function QuickAdd(): JSX.Element {
  const open = useStore((s) => s.quickAddOpen)
  const projects = useStore((s) => s.projects)
  const { setQuickAddOpen, addTaskFromParsed } = useStore.getState()
  const [text, setText] = useState('')

  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text) : null), [text])

  const projectIsNew = useMemo(() => {
    if (!parsed?.projectName) return false
    return !projects.some((p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase())
  }, [parsed, projects])

  function close(): void {
    setText('')
    setQuickAddOpen(false)
  }

  async function commit(): Promise<void> {
    if (!parsed || !parsed.title) return close()
    await addTaskFromParsed(parsed)
    close()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? setQuickAddOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed left-1/2 top-[18%] z-50 w-[min(640px,92vw)] -translate-x-1/2 border border-phosphor/50 bg-panel shadow-glow-strong data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="flex items-center gap-2 border-b border-rule bg-black/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-phosphor">
            <span className="led-dot" />
            Quick Add // New Task
          </Dialog.Title>

          <div className="flex items-center gap-2 px-3 pt-3">
            <span className="font-term text-xl leading-none text-phosphor">{'>'}</span>
            <input
              autoFocus
              value={text}
              placeholder="pay rent tomorrow 5pm p1 #finance @home"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commit()
                }
              }}
              className="w-full bg-transparent py-1 font-mono text-[15px] text-ink caret-phosphor outline-none placeholder:text-faint"
            />
          </div>

          {parsed &&
            (parsed.due || parsed.priority !== 'none' || parsed.projectName || parsed.tags.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1 pt-2">
                {parsed.due && (
                  <Pill icon={CalendarClock} tone="text-term-cyan">
                    {formatDue(parsed.due)}
                  </Pill>
                )}
                {parsed.priority !== 'none' && (
                  <Pill icon={Flag} tone="text-term-amber">
                    {parsed.priority}
                  </Pill>
                )}
                {parsed.projectName && (
                  <Pill icon={Hash}>
                    {parsed.projectName}
                    {projectIsNew && <span className="ml-1 text-faint">(new)</span>}
                  </Pill>
                )}
                {parsed.tags.map((t) => (
                  <Pill key={t} icon={Tag}>
                    {t}
                  </Pill>
                ))}
              </div>
            )}

          <div className="flex items-center justify-between border-t border-rule px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
            <span>date · p1–p4 · #project · @tag parsed automatically</span>
            <span className="text-phosphor/70">↵ add · esc close</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
