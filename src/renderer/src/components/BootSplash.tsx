import { useEffect, useRef, useState } from 'react'
import logo from '../assets/logo.png'
import { useStore } from '../store/useStore'

interface BootLine {
  text: string
  tone?: 'ok' | 'warn' | 'info' | 'dim'
}

const LINES: BootLine[] = [
  { text: 'TERRABYTE SYSTEMS — TODOPLUS BIOS v0.1.0', tone: 'info' },
  { text: '> POST .............................. OK', tone: 'ok' },
  { text: '> MOUNT userData volume ............. OK', tone: 'ok' },
  { text: '> LOAD todoplus-data.json ........... OK', tone: 'ok' },
  { text: '> INIT phosphor display @ 0x00FF88 .. OK', tone: 'ok' },
  { text: '> CALENDAR subsystem ................ OK', tone: 'ok' },
  { text: '> NLP tokenizer ..................... READY', tone: 'ok' },
  { text: '> ALL SYSTEMS NOMINAL', tone: 'info' }
]

const LINE_MS = 110
const SPLASH_MS = 1100

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** One-shot launch sequence: BIOS log → glitched logotype → fade out. */
export function BootSplash(): JSX.Element {
  const finishBoot = useStore((s) => s.finishBoot)
  const [phase, setPhase] = useState<'log' | 'splash'>('log')
  const [shown, setShown] = useState(0)
  const [fadingOut, setFadingOut] = useState(false)
  const [glitch, setGlitch] = useState(false)
  const timers = useRef<number[]>([])

  function clearTimers(): void {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }

  function dismiss(): void {
    clearTimers()
    setFadingOut(true)
    timers.current.push(window.setTimeout(finishBoot, 460))
  }

  useEffect(() => {
    // Honor reduced-motion: skip straight through.
    if (prefersReducedMotion()) {
      const t = window.setTimeout(dismiss, 250)
      timers.current.push(t)
      return clearTimers
    }

    LINES.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setShown(i + 1), i * LINE_MS))
    })
    const logTotal = LINES.length * LINE_MS + 280
    timers.current.push(window.setTimeout(() => setPhase('splash'), logTotal))
    timers.current.push(window.setTimeout(() => setGlitch(true), logTotal + 260))
    timers.current.push(window.setTimeout(() => setGlitch(false), logTotal + 420))
    timers.current.push(window.setTimeout(dismiss, logTotal + SPLASH_MS))
    return clearTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Any key / click dismisses immediately.
  useEffect(() => {
    const onKey = (): void => dismiss()
    window.addEventListener('keydown', onKey, { once: true })
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={`boot-screen ${fadingOut ? 'fade-out' : ''}`}
      onClick={dismiss}
      role="dialog"
      aria-label="Boot sequence"
    >
      <button className="boot-skip no-drag" onClick={dismiss}>
        SKIP ▸
      </button>

      {phase === 'log' ? (
        <div className="m-auto w-full max-w-[680px]">
          {LINES.slice(0, shown).map((line, i) => (
            <div key={i} className="boot-line">
              <span className={line.tone}>{line.text}</span>
              {i === shown - 1 && <span className="term-caret" />}
            </div>
          ))}
        </div>
      ) : (
        <div className={`boot-splash splash-in ${glitch ? 'splash-glitch' : ''}`}>
          <div className="splash-frame top">
            <span className="splash-frame-corner">┌</span>
            <span className="splash-frame-rule" />
            <span className="splash-frame-label">TERRABYTE SOLUTIONS</span>
            <span className="splash-frame-rule" />
            <span className="splash-frame-corner">┐</span>
          </div>

          <img
            src={logo}
            alt=""
            className="mb-3 h-24 w-24"
            style={{ mixBlendMode: 'screen', filter: 'drop-shadow(0 0 14px rgba(0,255,136,.55))' }}
          />

          <span className="splash-title-wrap">
            <span className="splash-title">TODOPLUS</span>
            <span className="splash-title splash-title-r" aria-hidden>
              TODOPLUS
            </span>
            <span className="splash-title splash-title-g" aria-hidden>
              TODOPLUS
            </span>
          </span>
          <span className="splash-tag">// GET IT DONE</span>

          <div className="splash-frame bottom">
            <span className="splash-frame-corner">└</span>
            <span className="splash-frame-rule" />
            <span className="splash-frame-label">LOCAL · OFFLINE · YOURS</span>
            <span className="splash-frame-rule" />
            <span className="splash-frame-corner">┘</span>
          </div>
        </div>
      )}

      <div className="boot-tickerbar">
        <span>● PHOSPHOR ONLINE</span>
        <span>MEM OK</span>
        <span>NO NETWORK REQUIRED</span>
      </div>
    </div>
  )
}
