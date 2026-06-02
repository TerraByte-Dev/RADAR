import { useMemo } from 'react'
import type { ActivityKind } from '@shared/types'
import { formatClock } from '../lib/date'
import { buildLogbook } from '../lib/selectors'
import { useStore } from '../store/useStore'

const VERB: Record<Exclude<ActivityKind, 'note' | 'created'>, string> = {
  completed: 'Completed',
  reopened: 'Reopened',
  rescheduled: 'Rescheduled',
  snoozed: 'Snoozed'
}

const DOT: Record<ActivityKind, string> = {
  completed: 'bg-phosphor',
  note: 'bg-term-cyan',
  rescheduled: 'bg-faint',
  snoozed: 'bg-faint',
  reopened: 'bg-faint',
  created: 'bg-faint'
}

export function LogbookView(): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const days = useMemo(() => buildLogbook(tasks), [tasks])

  return (
    <main className="relative flex h-full flex-1 flex-col bg-bg">
      <header className="drag-region flex items-center gap-3 px-9 pb-3 pt-5">
        <span className="font-term text-2xl leading-none text-phosphor">{'>'}</span>
        <h1 className="font-term text-3xl uppercase tracking-wide text-phosphor phosphor-glow">
          Logbook
        </h1>
      </header>

      <div className="track-scan flex-1 overflow-y-auto px-6 pb-12">
        {days.length === 0 ? (
          <div className="mt-24 text-center font-mono text-xs uppercase tracking-[0.12em] text-faint">
            {'// logbook empty'}
            <br />
            <span className="mt-2 inline-block normal-case tracking-normal">
              Completed tasks and follow-up notes gather here.
            </span>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-7 pt-2">
            {days.map((day) => (
              <section key={day.key}>
                <h2 className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.16em] text-phosphor/70">
                  {day.heading}
                </h2>
                <div className="relative ml-3 space-y-3 border-l border-rule py-1 pl-6">
                  {day.items.map(({ entry, taskTitle }) => (
                    <div key={entry.id} className="relative">
                      <span
                        className={`absolute -left-[1.6rem] top-[7px] h-2 w-2 rounded-full ring-2 ring-bg ${DOT[entry.kind]}`}
                      />
                      <div className="flex gap-3 font-mono text-[13px] leading-snug">
                        <span className="w-14 shrink-0 pt-px text-right text-xs text-faint">
                          {formatClock(entry.ts)}
                        </span>
                        <div className="flex-1">
                          {entry.kind === 'note' ? (
                            <>
                              <span className="text-ink">{entry.text}</span>
                              <span className="ml-1.5 text-faint">— {taskTitle}</span>
                            </>
                          ) : (
                            <>
                              <span className="uppercase tracking-[0.06em] text-muted">
                                {VERB[entry.kind as keyof typeof VERB]}
                              </span>{' '}
                              <span className="text-ink">{taskTitle}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
