import { Section, SettingRow } from '../primitives'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
const MOD = isMac ? '⌘' : 'Ctrl'

/** A single shortcut row: label + one or more key combos. */
function Keys({ combos }: { combos: string[][] }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {combos.map((combo, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="px-1 font-mono text-[10px] text-faint">or</span>}
          {combo.map((k) => (
            <kbd
              key={k}
              className="metal-key min-w-[22px] px-1.5 py-0.5 font-mono text-[11px] text-phosphor-ink"
            >
              {k}
            </kbd>
          ))}
        </span>
      ))}
    </div>
  )
}

/** A static keyboard reference (rebinding is a future enhancement). */
export default function Keyboard(): JSX.Element {
  const rows: { label: string; help: string; combos: string[][]; keywords: string }[] = [
    {
      label: 'Command palette',
      help: 'Jump to any view or action.',
      combos: [[MOD, 'K']],
      keywords: 'command palette search actions cmdk'
    },
    {
      label: 'Quick capture',
      help: 'Add a task or project. #project routes to that repo, else the Inbox.',
      combos: [['Q'], [MOD, 'N']],
      keywords: 'quick add capture task inbox new'
    },
    {
      label: 'Quick capture (global)',
      help: 'Open capture from anywhere, even when RADAR is in the background.',
      combos: [[MOD, 'Shift', 'Space']],
      keywords: 'global hotkey quick add capture anywhere'
    },
    {
      label: 'Close / deselect',
      help: 'Close a dialog, the detail panel, or deselect the current blip.',
      combos: [['Esc']],
      keywords: 'escape close deselect cancel'
    }
  ]

  return (
    <Section
      title="Shortcuts"
      description="Keyboard control for the things you do most. Rebinding is coming later."
      keywords="keyboard shortcuts keys hotkey palette quick add capture escape"
    >
      {rows.map((r) => (
        <SettingRow key={r.label} label={r.label} help={r.help} keywords={r.keywords}>
          <Keys combos={r.combos} />
        </SettingRow>
      ))}
    </Section>
  )
}
