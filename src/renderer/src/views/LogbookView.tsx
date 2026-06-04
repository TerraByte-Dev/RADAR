import { useMemo } from 'react'
import { buildLogbook } from '../lib/selectors'
import { categoryColor } from '../lib/projectRadar'
import { useStore } from '../store/useStore'

export function LogbookView(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const setView = useStore((s) => s.setView)
  const setSelectedBlip = useStore((s) => s.setSelectedBlip)
  const days = useMemo(() => buildLogbook(projects), [projects])
  const catByPath = useMemo(
    () => new Map(projects.map((p) => [p.blipPath, p.category])),
    [projects]
  )

  function open(blipPath: string): void {
    setView({ kind: 'radar' })
    setSelectedBlip(blipPath)
  }

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
              Session handoffs from <span className="text-phosphor">/blip</span> gather here, across every
              project.
            </span>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-7 pt-2">
            {days.map((day) => (
              <section key={day.key}>
                <h2 className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.16em] text-phosphor/70">
                  {day.heading}
                </h2>
                <div className="relative ml-3 space-y-4 border-l border-rule py-1 pl-6">
                  {day.items.map((item, i) => {
                    const color = categoryColor(catByPath.get(item.blipPath) ?? '')
                    return (
                      <div key={`${item.blipPath}-${i}`} className="relative">
                        <span
                          className="absolute -left-[1.6rem] top-[6px] h-2 w-2 rounded-full ring-2 ring-bg"
                          style={{ background: color }}
                        />
                        <button
                          onClick={() => open(item.blipPath)}
                          className="font-mono text-[12px] uppercase tracking-[0.06em] text-ink hover:text-phosphor"
                        >
                          {item.projectName}
                        </button>
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                          {item.entry.author}
                        </span>
                        <div className="mt-0.5">
                          {item.entry.lines.map((l, j) => (
                            <div key={j} className="font-mono text-[12px] leading-snug text-muted">
                              – {l}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
