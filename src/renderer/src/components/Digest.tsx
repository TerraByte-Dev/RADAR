// Since you were last here (renderer spec 6.3): the projects whose newest log entry came after
// RADAR was last left, newest first, at most four, never the Continue project. Things that
// happened only. Two presentations of one list: the rail block (from 1180 wide and 720 tall),
// and the one-line since line above the strip, which opens the list in place. Which one shows is
// CSS (styles/app.css); with nothing to say, neither renders.
import type { DigestLine } from '../lib/derive'
import { useShell } from '../store/shell'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weekday = (ms: number): string => WEEKDAYS[new Date(ms).getDay()] as string

const Lines = ({ lines }: { lines: DigestLine[] }): JSX.Element => (
  <ul>
    {lines.map((l) => (
      <li key={l.id}>
        <span>
          <b>{l.name}</b>
          {'  '}
          {l.text}
        </span>
        <span className="mono">{l.day}</span>
      </li>
    ))}
  </ul>
)

export function Digest({ lines, since }: { lines: DigestLine[]; since: number }): JSX.Element | null {
  if (!lines.length) return null
  return (
    <section className="dig" aria-label="Since you were last here">
      <div className="dh">
        <b>Since you were last here</b>
        <span className="mono">{weekday(since)}</span>
      </div>
      <Lines lines={lines} />
    </section>
  )
}

/** "Since Saturday: A, B and C moved. show": up to three names, then "and others". */
export function SinceLine({ lines, since }: { lines: DigestLine[]; since: number }): JSX.Element | null {
  const open = useShell((s) => s.sinceOpen)
  if (!lines.length) return null
  const names = lines.slice(0, 3).map((l) => <b key={l.id}>{l.name}</b>)
  const others = lines.length > 3
  const list = names.flatMap((n, i) => {
    const last = i === names.length - 1
    const sep = i === 0 ? '' : last && !others ? ' and ' : ', '
    return [sep, n]
  })
  return (
    <>
      <button type="button" className="since" aria-expanded={open} onClick={() => useShell.setState({ sinceOpen: !open })}>
        Since {weekday(since)}: {list}
        {others && ' and others'} moved. <u>{open ? 'hide' : 'show'}</u>
      </button>
      {open && (
        <section className="dig inl" aria-label="Since you were last here">
          <Lines lines={lines} />
        </section>
      )}
    </>
  )
}
