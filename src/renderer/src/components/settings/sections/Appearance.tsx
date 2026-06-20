import { THEMES, applyTheme, setCrtOff, themeSupportsCrt } from '../../../lib/theme'
import { useThemeState } from '../../../lib/useTheme'
import { Section, SettingRow, Toggle, useSettings } from '../primitives'

/** The headline tab: a theme swatch grid + the CRT scanline toggle. */
export default function Appearance(): JSX.Element {
  const { markSaved } = useSettings()
  // Live theme/CRT state via the shared hook — stays in sync when the title bar toggles CRT, etc.
  const { themeId, crtOff } = useThemeState()

  const pickTheme = (id: string): void => {
    applyTheme(id) // dispatches radar-theme-change → useThemeState updates themeId + the canvas recolors
    markSaved()
  }

  const crtTheme = themeSupportsCrt(themeId)

  return (
    <>
      <Section
        title="Theme"
        description="Recolor the CRT skin, or switch to a clean Dark/Light theme that drops the scanlines entirely. Applies instantly and is remembered."
        keywords="theme color appearance crt amber green ice synthwave vapor tangerine crimson ultraviolet dark light phosphor scanlines look skin"
      >
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {THEMES.map((t) => {
            const active = themeId === t.id
            return (
              <button
                key={t.id}
                onClick={() => pickTheme(t.id)}
                className={`border p-2.5 text-left transition-colors ${
                  active
                    ? 'border-phosphor bg-phosphor/[0.08]'
                    : 'border-rule bg-panelLite/60 hover:border-faint'
                }`}
              >
                {/* Swatch preview */}
                <div
                  className="mb-2.5 overflow-hidden border border-rule"
                  style={{ background: t.swatch.bg }}
                >
                  <div className="flex h-14 items-center gap-2 px-3">
                    <span
                      className="h-6 w-6 shrink-0 rounded-full"
                      style={{ background: t.swatch.accent, boxShadow: `0 0 10px ${t.swatch.accent}` }}
                    />
                    <div className="flex-1 space-y-1.5">
                      <span
                        className="block h-2 rounded-full"
                        style={{ background: t.swatch.accent, opacity: 0.85, width: '70%' }}
                      />
                      <span
                        className="block h-2 rounded-full"
                        style={{ background: t.swatch.ink, opacity: 0.55, width: '90%' }}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 ${
                      active ? 'border-phosphor' : 'border-rule'
                    }`}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-phosphor" />}
                  </span>
                  <span
                    className={`font-mono text-[12px] ${active ? 'text-phosphor-bright' : 'text-ink'}`}
                  >
                    {t.name}
                  </span>
                  <span className="ml-auto border border-rule px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                    {t.family === 'crt' ? 'CRT' : 'Clean'}
                  </span>
                </div>
                <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-faint">{t.blurb}</p>
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        title="CRT Effect"
        description="The scanlines, grid, glow, and vignette overlay. Available on CRT themes; the Dark/Light themes turn it off automatically."
        keywords="crt scanlines glow vignette effect overlay motion retro grid"
      >
        <SettingRow
          label="Scanline overlay"
          help={
            crtTheme
              ? 'Toggle the retro CRT overlay for the current theme. The title-bar monitor button is the shortcut.'
              : 'The current theme is a clean theme — the CRT overlay is off.'
          }
        >
          <Toggle
            checked={crtTheme ? !crtOff : false}
            disabled={!crtTheme}
            onChange={(on) => {
              if (!crtTheme) return
              setCrtOff(!on)
              markSaved()
            }}
            labelOn="On — full scanlines + glow"
            labelOff={crtTheme ? 'Off — flat, maximum readability' : 'Off (clean theme)'}
          />
        </SettingRow>
      </Section>
    </>
  )
}
