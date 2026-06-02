import { Command } from 'cmdk'
import {
  CalendarRange,
  CheckSquare,
  Eye,
  Hash,
  Inbox,
  Monitor,
  Moon,
  Plus,
  Radar,
  ScrollText,
  Sun
} from 'lucide-react'
import { useStore, type View } from '../store/useStore'

const itemCls =
  'flex cursor-default items-center gap-2.5 rounded-sm px-2.5 py-2 font-mono text-[13px] uppercase ' +
  'tracking-[0.04em] text-muted outline-none data-[selected=true]:bg-phosphor/10 ' +
  'data-[selected=true]:text-phosphor'

const groupCls =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono ' +
  '[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase ' +
  '[&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-phosphor/70'

export function CommandPalette(): JSX.Element {
  const open = useStore((s) => s.paletteOpen)
  const projects = useStore((s) => s.projects)
  const crt = useStore((s) => s.crtEffects)
  const showCompleted = useStore((s) => s.showCompleted)
  const { setPaletteOpen, setView, setQuickAddOpen, toggleCrt, toggleShowCompleted } =
    useStore.getState()

  const go = (view: View): void => {
    setView(view)
    setPaletteOpen(false)
  }

  const run = (fn: () => void): void => {
    fn()
    setPaletteOpen(false)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setPaletteOpen}
      label="Command palette"
      className="fixed left-1/2 top-[18%] z-50 w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden border border-phosphor/40 bg-panel shadow-glow-strong"
      overlayClassName="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-2 border-b border-rule bg-black/40 px-3">
        <span className="font-term text-lg leading-none text-phosphor">{'>'}</span>
        <Command.Input
          placeholder="TYPE A COMMAND…"
          className="w-full bg-transparent py-3 font-mono text-[14px] uppercase tracking-[0.04em] text-ink caret-phosphor outline-none placeholder:text-faint"
        />
      </div>
      <Command.List className="max-h-[340px] overflow-y-auto p-2">
        <Command.Empty className="px-2.5 py-6 text-center font-mono text-[12px] uppercase tracking-[0.1em] text-faint">
          // no results
        </Command.Empty>

        <Command.Group heading="Actions" className={groupCls}>
          <Command.Item className={itemCls} onSelect={() => run(() => setQuickAddOpen(true))}>
            <Plus size={16} /> New task
          </Command.Item>
          <Command.Item
            value="toggle crt effects scanlines"
            className={itemCls}
            onSelect={() => run(toggleCrt)}
          >
            <Monitor size={16} /> CRT effects: {crt ? 'on' : 'off'}
          </Command.Item>
          <Command.Item
            value="toggle completed tasks visibility"
            className={itemCls}
            onSelect={() => run(toggleShowCompleted)}
          >
            <Eye size={16} /> Completed in list: {showCompleted ? 'shown' : 'hidden'}
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Go to" className={groupCls}>
          <Command.Item className={itemCls} onSelect={() => go({ kind: 'radar' })}>
            <Radar size={16} /> Radar
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => go({ kind: 'today' })}>
            <Sun size={16} /> Today
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => go({ kind: 'calendar' })}>
            <CalendarRange size={16} /> Calendar
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => go({ kind: 'inbox' })}>
            <Inbox size={16} /> Inbox
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => go({ kind: 'snoozed' })}>
            <Moon size={16} /> Snoozed
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => go({ kind: 'completed' })}>
            <CheckSquare size={16} /> Completed
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => go({ kind: 'logbook' })}>
            <ScrollText size={16} /> Logbook
          </Command.Item>
        </Command.Group>

        {projects.length > 0 && (
          <Command.Group heading="Projects" className={groupCls}>
            {projects.map((p) => (
              <Command.Item
                key={p.id}
                value={`project ${p.name}`}
                className={itemCls}
                onSelect={() => go({ kind: 'project', id: p.id })}
              >
                <Hash size={16} style={{ color: p.color }} /> {p.name}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  )
}
