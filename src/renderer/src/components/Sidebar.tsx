import { useMemo } from 'react'
import {
  AlarmClock,
  CalendarRange,
  FolderPlus,
  Inbox,
  Plus,
  Monitor,
  Radar,
  ScrollText,
  Sun
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import logo from '../assets/logo.png'
import { isNeglected, projectsForView } from '../lib/selectors'
import { categoryColor } from '../lib/projectRadar'
import { useStore, type View } from '../store/useStore'

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
  const projects = useStore((s) => s.projects)
  const view = useStore((s) => s.view)
  const crt = useStore((s) => s.crtEffects)
  const { setView, setSelectedBlip, toggleCrt, adoptFolder, addWorkspaceRoot } = useStore.getState()

  const live = useMemo(() => projects.filter((p) => p.status !== 'archived' && !p.ghost), [projects])
  const counts = useMemo(
    () => ({
      radar: live.length,
      today: projectsForView(projects, { kind: 'today' }).length,
      neglected: projects.filter((p) => isNeglected(p)).length
    }),
    [projects, live]
  )

  const ordered = useMemo(() => [...live].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), [live])
  const isActive = (kind: View['kind']): boolean => view.kind === kind

  function openProject(blipPath: string): void {
    setView({ kind: 'radar' })
    setSelectedBlip(blipPath)
  }

  return (
    <aside className="drag-region term-grid relative z-[1] flex h-full w-60 shrink-0 flex-col border-r border-rule">
      <div className="flex items-center gap-2 px-4 py-3">
        <img
          src={logo}
          alt="TerraByte RADAR"
          className="h-7 w-7 shrink-0"
          style={{ mixBlendMode: 'screen', filter: 'drop-shadow(0 0 5px rgba(0,255,136,.45))' }}
        />
        <span className="font-mono text-[12px] font-semibold tracking-[0.06em] text-ink">
          RADAR
          <span className="text-faint">.sys</span>
        </span>
      </div>
      <div className="glow-line mx-4 mb-1 w-8" />

      <nav className="no-drag flex flex-col">
        <GroupLabel>Views</GroupLabel>
        <NavRow icon={Radar} label="Radar" code="0x00" count={counts.radar} active={isActive('radar')} onClick={() => setView({ kind: 'radar' })} />
        <NavRow icon={Sun} label="Due Soon" code="0x01" count={counts.today} active={isActive('today')} onClick={() => setView({ kind: 'today' })} />
        <NavRow icon={CalendarRange} label="Calendar" code="0x02" active={isActive('calendar')} onClick={() => setView({ kind: 'calendar' })} />
        <NavRow icon={ScrollText} label="Logbook" code="0x03" active={isActive('logbook')} onClick={() => setView({ kind: 'logbook' })} />
        <NavRow icon={AlarmClock} label="Neglected" code="0x04" count={counts.neglected} active={isActive('neglected')} onClick={() => setView({ kind: 'neglected' })} />
        <NavRow icon={Inbox} label="Inbox" code="0x05" active={isActive('inbox')} onClick={() => setView({ kind: 'inbox' })} />
      </nav>

      <div className="mt-1 flex items-center justify-between px-4">
        <button
          onClick={() => setView({ kind: 'all' })}
          className="no-drag font-mono text-[10px] uppercase tracking-[0.18em] text-phosphor/70 hover:text-phosphor"
        >
          Projects
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => adoptFolder()} title="Adopt a folder (create its BLIP.md)" aria-label="Adopt folder" className="no-drag text-faint hover:text-phosphor">
            <FolderPlus size={14} />
          </button>
          <button onClick={() => addWorkspaceRoot()} title="Add a workspace root to scan" aria-label="Add workspace root" className="no-drag text-faint hover:text-phosphor">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="no-drag flex-1 overflow-y-auto px-2 pb-2 pt-1">
        {ordered.length === 0 && (
          <div className="px-2.5 py-2 font-mono text-[10px] leading-relaxed text-faint">
            No projects yet. Adopt a folder or add a workspace root that contains BLIP.md files.
          </div>
        )}
        {ordered.map((p) => (
          <button
            key={p.blipPath}
            onClick={() => openProject(p.blipPath)}
            className="flex w-full items-center gap-2 border-l-2 border-transparent px-2.5 py-1.5 text-left font-mono text-[12px] tracking-[0.04em] text-muted transition-colors hover:bg-phosphor/[0.04] hover:text-ink"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: p.error ? '#FF3030' : categoryColor(p.category), boxShadow: `0 0 6px ${p.error ? '#FF3030' : categoryColor(p.category)}` }}
            />
            <span className="flex-1 truncate">{p.name ?? 'Project'}</span>
            {p.tasks.length ? (
              <span className="text-[10px] text-faint">
                {p.tasks.filter((t) => t.done).length}/{p.tasks.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

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
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint/70">v0.1.0</span>
      </div>
    </aside>
  )
}
