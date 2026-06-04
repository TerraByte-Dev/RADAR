import * as Dialog from '@radix-ui/react-dialog'
import { FolderPlus, Plus, RotateCcw, X } from 'lucide-react'
import { useStore } from '../store/useStore'

/** Workspace settings — manage scanned roots and restore dismissed projects. */
export function Settings({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const config = useStore((s) => s.config)
  const { addWorkspaceRoot, removeWorkspaceRoot, adoptFolder, restoreProject } = useStore.getState()
  const roots = config ? config.roots.filter((r) => r !== config.workspace) : []
  const ignored = config?.ignored ?? []

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[15%] z-50 w-[min(600px,92vw)] -translate-x-1/2 border border-phosphor/50 bg-panel shadow-glow-strong">
          <Dialog.Title className="flex items-center justify-between border-b border-rule bg-black/40 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-phosphor">
            <span className="flex items-center gap-2">
              <span className="led-dot" /> Workspace
            </span>
            <button onClick={onClose} aria-label="Close" className="metal-key h-6 w-6">
              <X size={12} />
            </button>
          </Dialog.Title>

          <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
              Scanned roots
            </div>
            {config && (
              <div className="mb-1.5 truncate font-mono text-[10px] text-faint/70">
                {config.workspace} <span className="text-phosphor/60">· workspace (always)</span>
              </div>
            )}
            {roots.length === 0 ? (
              <div className="font-mono text-[11px] text-faint">
                No extra roots. Add a folder of repos to scan for BLIP.md + ghost blips.
              </div>
            ) : (
              roots.map((r) => (
                <div key={r} className="flex items-center gap-2 py-0.5">
                  <span className="flex-1 truncate font-mono text-[11px] text-ink">{r}</span>
                  <button
                    onClick={() => removeWorkspaceRoot(r)}
                    aria-label="Remove root"
                    title="Stop scanning this root"
                    className="shrink-0 text-faint hover:text-p1"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={addWorkspaceRoot}
                className="inline-flex items-center gap-1 border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-faint hover:border-phosphor hover:text-phosphor"
              >
                <Plus size={11} /> Add root
              </button>
              <button
                onClick={adoptFolder}
                className="inline-flex items-center gap-1 border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-faint hover:border-phosphor hover:text-phosphor"
              >
                <FolderPlus size={11} /> Adopt folder
              </button>
            </div>

            {ignored.length > 0 && (
              <div className="mt-5">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                  Dismissed
                </div>
                {ignored.map((p) => (
                  <div key={p} className="flex items-center gap-2 py-0.5">
                    <span className="flex-1 truncate font-mono text-[11px] text-muted">{p}</span>
                    <button
                      onClick={() => restoreProject(p)}
                      aria-label="Restore"
                      title="Put back on the radar"
                      className="shrink-0 text-faint hover:text-phosphor"
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
