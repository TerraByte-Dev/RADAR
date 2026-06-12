import { FolderPlus, Plus, RotateCcw, X } from 'lucide-react'
import { useStore } from '../../../store/useStore'
import { Section } from '../primitives'

/** Manage where RADAR scans for BLIP.md projects + restore dismissed ones. (Ported from the old dialog.) */
export default function Workspace(): JSX.Element {
  const config = useStore((s) => s.config)
  const { addWorkspaceRoot, removeWorkspaceRoot, adoptFolder, restoreProject } = useStore.getState()
  const roots = config ? config.roots.filter((r) => r !== config.workspace) : []
  const ignored = config?.ignored ?? []

  return (
    <>
      <Section
        title="Scanned roots"
        description="Folders RADAR scans for BLIP.md projects (and ghost repos to adopt). The app workspace is always scanned."
        keywords="workspace roots scan folder repo ghost adopt blip directory path"
      >
        <div className="border border-rule bg-panelLite/60 px-4 py-3">
          {config && (
            <div className="mb-2 truncate font-mono text-[11px] text-faint/80">
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
          <div className="mt-3 flex gap-1.5">
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
        </div>
      </Section>

      {ignored.length > 0 && (
        <Section
          title="Dismissed"
          description="Projects you removed from the radar. Restore one to put it back on the scope."
          keywords="dismissed ignored hidden restore project ghost"
        >
          <div className="border border-rule bg-panelLite/60 px-4 py-3">
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
        </Section>
      )}
    </>
  )
}
