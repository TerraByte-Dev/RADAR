// The three inline glyphs (renderer spec 1.4): a 12px box, 1.25px stroke, currentColor
// (`--fg-3`), each with a title.
import type { ReactNode } from 'react'

function Glyph({ label, title, children }: { label: string; title: string; children: ReactNode }): JSX.Element {
  return (
    <svg className="src" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
      <title>{title}</title>
      {children}
    </svg>
  )
}

/** `activity.source === 'git'` */
export const GitGlyph = (): JSX.Element => (
  <Glyph label="from git" title="From git">
    <circle cx="3" cy="2.6" r="1.5" />
    <circle cx="3" cy="9.4" r="1.5" />
    <circle cx="9" cy="4" r="1.5" />
    <path d="M3 4.1v3.8M9 5.5c0 2.4-6 .7-6 2.4" />
  </Glyph>
)

/** `activity.source === 'files'` */
export const FilesGlyph = (): JSX.Element => (
  <Glyph label="from file times" title="From file times: this folder is not a git repo">
    <path d="M2.5 1.2h4.6l2.4 2.4v7.2h-7z" />
    <path d="M7 1.4v2.4h2.4" />
  </Glyph>
)

/** `activity.unlogged`: three lines, the last one dotted. */
export const LagGlyph = (): JSX.Element => (
  <Glyph label="log is behind" title="The log is behind the work">
    <path d="M2 3h8M2 6h8" />
    <path d="M2 9h1M5 9h1M8 9h1" />
  </Glyph>
)

/** The ring logo: the corner brackets are the top bar's only green. */
export const Logo = (): JSX.Element => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="8" fill="none" stroke="var(--fg-3)" />
    <circle cx="9" cy="9" r="4.2" fill="none" stroke="var(--line-2)" />
    <path d="M4.5 6.2V4.5H6.2M11.8 4.5H13.5V6.2M13.5 11.8V13.5H11.8M6.2 13.5H4.5V11.8" fill="none" stroke="var(--acc)" strokeWidth="1.3" />
    <circle cx="9" cy="9" r="1.7" fill="var(--fg)" />
  </svg>
)
