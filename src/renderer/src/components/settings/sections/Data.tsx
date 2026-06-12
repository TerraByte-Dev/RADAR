import { useRef, useState } from 'react'
import { Download, RotateCcw, Upload } from 'lucide-react'
import { applyTheme, getCrtOff, getThemeId, setCrtOff } from '../../../lib/theme'
import {
  buildSettingsExport,
  isKnownThemeId,
  parseSettingsExport,
  serializeSettings
} from '../../../lib/settingsSchema'
import { useStore } from '../../../store/useStore'
import { ActionButton, Section, SettingRow, useSettings } from '../primitives'

/** Export / import the UI preferences (theme + CRT + behavior), and reset the radar layout. */
export default function Data(): JSX.Element {
  const { markSaved } = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const exportNow = (): void => {
    const s = useStore.getState()
    const payload = buildSettingsExport(
      getThemeId(),
      getCrtOff(),
      { showCompleted: s.showCompleted, neglectedDays: s.neglectedDays },
      new Date().toISOString()
    )
    const blob = new Blob([serializeSettings(payload)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `radar-settings-${payload.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus({ ok: true, msg: 'Exported.' })
    markSaved()
  }

  const importText = (text: string): void => {
    try {
      const p = parseSettingsExport(text)
      const s = useStore.getState()
      // Apply CRT first so applyTheme's reconciliation honors the imported preference.
      setCrtOff(p.crtOff)
      if (isKnownThemeId(p.theme)) applyTheme(p.theme)
      s.setNeglectedDays(p.settings.neglectedDays)
      if (p.settings.showCompleted !== s.showCompleted) s.toggleShowCompleted()
      setStatus({ ok: true, msg: isKnownThemeId(p.theme) ? 'Settings imported.' : 'Imported (unknown theme skipped).' })
      markSaved()
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : 'Import failed.' })
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file) return
    importText(await file.text())
  }

  const resetLayout = async (): Promise<void> => {
    await useStore.getState().resetRadarLayout()
    setStatus({ ok: true, msg: 'Radar layout reset — pinned angles cleared.' })
  }

  return (
    <>
      <Section
        title="Backup"
        description="Export your appearance + behavior preferences to a file, or import them on another machine. (Workspace roots are managed separately and stay local.)"
        keywords="data export import backup settings file json theme preferences transfer"
      >
        <SettingRow
          label="Settings file"
          help="A small JSON file with your theme, CRT preference, and radar behavior knobs."
        >
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton onClick={exportNow}>
              <Download size={11} /> Export…
            </ActionButton>
            <ActionButton onClick={() => fileRef.current?.click()}>
              <Upload size={11} /> Import…
            </ActionButton>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
            {status && (
              <span className={`font-mono text-[11px] ${status.ok ? 'text-phosphor' : 'text-p1'}`}>
                {status.ok ? '✓ ' : '✗ '}
                {status.msg}
              </span>
            )}
          </div>
        </SettingRow>
      </Section>

      <Section
        title="Radar layout"
        description="Clear every manually pinned blip angle and let the radar auto-arrange again."
        keywords="radar layout reset pins angle pinned rearrange"
      >
        <SettingRow label="Reset pinned positions" help="Removes all drag-pinned angles across every project (visual only — dates and tasks are untouched).">
          <ActionButton onClick={resetLayout} busyLabel="Resetting…">
            <RotateCcw size={11} /> Reset radar layout
          </ActionButton>
        </SettingRow>
      </Section>
    </>
  )
}
