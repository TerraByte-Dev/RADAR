import { useStore } from '../store/useStore'

/**
 * Full-viewport CRT effect stack — scanlines, vignette, noise, and flicker.
 * Fixed and pointer-events-none so it never intercepts input. Togglable via
 * the `crtEffects` preference (command palette / sidebar).
 */
export function CrtOverlay(): JSX.Element | null {
  const crt = useStore((s) => s.crtEffects)
  if (!crt) return null
  return (
    <div className="crt-stack" aria-hidden>
      <div className="crt-scanlines" />
      <div className="crt-noise" />
      <div className="crt-flicker" />
      <div className="crt-vignette" />
    </div>
  )
}
