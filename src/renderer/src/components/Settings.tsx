import * as Dialog from '@radix-ui/react-dialog'
import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SettingsContext } from './settings/primitives'
import { SECTIONS } from './settings/registry'
import { matchText } from '../lib/textMatch'

/**
 * The RADAR Settings surface — a tabbed modal (left rail + search + autosave footer) wearing the
 * TERRABYTE.SYS skin. The centerpiece is the Appearance tab's theme picker. Opened from the title bar's ⚙.
 * Shape + search/autosave logic adapted from OpenEdu's Settings shell; re-skinned to RADAR's chrome.
 */
export function Settings({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  const [query, setQuery] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>()
  const contentRef = useRef<HTMLDivElement>(null)

  const markSaved = useCallback(() => {
    setSavedFlash(true)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1600)
  }, [])
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const matchingSections = useMemo(
    () => (query.trim() ? SECTIONS.filter((s) => matchText(`${s.label} ${s.keywords}`, query)) : SECTIONS),
    [query]
  )

  // If the search hides the active tab, jump to the first match.
  useEffect(() => {
    if (query.trim() && matchingSections.length && !matchingSections.some((s) => s.id === activeId)) {
      setActiveId(matchingSections[0].id)
    }
  }, [query, matchingSections, activeId])

  // Reset scroll on tab change.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [activeId])

  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]
  const ActiveComponent = active.Component
  const ctx = useMemo(() => ({ query, markSaved }), [query, markSaved])

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(600px,86vh)] w-[min(880px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col border border-phosphor/50 bg-panel shadow-glow-strong">
          {/* Header — brand mark, title, search, close */}
          <div className="flex shrink-0 items-center gap-3 border-b border-rule bg-black/40 px-4 py-2">
            <Dialog.Title className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-phosphor">
              <span className="led-dot" /> Settings
            </Dialog.Title>
            <div className="relative ml-auto w-full max-w-[280px]">
              <Search
                size={12}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
                placeholder="Search settings…"
                className="w-full border border-rule bg-lcd py-1.5 pl-7 pr-7 font-mono text-[11px] text-ink placeholder:text-faint focus:border-phosphor focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-faint hover:text-phosphor"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" className="metal-key h-6 w-6 shrink-0">
              <X size={12} />
            </button>
          </div>

          {/* Body — rail + content */}
          <div className="flex min-h-0 flex-1">
            <nav className="w-44 shrink-0 overflow-y-auto border-r border-rule bg-black/20 py-2">
              {matchingSections.length === 0 ? (
                <p className="px-3 py-2 font-mono text-[10px] text-faint">No settings match “{query}”.</p>
              ) : (
                matchingSections.map((s) => {
                  const isActive = s.id === activeId
                  return (
                    <button
                      key={s.id}
                      onClick={() => setActiveId(s.id)}
                      className={`flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                        isActive
                          ? 'border-phosphor bg-phosphor/[0.07] text-phosphor'
                          : 'border-transparent text-muted hover:bg-phosphor/[0.04] hover:text-ink'
                      }`}
                    >
                      <span className={isActive ? 'text-phosphor' : 'text-faint'}>{s.icon}</span>
                      {s.label}
                    </button>
                  )
                })
              )}
            </nav>

            <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto track-scan">
              <div className="mx-auto max-w-2xl px-6 py-5">
                <SettingsContext.Provider value={ctx}>
                  <ActiveComponent />
                </SettingsContext.Provider>
              </div>
            </div>
          </div>

          {/* Footer — autosave status */}
          <div className="shrink-0 border-t border-rule bg-black/40 px-4 py-2">
            <span
              className={`flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
                savedFlash ? 'text-phosphor-bright' : 'text-faint'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  savedFlash ? 'bg-phosphor shadow-[0_0_8px_var(--phosphor)]' : 'bg-faint'
                }`}
              />
              {savedFlash ? 'Saved ✓' : 'Changes save automatically'}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
