import * as ContextMenu from '@radix-ui/react-context-menu'
import { Calendar, Check, ChevronRight, Flag, Folder, Moon, Star, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { DueDate, Priority, Task } from '@shared/types'
import { PRIORITY_DOT } from '../lib/palette'
import { isSnoozed } from '../lib/selectors'
import { useStore } from '../store/useStore'

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4', 'none']

const itemCls =
  'flex cursor-default items-center gap-2 rounded-sm px-2.5 py-1.5 font-mono text-[12px] uppercase ' +
  'tracking-[0.04em] text-ink outline-none data-[highlighted]:bg-phosphor/10 data-[highlighted]:text-phosphor'
const contentCls =
  'z-50 min-w-[190px] border border-phosphor/30 bg-panel p-1 shadow-glow ' +
  'data-[state=open]:animate-in data-[state=open]:fade-in-0'

function atDays(offset: number): DueDate {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(0, 0, 0, 0)
  return { date: d.toISOString(), hasTime: false }
}

function snoozeUntil(opt: 'laterToday' | 'tomorrow' | 'weekend' | 'nextWeek'): string {
  const d = new Date()
  switch (opt) {
    case 'laterToday':
      d.setHours(d.getHours() + 3, 0, 0, 0)
      break
    case 'tomorrow':
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      break
    case 'weekend': {
      let add = (6 - d.getDay() + 7) % 7
      if (add === 0) add = 7 // already Saturday → next Saturday
      d.setDate(d.getDate() + add)
      d.setHours(9, 0, 0, 0)
      break
    }
    case 'nextWeek':
      d.setDate(d.getDate() + 7)
      d.setHours(9, 0, 0, 0)
      break
  }
  return d.toISOString()
}

export function TaskContextMenu({
  task,
  children
}: {
  task: Task
  children: ReactNode
}): JSX.Element {
  const projects = useStore((s) => s.projects)
  const { toggleComplete, toggleStar, setPriority, setProject, setDue, snooze, unsnooze, deleteTask } =
    useStore.getState()
  const snoozed = isSnoozed(task)

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={contentCls}>
          <ContextMenu.Item className={itemCls} onSelect={() => toggleComplete(task.id)}>
            <Check size={14} className="text-muted" />
            {task.completed ? 'Mark incomplete' : 'Complete'}
          </ContextMenu.Item>

          <ContextMenu.Item className={itemCls} onSelect={() => toggleStar(task.id)}>
            <Star size={14} className="text-muted" fill={task.starred ? 'currentColor' : 'none'} />
            {task.starred ? 'Unstar' : 'Star (mark active)'}
          </ContextMenu.Item>

          <ContextMenu.Separator className="my-1 h-px bg-rule" />

          {/* Priority submenu */}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={itemCls}>
              <Flag size={14} className="text-muted" />
              Priority
              <ChevronRight size={13} className="ml-auto text-faint" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={contentCls}>
                {PRIORITIES.map((p) => (
                  <ContextMenu.Item
                    key={p}
                    className={itemCls}
                    onSelect={() => setPriority(task.id, p)}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${PRIORITY_DOT[p]}`} />
                    {p === 'none' ? 'No priority' : p}
                    {task.priority === p && <Check size={13} className="ml-auto text-accent" />}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          {/* Move-to-project submenu */}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={itemCls}>
              <Folder size={14} className="text-muted" />
              Move to
              <ChevronRight size={13} className="ml-auto text-faint" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={contentCls}>
                <ContextMenu.Item className={itemCls} onSelect={() => setProject(task.id, null)}>
                  <span className="h-2.5 w-2.5 rounded-full bg-faint" />
                  Inbox
                  {task.projectId === null && <Check size={13} className="ml-auto text-accent" />}
                </ContextMenu.Item>
                {projects.map((p) => (
                  <ContextMenu.Item
                    key={p.id}
                    className={itemCls}
                    onSelect={() => setProject(task.id, p.id)}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    {p.name}
                    {task.projectId === p.id && <Check size={13} className="ml-auto text-accent" />}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          {/* Schedule submenu */}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={itemCls}>
              <Calendar size={14} className="text-muted" />
              Schedule
              <ChevronRight size={13} className="ml-auto text-faint" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={contentCls}>
                <ContextMenu.Item className={itemCls} onSelect={() => setDue(task.id, atDays(0))}>
                  Today
                </ContextMenu.Item>
                <ContextMenu.Item className={itemCls} onSelect={() => setDue(task.id, atDays(1))}>
                  Tomorrow
                </ContextMenu.Item>
                <ContextMenu.Item className={itemCls} onSelect={() => setDue(task.id, atDays(7))}>
                  Next week
                </ContextMenu.Item>
                <ContextMenu.Separator className="my-1 h-px bg-rule" />
                <ContextMenu.Item
                  className={itemCls}
                  onSelect={() => setDue(task.id, undefined)}
                >
                  No date
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          {/* Snooze submenu */}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={itemCls}>
              <Moon size={14} className="text-muted" />
              Snooze
              <ChevronRight size={13} className="ml-auto text-faint" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={contentCls}>
                <ContextMenu.Item
                  className={itemCls}
                  onSelect={() => snooze(task.id, snoozeUntil('laterToday'))}
                >
                  Later today
                </ContextMenu.Item>
                <ContextMenu.Item
                  className={itemCls}
                  onSelect={() => snooze(task.id, snoozeUntil('tomorrow'))}
                >
                  Tomorrow
                </ContextMenu.Item>
                <ContextMenu.Item
                  className={itemCls}
                  onSelect={() => snooze(task.id, snoozeUntil('weekend'))}
                >
                  This weekend
                </ContextMenu.Item>
                <ContextMenu.Item
                  className={itemCls}
                  onSelect={() => snooze(task.id, snoozeUntil('nextWeek'))}
                >
                  Next week
                </ContextMenu.Item>
                {snoozed && (
                  <>
                    <ContextMenu.Separator className="my-1 h-px bg-rule" />
                    <ContextMenu.Item className={itemCls} onSelect={() => unsnooze(task.id)}>
                      Unsnooze
                    </ContextMenu.Item>
                  </>
                )}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator className="my-1 h-px bg-rule" />

          <ContextMenu.Item
            className={`${itemCls} data-[highlighted]:bg-p1/20 text-p1`}
            onSelect={() => deleteTask(task.id)}
          >
            <Trash2 size={14} />
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
