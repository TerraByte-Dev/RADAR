import { useStore } from '../../../store/useStore'
import { Section, SettingRow, SegmentedControl, Toggle, useSettings } from '../primitives'

const NEGLECT_OPTIONS = [
  { id: '14', label: '14d' },
  { id: '30', label: '30d' },
  { id: '60', label: '60d' },
  { id: '90', label: '90d' }
]

/** Radar behavior knobs — the neglected-projects threshold and task-list display. */
export default function Radar(): JSX.Element {
  const { markSaved } = useSettings()
  const neglectedDays = useStore((s) => s.neglectedDays)
  const showCompleted = useStore((s) => s.showCompleted)
  const { setNeglectedDays, toggleShowCompleted } = useStore.getState()

  // Snap the stored value onto the nearest preset for the segmented control's active state.
  const current = NEGLECT_OPTIONS.reduce((best, o) =>
    Math.abs(Number(o.id) - neglectedDays) < Math.abs(Number(best.id) - neglectedDays) ? o : best
  ).id

  return (
    <Section
      title="Behavior"
      description="How the radar flags projects that need attention, and how task lists display."
      keywords="radar behavior neglected stale threshold attention safety net days completed tasks"
    >
      <SettingRow
        label="Neglected after"
        help="How long a project can go untouched before it counts as neglected — shown in the NOW attention panel, the Neglected list, and the sidebar count. A project that is scheduled (its own deadline, or a task with a (due …)) or paused/shipped/archived never counts, however long it has been."
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
      <SettingRow
        label="Show completed tasks"
        help="When off, checked-off tasks are hidden from a project's task list in the detail panel (the count still includes them)."
        keywords="show completed done tasks hide checklist detail panel"
      >
        <Toggle
          checked={showCompleted}
          onChange={() => {
            toggleShowCompleted()
            markSaved()
          }}
          labelOn="Shown"
          labelOff="Hidden"
        />
      </SettingRow>
    </Section>
  )
}
