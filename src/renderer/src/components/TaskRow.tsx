import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronRight, Moon, Star } from 'lucide-react'
import type { Task } from '@shared/types'
import { formatDue, formatTimestamp, isOverdue } from '../lib/date'
import { isSnoozed } from '../lib/selectors'
import { useStore } from '../store/useStore'
import { PriorityFlag } from './PriorityFlag'
import { TagChip } from './TagChip'
import { TaskContextMenu } from './TaskContextMenu'
import { TaskDetail } from './TaskDetail'

interface Props {
  task: Task
  projectName?: string
  projectColor?: string
  /** Hide the project chip (e.g. when already inside that project's view). */
  hideProject?: boolean
  /** Dim the row (e.g. future-dated tasks in the merged Today "horizon" tail). */
  faded?: boolean
}

export function TaskRow({ task, projectName, projectColor, hideProject, faded }: Props): JSX.Element {
  const selected = useStore((s) => s.selectedTaskId === task.id)
  const expanded = useStore((s) => s.expandedTaskId === task.id)
  const { toggleExpanded, toggleComplete, toggleStar } = useStore.getState()
  const overdue = isOverdue(task.due) && !task.completed
  const snoozed = isSnoozed(task)
  const doneSubs = task.subtasks.filter((s) => s.completed).length

  return (
    <TaskContextMenu task={task}>
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className={`border-l-2 transition-colors ${
          selected
            ? 'border-phosphor bg-phosphor/[0.07]'
            : 'border-transparent hover:bg-phosphor/[0.03]'
        } ${task.completed ? 'opacity-60' : faded ? 'opacity-50' : ''}`}
      >
        <div
          onClick={() => toggleExpanded(task.id)}
          className="group flex cursor-default items-start gap-2.5 px-3 py-2.5"
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleExpanded(task.id)
            }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            className="mt-0.5 shrink-0 text-faint transition-transform hover:text-phosphor"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          >
            <ChevronRight size={14} />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleComplete(task.id)
            }}
            aria-label={task.completed ? 'Mark incomplete' : 'Complete task'}
            className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border transition-all ${
              task.completed
                ? 'border-phosphor bg-phosphor text-black shadow-glow'
                : 'border-faint hover:border-phosphor hover:shadow-glow'
            }`}
          >
            {task.completed && <Check size={12} strokeWidth={3} />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`truncate font-mono text-[13px] leading-snug ${
                  task.completed ? 'text-faint line-through' : selected ? 'text-phosphor' : 'text-ink'
                }`}
              >
                {task.title}
              </span>
              <PriorityFlag priority={task.priority} />
            </div>

            {(task.due ||
              task.tags.length > 0 ||
              snoozed ||
              task.subtasks.length > 0 ||
              (!hideProject && projectName)) && (
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.04em]">
                {task.due && (
                  <span className={overdue ? 'text-p1' : 'text-muted'}>
                    {overdue && '▸ '}
                    {formatDue(task.due)}
                  </span>
                )}
                {snoozed && task.snoozedUntil && (
                  <span className="flex items-center gap-1 text-muted">
                    <Moon size={11} /> {formatTimestamp(task.snoozedUntil)}
                  </span>
                )}
                {task.subtasks.length > 0 && (
                  <span className="text-muted">
                    [{doneSubs}/{task.subtasks.length}]
                  </span>
                )}
                {!hideProject && projectName && (
                  <span className="flex items-center gap-1 text-muted">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: projectColor }}
                    />
                    {projectName}
                  </span>
                )}
                {task.tags.map((t) => (
                  <TagChip key={t} tag={t} />
                ))}
              </div>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleStar(task.id)
            }}
            aria-label={task.starred ? 'Unstar' : 'Star (mark active)'}
            className={`mt-0.5 shrink-0 transition-opacity ${
              task.starred
                ? 'text-term-amber opacity-100'
                : 'text-faint opacity-0 hover:text-phosphor group-hover:opacity-100'
            }`}
          >
            <Star size={15} fill={task.starred ? 'currentColor' : 'none'} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <TaskDetail task={task} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </TaskContextMenu>
  )
}
