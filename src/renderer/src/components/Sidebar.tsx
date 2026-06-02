import { useMemo, useState } from 'react'
import { CalendarRange, Monitor, Plus, Radar, ScrollText, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import logo from '../assets/logo.png'
import { isOverdue, isToday } from '../lib/date'
import { isSnoozed } from '../lib/selectors'
import { useStore, type View } from '../store/useStore'
import { ProjectContextMenu } from './ProjectContextMenu'

function NavRow({
  icon: Icon,
  label,
  code,
  count,
  active,
  onClick
}: {
  icon: LucideIcon
  label: string
  code: string
  count?: number
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`no-drag group flex w-full items-center gap-2 border-l-2 px-2.5 py-1.5 text-left font-mono text-[12px] uppercase tracking-[0.08em] transition-colors ${
        active
          ? 'border-phosphor bg-phosphor/[0.08] text-phosphor phosphor-glow'
          : 'border-transparent text-muted hover:bg-phosphor/[0.04] hover:text-ink'
      }`}
    >
      <span
        className={`w-2 shrink-0 text-phosphor transition-opacity ${
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
        }`}
      >
        ▸
      </span>
      <Icon size={14} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {count ? (
        <span className="text-[10px] text-faint">[{count}]</span>
      ) : (
        <span className="text-[9px] tracking-[0.04em] text-phosphor/45">{code}</span>
      )}
    </button>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-phosphor/70">
      {children}
    </div>
  )
}

export function Sidebar(): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const view = useStore((s) => s.view)
  const crt = useStore((s) => s.crtEffects)
  const { setView, addProject, renameProject, toggleCrt, setPaletteOpen } = useStore.getState()

  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const counts = useMemo(() => {
    const open = tasks.filter((t) => !t.completed)
    const activeNow = open.filter((t) => !isSnoozed(t))
    return {
      radar: activeNow.length,
      today: activeNow.filter((t) => isToday(t.due) || isOverdue(t.due)).length,
      byProject: (id: string): number => open.filter((t) => t.projectId === id).length
    }
  }, [tasks])

  const isActive = (v: View): boolean =>
    view.kind === v.kind && (v.kind !== 'project' || (view.kind === 'project' && view.id === v.id))

  async function commitNew(): Promise<void> {
    const name = draftName.trim()
    if (name) {
      const p = await addProject(name)
      setView({ kind: 'project', id: p.id })
    }
    setDraftName('')
    setAdding(false)
  }

  async function commitRename(id: string): Promise<void> {
    const name = renameDraft.trim()
    if (name) await renameProject(id, name)
    setRenamingId(null)
  }

  return (
    <aside className="drag-region term-grid relative z-[1] flex h-full w-60 shrink-0 flex-col border-r border-rule">
      {/* Brand header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <img
          src={logo}
          alt="TerraByte Solutions"
          className="h-7 w-7 shrink-0"
          style={{ mixBlendMode: 'screen', filter: 'drop-shadow(0 0 5px rgba(0,255,136,.45))' }}
        />
        <span className="font-mono text-[12px] font-semibold tracking-[0.06em] text-ink">
          TODOPLUS
          <span className="text-faint">.sys</span>
        </span>
      </div>
      <div className="glow-line mx-4 mb-1 w-8" />

      <nav className="no-drag flex flex-col">
        <GroupLabel>Views</GroupLabel>
        <NavRow
          icon={Radar}
          label="Radar"
          code="0x00"
          count={counts.radar}
          active={isActive({ kind: 'radar' })}
          onClick={() => setView({ kind: 'radar' })}
        />
        <NavRow
          icon={Sun}
          label="Today"
          code="0x01"
          count={counts.today}
          active={isActive({ kind: 'today' })}
          onClick={() => setView({ kind: 'today' })}
        />
        <NavRow
          icon={CalendarRange}
          label="Calendar"
          code="0x02"
          active={isActive({ kind: 'calendar' })}
          onClick={() => setView({ kind: 'calendar' })}
        />
        <NavRow
          icon={ScrollText}
          label="Logbook"
          code="0x03"
          active={isActive({ kind: 'logbook' })}
          onClick={() => setView({ kind: 'logbook' })}
        />
        <button
          onClick={() => setPaletteOpen(true)}
          title="Open command palette"
          className="no-drag mt-0.5 flex w-full items-center gap-2 border-l-2 border-transparent px-2.5 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-faint transition-colors hover:bg-phosphor/[0.04] hover:text-phosphor"
        >
          <span className="w-2 shrink-0" />
          <span className="flex-1 truncate">Inbox · Snoozed · Done</span>
          <span className="text-[9px] tracking-[0.04em] text-phosphor/45">⌘K</span>
        </button>
      </nav>

      <div className="mt-1 flex items-center justify-between px-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-phosphor/70">
          Projects
        </span>
        <button
          onClick={() => setAdding(true)}
          aria-label="Add project"
          className="no-drag text-faint hover:text-phosphor"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="no-drag flex-1 overflow-y-auto px-2 pb-2 pt-1">
        {projects.map((p) =>
          renamingId === p.id ? (
            <input
              key={p.id}
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => commitRename(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(p.id)
                if (e.key === 'Escape') setRenamingId(null)
              }}
              className="lcd-inset w-full px-2.5 py-1.5 font-mono text-[12px] outline-none"
            />
          ) : (
            <ProjectContextMenu
              key={p.id}
              project={p}
              onRename={() => {
                setRenameDraft(p.name)
                setRenamingId(p.id)
              }}
            >
              <button
                onClick={() => setView({ kind: 'project', id: p.id })}
                className={`flex w-full items-center gap-2 border-l-2 px-2.5 py-1.5 text-left font-mono text-[12px] tracking-[0.04em] transition-colors ${
                  isActive({ kind: 'project', id: p.id })
                    ? 'border-phosphor bg-phosphor/[0.08] text-phosphor'
                    : 'border-transparent text-muted hover:bg-phosphor/[0.04] hover:text-ink'
                }`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}` }}
                />
                <span className="flex-1 truncate">{p.name}</span>
                {counts.byProject(p.id) ? (
                  <span className="text-[10px] text-faint">[{counts.byProject(p.id)}]</span>
                ) : null}
              </button>
            </ProjectContextMenu>
          )
        )}

        {adding && (
          <input
            autoFocus
            value={draftName}
            placeholder="PROJECT NAME"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitNew}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNew()
              if (e.key === 'Escape') {
                setDraftName('')
                setAdding(false)
              }
            }}
            className="lcd-inset mt-0.5 w-full px-2.5 py-1.5 font-mono text-[12px] uppercase outline-none placeholder:text-faint"
          />
        )}
      </div>

      {/* Footer — CRT toggle + status readout */}
      <div className="no-drag flex items-center justify-between border-t border-rule px-3 py-2">
        <button
          onClick={toggleCrt}
          title="Toggle CRT effects"
          className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
            crt ? 'text-phosphor' : 'text-faint hover:text-ink'
          }`}
        >
          <Monitor size={12} />
          CRT {crt ? 'ON' : 'OFF'}
        </button>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint/70">
          v0.1.0
        </span>
      </div>
    </aside>
  )
}
