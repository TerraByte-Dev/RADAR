import { useStore } from '../../../store/useStore'
import { Section, SettingRow, SegmentedControl, useSettings } from '../primitives'

const NEGLECT_OPTIONS = [
  { id: '14', label: '14d' },
  { id: '30', label: '30d' },
  { id: '60', label: '60d' },
  { id: '90', label: '90d' }
]

/** Radar behavior knobs — currently the neglected-projects threshold. */
export default function Radar(): JSX.Element {
  const { markSaved } = useSettings()
  const neglectedDays = useStore((s) => s.neglectedDays)
  const { setNeglectedDays } = useStore.getState()

  // Snap the stored value onto the nearest preset for the segmented control's active state.
  const current = NEGLECT_OPTIONS.reduce((best, o) =>
    Math.abs(Number(o.id) - neglectedDays) < Math.abs(Number(best.id) - neglectedDays) ? o : best
  ).id

  return (
    <Section
      title="Behavior"
      description="How the radar flags projects that need attention."
      keywords="radar behavior neglected stale threshold attention safety net days"
    >
      <SettingRow
        label="Neglected after"
        help="How long a project can go untouched before it counts as neglected — shown in the NOW attention panel, the Neglected list, and the sidebar count."
        keywords="neglected stale threshold days untouched last session"
      >
        <SegmentedControl
          options={NEGLECT_OPTIONS}
          value={current}
          onChange={(id) => {
            setNeglectedDays(Number(id))
            markSaved()
          }}
        />
      </SettingRow>
    </Section>
  )
}
