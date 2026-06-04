import { FolderPlus, Plus } from 'lucide-react'
import { useStore } from '../store/useStore'

/** First-run welcome — points RADAR at where the user's projects live, then dismisses for good. */
export function Onboarding(): JSX.Element {
  const { addWorkspaceRoot, adoptFolder, finishOnboarding } = useStore.getState()

  const then =
    (fn?: () => Promise<void>) =>
    async (): Promise<void> => {
      if (fn) await fn()
      finishOnboarding()
    }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-[2px]">
      <div className="w-[min(560px,92vw)] border border-phosphor/50 bg-panel shadow-glow-strong">
        <div className="flex items-center gap-2 border-b border-rule bg-black/40 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-phosphor">
          <span className="led-dot" /> Welcome to RADAR
        </div>
        <div className="px-5 py-4">
          <p className="font-mono text-[12px] leading-relaxed text-muted">
            RADAR plots every project you're working on as a <span className="text-phosphor">blip</span>,
            fed by a plain <span className="text-phosphor">BLIP.md</span> file your AI coding agent keeps
            current via <span className="text-phosphor">/blip</span>. Point it at where your projects live:
          </p>

          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={then(addWorkspaceRoot)}
              className="group flex items-center gap-3 border border-rule bg-phosphor/[0.03] px-3 py-2.5 text-left transition-colors hover:border-phosphor hover:bg-phosphor/[0.08]"
            >
              <Plus size={16} className="shrink-0 text-phosphor" />
              <span className="min-w-0">
                <span className="block font-mono text-[12px] uppercase tracking-[0.06em] text-ink">
                  Add a workspace root
                </span>
                <span className="block font-mono text-[10px] text-faint">
                  scan a folder of repos for BLIP.md + ghost blips
                </span>
              </span>
            </button>
            <button
              onClick={then(adoptFolder)}
              className="group flex items-center gap-3 border border-rule bg-phosphor/[0.03] px-3 py-2.5 text-left transition-colors hover:border-phosphor hover:bg-phosphor/[0.08]"
            >
              <FolderPlus size={16} className="shrink-0 text-phosphor" />
              <span className="min-w-0">
                <span className="block font-mono text-[12px] uppercase tracking-[0.06em] text-ink">
                  Adopt a single project
                </span>
                <span className="block font-mono text-[10px] text-faint">create its BLIP.md now</span>
              </span>
            </button>
          </div>

          <div className="mt-4 border-t border-rule pt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Install the /blip skill (Claude Code + Codex)
            </div>
            <code className="mt-1 block select-all bg-lcd px-2 py-1.5 font-mono text-[11px] text-ink">
              npm i -g radar-blip && radar-blip skills install
            </code>
          </div>

          <button
            onClick={then()}
            className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-phosphor"
          >
            skip for now →
          </button>
        </div>
      </div>
    </div>
  )
}
