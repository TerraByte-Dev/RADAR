// Small, app-agnostic building blocks for the Settings surface, wearing the TERRABYTE.SYS skin. Styling
// is pure design-system tokens (styles/index.css), so every primitive re-themes for free under the color
// themes. Adapted from the OpenEdu settings primitives, re-skinned to RADAR's terminal chrome.

import { createContext, useContext, useState, type ReactNode } from 'react'
import { matchText } from '../../lib/textMatch'

// ── Shared context: live search query + a "something just saved" pulse ──────────────────────────────────
export interface SettingsCtx {
  query: string
  markSaved: () => void
}
export const SettingsContext = createContext<SettingsCtx>({ query: '', markSaved: () => {} })

export function useSettings(): SettingsCtx {
  return useContext(SettingsContext)
}

export { matchText }

/** Shared text/number/url input styling — an LCD-inset field. */
export const INPUT_CLS =
  'w-full bg-lcd border border-rule px-3 py-2 font-mono text-[12px] text-ink ' +
  'focus:outline-none focus:border-phosphor transition-colors placeholder:text-faint'

// ── Section: a titled group inside a tab. Self-hides when a search query matches neither it nor its keywords.
export function Section({
  title,
  description,
  keywords = '',
  children,
  right
}: {
  title: string
  description?: string
  keywords?: string
  children: ReactNode
  right?: ReactNode
}): JSX.Element | null {
  const { query } = useSettings()
  if (query && !matchText(`${title} ${description ?? ''} ${keywords}`, query)) return null
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 max-w-prose font-mono text-[11px] leading-relaxed text-faint">
              {description}
            </p>
          )}
        </div>
        {right}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

// ── SettingRow: label + help on top, control below, inside a card. Self-hides on search miss.
export function SettingRow({
  label,
  help,
  keywords = '',
  children
}: {
  label: string
  help?: ReactNode
  keywords?: string
  children: ReactNode
}): JSX.Element | null {
  const { query } = useSettings()
  const helpText = typeof help === 'string' ? help : ''
  if (query && !matchText(`${label} ${helpText} ${keywords}`, query)) return null
  return (
    <div className="border border-rule bg-panelLite/60 px-4 py-3">
      <div className="mb-2.5">
        <div className="font-mono text-[12px] text-ink">{label}</div>
        {help && <div className="mt-1 max-w-prose font-mono text-[11px] leading-relaxed text-faint">{help}</div>}
      </div>
      {children}
    </div>
  )
}

// ── Toggle: a phosphor switch ───────────────────────────────────────────────────────────────────────────
export function Toggle({
  checked,
  onChange,
  disabled,
  labelOn,
  labelOff
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  labelOn?: string
  labelOff?: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`group flex items-center gap-3 ${disabled ? 'cursor-default opacity-50' : ''}`}
    >
      <span
        className={`relative h-[20px] w-[38px] shrink-0 rounded-full border transition-colors ${
          checked ? 'border-phosphor bg-phosphor/25' : 'border-rule bg-panel'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all ${
            checked ? 'left-[20px] bg-phosphor shadow-[0_0_8px_var(--phosphor-faint)]' : 'left-[2px] bg-faint'
          }`}
        />
      </span>
      {(labelOn || labelOff) && (
        <span className="font-mono text-[11px] text-muted transition-colors group-hover:text-ink">
          {checked ? labelOn : labelOff}
        </span>
      )}
    </button>
  )
}

// ── SegmentedControl: a row of mutually-exclusive pills ─────────────────────────────────────────────────
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (next: T) => void
}): JSX.Element {
  return (
    <div className="inline-flex flex-wrap gap-0.5 border border-rule bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
            value === o.id
              ? 'bg-phosphor/15 text-phosphor'
              : 'text-muted hover:bg-phosphor/[0.06] hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── ActionButton: a labelled action with a transient busy state ─────────────────────────────────────────
export function ActionButton({
  onClick,
  children,
  primary,
  busyLabel
}: {
  onClick: () => Promise<void> | void
  children: ReactNode
  primary?: boolean
  busyLabel?: string
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await onClick()
        } finally {
          setBusy(false)
        }
      }}
      className={`inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors disabled:opacity-50 ${
        primary
          ? 'border-phosphor text-phosphor hover:bg-phosphor/10'
          : 'border-rule text-muted hover:border-phosphor hover:text-phosphor'
      }`}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}
