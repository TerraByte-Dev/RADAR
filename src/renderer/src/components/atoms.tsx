// The atoms (renderer spec 1.5, section 4): keycaps, buttons, chips, the segmented control and
// the toggle. Styles live in styles/app.css, ported from the approved mockup.
import type { KeyboardEvent, ReactNode } from 'react'

const CAP: Record<string, string> = { Enter: '↵', Up: '↑', Down: '↓', Left: '←', Right: '→' }

export function Kbd({ children }: { children: string }): JSX.Element {
  return <kbd>{CAP[children] ?? children}</kbd>
}

/** A keymap `caps` string drawn as keycaps: `Ctrl K` is two caps. */
export function Keys({ caps }: { caps: string }): JSX.Element {
  return (
    <>
      {caps.split(' ').map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </>
  )
}

export interface ButtonProps {
  /** `primary` is the one filled button on screen (section 0, rule 5). */
  variant?: 'primary' | 'ghost'
  /** 26 in toasts, banners, settings rows and the dense strip; 38 on first run. */
  size?: 'sm' | 'md' | 'lg'
  /** The keycap, drawn only while that key acts on this button. */
  caps?: string
  onClick?: () => void
  title?: string
  /** Extra classes, for a view's own layout rules. */
  className?: string
  /** A write it sent is in flight (aria-busy). */
  busy?: boolean
  /** -1 inside a listbox option, where the keys on its caps act and Tab does not stop. */
  tabIndex?: number
  children: ReactNode
}

export function Button({ variant = 'ghost', size = 'md', caps, onClick, title, className, busy, tabIndex, children }: ButtonProps): JSX.Element {
  const cls = ['btn', variant === 'primary' && 'pri', !caps && 'nk', size === 'sm' && 'sm', size === 'lg' && 'lg', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} onClick={onClick} title={title} aria-busy={busy || undefined} tabIndex={tabIndex}>
      <span>{children}</span>
      {caps && (
        <span className="flex gap-[3px]">
          <Keys caps={caps} />
        </span>
      )}
    </button>
  )
}

/** 12px mono, 1px rule, never green. `quiet` is the `--fg-3` variant (waiting, due, read-only). */
export function Chip({ quiet, title, children }: { quiet?: boolean; title?: string; children: ReactNode }): JSX.Element {
  return (
    <span className={quiet ? 'chip q' : 'chip'} title={title}>
      {children}
    </span>
  )
}

export interface SegmentedProps<T extends string> {
  label: string
  options: { value: T; label: string; caps?: string }[]
  value: T
  onChange(value: T): void
}

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }

/** A radio group: one tab stop (the checked option), and the arrows move and select. */
export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>): JSX.Element {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEP[e.key]
    if (!step) return
    // handled here, so the arrows do not also move a list behind it
    e.preventDefault()
    const i = (options.findIndex((o) => o.value === value) + step + options.length) % options.length
    onChange(options[i].value)
    e.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')[i]?.focus()
  }
  return (
    <div className="seg" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          aria-keyshortcuts={o.caps}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.caps && (
            <span aria-hidden="true" className="flex">
              <Keys caps={o.caps} />
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Green only when on; neutral (`--line-2`) when off. */
export function Toggle({ on, label, busy, onChange }: { on: boolean; label: string; busy?: boolean; onChange(on: boolean): void }): JSX.Element {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} aria-busy={busy || undefined} className={on ? 'tog' : 'tog off'} onClick={() => onChange(!on)} />
}
