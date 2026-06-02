import * as ContextMenu from '@radix-ui/react-context-menu'
import { Pencil, Palette, Trash2, Check } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Project } from '@shared/types'
import { PROJECT_COLORS } from '../lib/palette'
import { useStore } from '../store/useStore'

const itemCls =
  'flex cursor-default items-center gap-2 rounded-sm px-2.5 py-1.5 font-mono text-[12px] uppercase ' +
  'tracking-[0.04em] text-ink outline-none data-[highlighted]:bg-phosphor/10 data-[highlighted]:text-phosphor'
const contentCls = 'z-50 min-w-[180px] border border-phosphor/30 bg-panel p-1 shadow-glow'

export function ProjectContextMenu({
  project,
  onRename,
  children
}: {
  project: Project
  onRename: () => void
  children: ReactNode
}): JSX.Element {
  const { recolorProject, deleteProject } = useStore.getState()

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={contentCls}>
          <ContextMenu.Item className={itemCls} onSelect={onRename}>
            <Pencil size={14} className="text-muted" />
            Rename
          </ContextMenu.Item>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={itemCls}>
              <Palette size={14} className="text-muted" />
              Color
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={`${contentCls} min-w-0`}>
                <div className="grid grid-cols-4 gap-1 p-1">
                  {PROJECT_COLORS.map((c) => (
                    <ContextMenu.Item
                      key={c}
                      className="flex h-7 w-7 cursor-default items-center justify-center rounded-sm outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-phosphor"
                      onSelect={() => recolorProject(project.id, c)}
                    >
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full"
                        style={{ backgroundColor: c }}
                      >
                        {project.color === c && (
                          <Check size={12} strokeWidth={3} className="text-bg" />
                        )}
                      </span>
                    </ContextMenu.Item>
                  ))}
                </div>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator className="my-1 h-px bg-rule" />

          <ContextMenu.Item
            className={`${itemCls} text-p1 data-[highlighted]:bg-p1/20`}
            onSelect={() => deleteProject(project.id)}
          >
            <Trash2 size={14} />
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
