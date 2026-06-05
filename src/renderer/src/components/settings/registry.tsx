import { FolderSearch, Keyboard as KeyboardIcon, Palette } from 'lucide-react'
import type { SectionDef } from './types'
import Appearance from './sections/Appearance'
import Workspace from './sections/Workspace'
import Keyboard from './sections/Keyboard'

/**
 * The Settings tabs, in rail order. Each `keywords` bag must cover its section's rows so the search box
 * surfaces them. Adding a tab = one entry here + a `sections/X.tsx` default-exporting a component built
 * from the primitives.
 */
export const SECTIONS: SectionDef[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    keywords: 'appearance theme color crt scanlines glow phosphor amber green dark light skin font look',
    icon: <Palette size={14} />,
    Component: Appearance
  },
  {
    id: 'workspace',
    label: 'Workspace',
    keywords: 'workspace roots scan folder repo ghost adopt blip dismissed restore path',
    icon: <FolderSearch size={14} />,
    Component: Workspace
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    keywords: 'keyboard shortcuts keys hotkey palette quick add capture escape',
    icon: <KeyboardIcon size={14} />,
    Component: Keyboard
  }
]
