// The keys sheet (renderer spec 9.2), on `?`: its own overlay, 780px, 70px from the top. Every
// keymap row, grouped by scope in two columns, label left and keycaps right; the field narrows it.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { KEYMAP, nameOf, type KeyScope } from '../lib/keymap'
import { useShell } from '../store/shell'
import { Keys } from './atoms'
import { Glass, keepFocus } from './Palette'

const SCOPES = [...new Set(KEYMAP.map((b) => b.scope))] as KeyScope[]
const close = (): void => useShell.setState({ overlay: null })

export function KeysSheet(): JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const rows = KEYMAP.filter((b) => !q || [nameOf(b), b.label, b.caps].some((s) => s.toLowerCase().includes(q)))

  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => opener?.focus?.()
  }, [])

  // modal: its keys are its own; Tab stays on the one field
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      if (e.key === 'Escape') close()
    }
    e.stopPropagation()
  }

  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="pop pal wide" role="dialog" aria-modal="true" aria-label="Keys" onKeyDown={onKeyDown} onMouseDown={keepFocus}>
        <div className="in">
          <Glass />
          <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Keys. Type to find one" aria-label="Find a key" />
          <Keys caps="Esc" />
        </div>
        <div className="keys">
          <div className="cols">
          {SCOPES.map((scope) => {
            const own = rows.filter((b) => b.scope === scope)
            return (
              own.length > 0 && (
                <section key={scope} aria-label={scope}>
                  <h2>{scope}</h2>
                  <dl>
                    {own.map((b) => (
                      <div key={b.id} className="kr" title={b.label}>
                        <dt>{nameOf(b)}</dt>
                        <dd>
                          <Keys caps={b.caps} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )
            )
          })}
          </div>
          {rows.length === 0 && <p className="none">No key does that.</p>}
        </div>
        <div className="pfoot">
          <span>Every key on this sheet comes from one table. A binding that is not here does not exist.</span>
        </div>
      </div>
    </>
  )
}
