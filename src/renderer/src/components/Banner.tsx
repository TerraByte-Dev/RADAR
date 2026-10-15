// The banner (renderer spec 4, 8): one line across the top of a page or a view that says why
// something is not as usual, with its few buttons at the right. A read-only file's page leads with
// one: a file that cannot be parsed, one written by a newer RADAR, or one still in the v2 format.
import type { ReactNode } from 'react'
import type { Problem, ProjectRecord } from '@shared/model'
import { openEditor } from '../lib/projectActions'
import { useShell } from '../store/shell'
import { Button } from './atoms'

const InfoIcon = (): JSX.Element => (
  <svg className="bi" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <circle cx="7" cy="7" r="6" />
    <path d="M7 4v3.5M7 9.6v.4" />
  </svg>
)

export function Banner({
  children,
  actions,
  icon = true,
  role
}: {
  children: ReactNode
  actions?: ReactNode
  icon?: boolean
  role?: 'alert' | 'status'
}): JSX.Element {
  return (
    <div className="banner" role={role}>
      {icon && <InfoIcon />}
      <span>{children}</span>
      <span className="sp" />
      {actions}
    </div>
  )
}

/** The problem a file that cannot be parsed is shown with: its first error, else its first problem. */
export const repairProblem = (r: ProjectRecord): Problem | null => r.doc?.problems.find((p) => p.severity === 'error') ?? r.doc?.problems[0] ?? null

/**
 * `Line 7: a mapping value is not allowed here`, or the message alone when it has no line. The
 * engine's own `; the file is read-only until it is fixed` is dropped (the sentence after it says
 * so), and so are the YAML library's `at line 6, column 8:`, which counts from the frontmatter and
 * would contradict the line in front.
 */
export const problemLine = (p: Problem | null): string =>
  p
    ? `${p.line ? `Line ${p.line}: ` : ''}${p.message
        .replace(/; the file is read-only until it is fixed$/, '')
        .replace(/ at line \d+, column \d+:?(?=\))/, '')
        .replace(/:\)/, ')')
        .replace(/[.;:\s]+$/, '')}`
    : 'The file could not be parsed'

export const isNewer = (r: ProjectRecord): boolean => r.doc?.problems.some((p) => p.code === 'schema-newer') === true

const reveal = (r: ProjectRecord): void => void window.radar.invoke('system.reveal', { id: r.id })

const say = (text: string): void => useShell.getState().say({ text })

/** The command a v2 file is converted with. */
export const MIGRATE_COMMAND = 'radar-blip migrate'

/** The project page's banner for a read-only file; nothing for a writable one. */
export function ReadOnlyBanner({ r }: { r: ProjectRecord }): JSX.Element | null {
  if (r.state === 'needs-migrate')
    return (
      <Banner
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => void navigator.clipboard.writeText(MIGRATE_COMMAND).then(() => say('Command copied. Run it in a terminal.'))}
          >
            Copy the command
          </Button>
        }
      >
        <b>This project is still in the v2 format.</b> It is shown read-only. Run <code>{MIGRATE_COMMAND}</code> in a terminal to convert it; a backup is kept.
      </Banner>
    )
  if (r.state !== 'needs-repair') return null
  const actions = (
    <>
      <Button size="sm" caps="E" onClick={() => void openEditor(r)}>
        Open in editor
      </Button>
      <Button size="sm" onClick={() => reveal(r)}>
        Reveal
      </Button>
    </>
  )
  if (isNewer(r))
    return (
      <Banner actions={actions}>
        <b>This file was written by a newer RADAR.</b> Update the app to edit it.
      </Banner>
    )
  return (
    <Banner actions={actions}>
      <b>This BLIP.md could not be read.</b> {problemLine(repairProblem(r))}. Nothing has been changed, and RADAR will not write to this file until it parses.
    </Banner>
  )
}
