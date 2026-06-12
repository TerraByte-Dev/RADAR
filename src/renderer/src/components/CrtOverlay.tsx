/**
 * Full-viewport CRT effect stack — scanlines, vignette, noise, and flicker. Fixed and
 * pointer-events-none so it never intercepts input. Visibility is gated entirely in CSS by the
 * `html.crt-off` class (set by the theme engine, `lib/theme.ts`) — universal themes and the manual
 * CRT-off toggle hide it (along with the terminal grid). Always rendered so the pre-paint class is the
 * only source of truth and there's never a flash.
 */
export function CrtOverlay(): JSX.Element {
  return (
    <div className="crt-stack" aria-hidden>
      <div className="crt-scanlines" />
      <div className="crt-noise" />
      <div className="crt-flicker" />
      <div className="crt-vignette" />
    </div>
  )
}
