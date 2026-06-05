import {
  Database,
  FolderSearch,
  Info,
  Keyboard as KeyboardIcon,
  Palette,
  Radar as RadarIcon
} from 'lucide-react'
import type { SectionDef } from './types'
import Appearance from './sections/Appearance'
import Radar from './sections/Radar'
import Workspace from './sections/Workspace'
import Keyboard from './sections/Keyboard'
import Data from './sections/Data'
import About from './sections/About'

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
    id: 'radar',
    label: 'Radar',
    keywords: 'radar behavior neglected stale threshold attention safety net days',
    icon: <RadarIcon size={14} />,
    Component: Radar
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
  },
  {
    id: 'data',
    label: 'Data',
    keywords: 'data export import backup settings file json reset radar layout pins',
    icon: <Database size={14} />,
    Component: Data
  },
  {
    id: 'about',
    label: 'About',
    keywords: 'about version updates check download install repository terrabyte',
    icon: <Info size={14} />,
    Component: About
  }
]
