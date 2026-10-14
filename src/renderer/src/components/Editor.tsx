// An inline editor (renderer spec 4, 8): the field it replaces, edited in place. Enter saves and
// Esc cancels; the answer is awaited, and a validation error is shown under the field, every
// violation on its own line, in the engine's words. Nothing is optimistic.
import { useState, type KeyboardEvent } from 'react'
import type { ApiError } from '@shared/ipc'

export interface EditorProps {
  value: string
  label: string
  /** A textarea: Enter still saves; Shift+Enter breaks the line where `lines` allows it. */
  multiline?: boolean
  /** Shift+Enter starts a new line (task detail, links, log bullets). */
  lines?: boolean
  /** `date`: the native date field. */
  type?: 'text' | 'date'
  placeholder?: string
  /** The counter `n/max` appears only past `warnAt`. */
  max?: number
  warnAt?: number
  /** Sends the value; null when it was taken, else the error to show. */
  onSave(value: string): Promise<ApiError | null>
  /** Closes the editor: after a save that was taken, or on Esc. */
  onClose(): void
}

/** Ctrl Z inside a text field is the field's own undo, not the last change's (9.1). */
export const keepUndo = (e: KeyboardEvent): void => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') e.stopPropagation()
}

export function Editor({ value, label, multiline, lines, type = 'text', placeholder, max, warnAt, onSave, onClose }: EditorProps): JSX.Element {
  const [text, setText] = useState(value)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const e = await onSave(text)
    setBusy(false)
    if (e) setError(e)
    else onClose()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    keepUndo(e)
    if (e.key === 'Escape') {
      // handled here, so Esc closes the editor and does not also go back
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter' && !(lines && e.shiftKey)) {
      e.preventDefault()
      void save()
    }
  }
  const problems = error ? (error.violations?.length ? error.violations.map((v) => v.message) : [error.message]) : []
  const props = {
    value: text,
    'aria-label': label,
    'aria-busy': busy || undefined,
    'aria-invalid': problems.length > 0 || undefined,
    placeholder,
    autoFocus: true,
    onKeyDown,
    onChange: (e: { target: { value: string } }) => setText(e.target.value)
  }
  return (
    <div className="ed">
      {multiline ? <textarea rows={lines ? 4 : 2} {...props} /> : <input type={type} {...props} />}
      {max !== undefined && warnAt !== undefined && text.length > warnAt && (
        <span className={text.length > max ? 'cnt over' : 'cnt'}>
          {text.length}/{max}
        </span>
      )}
      {problems.length > 0 && (
        <ul className="viol" role="alert">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
