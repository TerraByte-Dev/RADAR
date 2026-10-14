// The toast (renderer spec 4, 8): one at a time, bottom centre, for six seconds (the undo toast
// ten). A change that could not be made leads with what happened, in bold; Undo and Try again
// are ghost buttons, never the filled one (rule 5). A toast is a status; one that says a change
// could not be made is an alert (section 11). The two are sibling regions, never one inside the
// other, and each toast is drawn afresh (keyed by its own object), so one that replaces another
// is announced as new.
import type { ReactNode } from 'react'
import { useShell, type Toast as ToastT } from '../store/shell'
import { Button } from './atoms'

const ids = new WeakMap<ToastT, number>()
let n = 0
const key = (t: ToastT): number => ids.get(t) ?? (ids.set(t, ++n), n)

function Body({ toast }: { toast: ToastT }): JSX.Element {
  return (
    <div className="toast">
      {toast.lead ? (
        <span>
          <b>{toast.lead}</b> <span className="x">{toast.text}</span>
        </span>
      ) : (
        <span>{toast.text}</span>
      )}
      {toast.action && (
        <Button size="sm" caps={toast.action.caps} onClick={toast.action.run}>
          {toast.action.label}
        </Button>
      )}
    </div>
  )
}

/** The two regions, with the toast in the one it belongs to. */
export function ToastRegions({ toast }: { toast: ToastT | null }): JSX.Element {
  const body = (alert: boolean): ReactNode => toast && !!toast.lead === alert && <Body key={key(toast)} toast={toast} />
  return (
    <div className="toasts">
      <div role="status">{body(false)}</div>
      <div role="alert">{body(true)}</div>
    </div>
  )
}

export const Toast = (): JSX.Element => <ToastRegions toast={useShell((s) => s.toast)} />
