// The project page's right column (renderer spec 4, 6.5, 6.6): the session log, the facts RADAR
// derives (never typed), and the fields that are the owner's to set, each an inline editor that
// sends one `set` op. In a read-only file the editors are not drawn; the values are.
import { useState, type ReactNode } from 'react'
import type { BlipStatus, ProjectRecord } from '@shared/model'
import { ageLabel, behind, days, dueLabel, sourceGlyph, touchedAt } from '../lib/derive'
import { edit } from '../lib/edits'
import { canPrompt, catchUp, toggleFocus, writable } from '../lib/projectActions'
import { Button, Chip, Toggle } from './atoms'
import { Editor } from './Editor'
import { FilesGlyph, GitGlyph } from './glyphs'
import { LiveMark } from './ProjectRow'
import { useShell } from '../store/shell'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number): string => String(n).padStart(2, '0')

/** `10 Oct` from `2026-10-10`. */
export const dayMon = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number) as [number, number, number]
  return `${d} ${MON[m - 1]}`
}
/** `Sat 10 Oct`, local, from an instant. */
const wdayMon = (ms: number): string => {
  const d = new Date(ms)
  return `${WDAY[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`
}
/** `10 Oct 21:40`, local, from an instant. */
const dayMonTime = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getDate()} ${MON[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Entries shown before `N earlier entries … show`. */
export const LOG_SHOWN = 4

export function LogTimeline({ r }: { r: ProjectRecord }): JSX.Element {
  const [all, setAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const log = r.doc?.log ?? []
  const shown = all ? log : log.slice(0, LOG_SHOWN)
  const earlier = log.slice(LOG_SHOWN)
  const oldest = [...earlier].reverse().find((e) => e.date)?.date
  const last = r.doc?.lastLogAt
  return (
    <section aria-label="Session log">
      <div className="lab">
        <span>Session log</span>
        {last && <span>last entry {dayMon(localIso(Date.parse(last)))}</span>}
      </div>
      {log.length === 0 && <p className="tl-none">No entries yet. An agent adds one when it runs /blip.</p>}
      <ul className="tl">
        {shown.map((e, i) => (
          <li key={i}>
            <div className="when">
              {e.date ? `${dayMon(e.date)}${e.time ? ` ${e.time}` : ''}` : e.heading}
              {e.date && e.author && (i === 0 || shown[i - 1]?.author !== e.author) && <span>{e.author}</span>}
            </div>
            {e.bullets.map((b, j) => (
              <p key={j}>{b}</p>
            ))}
          </li>
        ))}
        {earlier.length > 0 && (
          <li className="old">
            {all ? (
              <button type="button" onClick={() => setAll(false)}>
                Show the newest {LOG_SHOWN}
              </button>
            ) : (
              <>
                {earlier.length} earlier {earlier.length === 1 ? 'entry' : 'entries'}
                {oldest && `, back to ${MONTH[Number(oldest.slice(5, 7)) - 1]}`} ·{' '}
                <button type="button" onClick={() => setAll(true)}>
                  show
                </button>
              </>
            )}
          </li>
        )}
      </ul>
      {writable(r) &&
        (adding ? (
          <Editor
            value=""
            label="New log entry"
            multiline
            lines
            placeholder="What happened, one line each"
            onSave={(text) =>
              edit(r, [{ op: 'log.add', bullets: text.split('\n').filter((l) => l.trim() !== '') }], 'Logged.', { inline: true })
            }
            onClose={() => setAdding(false)}
          />
        ) : (
          <button type="button" className="tl-add" onClick={() => setAdding(true)}>
            Add an entry
          </button>
        ))}
    </section>
  )
}

const localIso = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const SMALL = {
  git: 'Newest commit on any local branch.',
  files: 'Newest file change in the folder. This folder is not a git repo.',
  none: 'No activity yet.'
}

export function DerivedFacts({ r, now }: { r: ProjectRecord; now: number }): JSX.Element {
  const a = r.activity
  const doc = r.doc
  // a file that cannot be parsed: nothing read from it, and no prompt that would send an agent to it
  const broken = r.state === 'needs-repair'
  const late = canPrompt(r) && behind(r)
  const at = touchedAt(r)
  const glyph = sourceGlyph(r)
  const g = a?.git ?? null
  return (
    <section aria-label="Derived, never typed">
      <div className="lab">
        <span>Derived, never typed</span>
      </div>
      <dl className="facts">
        <dt>Last work</dt>
        <dd>
          {ageLabel(days(r, now))}
          {at && ` · ${wdayMon(Date.parse(at))}`}
          {glyph === 'branch' && <GitGlyph />}
          {glyph === 'page' && <FilesGlyph />}
          {a && <small>{SMALL[a.source]}</small>}
        </dd>
        <dt>Log</dt>
        <dd>
          {broken ? 'not read' : doc?.lastLogAt ? `written ${dayMonTime(Date.parse(doc.lastLogAt))}` : 'no entries yet'}
          {a && !broken && (
            <small>
              {late ? `There is work ${doc?.lastLogAt ? 'since then that ' : ''}the log does not mention yet.` : 'Up to date with the work.'}
            </small>
          )}
          {late && (
            <Button caps="L" onClick={() => void catchUp(r)}>
              Catch-up prompt
            </Button>
          )}
        </dd>
        {a && (
          <>
            <dt>Git</dt>
            <dd>{g ? `${g.branch ?? 'detached'}${g.head ? ` · ${g.head.slice(0, 7)}` : ''}${g.dirty ? ' · uncommitted changes' : ''}` : 'not a repository'}</dd>
          </>
        )}
        <dt>Agent session</dt>
        <dd>
          {r.agent.live ? <LiveMark live words="live now" /> : 'none detected'}
          {!r.agent.live && r.agent.lastSeenAt && <small>Last seen {ageLabel(Math.max(0, (now - Date.parse(r.agent.lastSeenAt)) / 86_400_000))} ago.</small>}
        </dd>
        {doc && (
          <>
            <dt>File</dt>
            <dd>
              BLIP.md · v{doc.schema}
              {!broken && (
                <small>
                  {doc.tasks.open.length} open, {doc.tasks.done.length} done, {doc.log.length} log {doc.log.length === 1 ? 'entry' : 'entries'}
                </small>
              )}
            </dd>
          </>
        )}
        <dt>Folder</dt>
        <dd>
          <button type="button" className="path" title="Show in the file manager" onClick={() => void window.radar.invoke('system.reveal', { id: r.id })}>
            {r.dir}
          </button>
        </dd>
      </dl>
    </section>
  )
}

const STATUS: Record<BlipStatus, string> = { active: 'Active', blocked: 'Waiting', paused: 'Paused', archived: 'Archived' }

/** One field: its name, its value, and the value's editor in its place while it is open. */
function Field({ name, value, text, can, editor }: { name: string; value: ReactNode; text: string; can: boolean; editor?: (close: () => void) => ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  if (open && editor)
    return (
      <div className="fld ing">
        <span>{name}</span>
        {editor(() => setOpen(false))}
      </div>
    )
  return (
    <div className="fld">
      <span>{name}</span>
      {can && editor ? (
        <button type="button" className="v" aria-label={`${name}: ${text}, change`} onClick={() => setOpen(true)}>
          {value}
        </button>
      ) : (
        <b>{value}</b>
      )}
    </div>
  )
}

/** `Label https://…` or a bare URL, one per line. */
const parseLinks = (text: string): { label: string | null; url: string }[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf(' ')
      return i < 0 ? { label: null, url: l } : { label: l.slice(0, i).trim(), url: l.slice(i + 1) }
    })

const host = (url: string): string => url.replace(/^[a-z]+:(\/\/)?/i, '').split('/')[0] ?? url

export function YoursToSet({ r, today }: { r: ProjectRecord; today: string }): JSX.Element | null {
  const doc = r.doc
  const busy = useShell((s) => !!s.writing[r.id])
  if (!doc) return null
  const can = writable(r)
  const set = (field: 'name' | 'now' | 'status' | 'focus' | 'due' | 'tags' | 'links', value: unknown, done: string) =>
    edit(r, [{ op: 'set', field, value }], done, { inline: true })
  const due = dueLabel(doc.due, today)
  const links = doc.links
  return (
    <section aria-label="Yours to set">
      <div className="lab">
        <span>Yours to set</span>
      </div>
      <Field
        name="Name"
        value={doc.name}
        text={doc.name}
        can={can}
        editor={(close) => <Editor value={doc.name} label="Name" onSave={(v) => set('name', v, 'Name changed.')} onClose={close} />}
      />
      <div className="fld">
        <span>Focus</span>
        {can ? <Toggle on={doc.focus} label="Pinned as focus" busy={busy} onChange={() => void toggleFocus(r)} /> : <b>{doc.focus ? 'pinned' : 'not pinned'}</b>}
      </div>
      <div className="fld">
        <span>Status</span>
        {can ? (
          <label className="v sel">
            <select
              aria-label="Status"
              aria-busy={busy || undefined}
              value={doc.status}
              onChange={(e) => void set('status', e.target.value, `Status: ${STATUS[e.target.value as BlipStatus].toLowerCase()}.`)}
            >
              {(Object.keys(STATUS) as BlipStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS[s]}
                </option>
              ))}
            </select>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="M3.5 2l3 3-3 3" />
            </svg>
          </label>
        ) : (
          <b>{STATUS[doc.status]}</b>
        )}
      </div>
      {/* a date that has passed shows nothing anywhere (rule 3): here it reads none */}
      <Field
        name="Due"
        value={due ? due.replace(/^due /, '') : <span className="none">none{can && ' · set'}</span>}
        text={due ? due.replace(/^due /, '') : 'none'}
        can={can}
        editor={(close) => (
          <Editor value={doc.due ?? ''} label="Due" type="date" onSave={(v) => set('due', v || null, v ? 'Due date set.' : 'Due date cleared.')} onClose={close} />
        )}
      />
      <Field
        name="Tags"
        value={
          doc.tags.length ? (
            doc.tags.map((t, i) => (
              <Chip key={t} quiet={i > 0}>
                {t}
              </Chip>
            ))
          ) : (
            <span className="none">none{can && ' · set'}</span>
          )
        }
        text={doc.tags.length ? doc.tags.join(' ') : 'none'}
        can={can}
        editor={(close) => (
          <Editor
            value={doc.tags.join(' ')}
            label="Tags"
            placeholder="Words, the first is the group"
            onSave={(v) => set('tags', v.split(/[\s,]+/).filter(Boolean), 'Tags changed.')}
            onClose={close}
          />
        )}
      />
      <Field
        name="Links"
        value={
          links.length ? (
            <>
              {links[0].label ?? host(links[0].url)}
              {links.length > 1 && <span className="none">+{links.length - 1}</span>}
            </>
          ) : (
            <span className="none">none{can && ' · add'}</span>
          )
        }
        text={links.length ? links.map((l) => l.label ?? host(l.url)).join(', ') : 'none'}
        can={can}
        editor={(close) => (
          <Editor
            value={links.map((l) => (l.label ? `${l.label} ${l.url}` : l.url)).join('\n')}
            label="Links"
            multiline
            lines
            placeholder="Label https://…, one per line"
            onSave={(v) => set('links', parseLinks(v), 'Links changed.')}
            onClose={close}
          />
        )}
      />
    </section>
  )
}
