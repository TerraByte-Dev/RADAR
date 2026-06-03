# TERRABYTE.SYS — ToDoPlus design system

ToDoPlus wears the same Y2K terminal / CRT phosphor skin as the rest of the TerraByte apps
(`TerraPlayer`, `terrabyte-site`). This doc is the reference for the tokens and reusable
classes so new UI stays on-brand.

The source of truth is **`tailwind.config.js`** (tokens) and **`src/renderer/src/styles/index.css`**
(CSS variables + component layer). The display/mono faces (VT323, Share Tech Mono, IBM Plex Mono)
are bundled offline via `@fontsource` and imported in `src/renderer/src/main.tsx`. Inter remains
the house body font in the `sans` token but is **not bundled** — the UI is all-mono, so it falls
back to the system sans if ever used.

## Palette

Pure-black canvas, phosphor-green ink, terminal channel accents.

| Role | Token(s) | Value |
|---|---|---|
| Canvas | `bg` | `#000000` |
| Panel surface | `panel` / `surface` | `#020503` |
| Raised surface | `panelLite` / `elevated` | `#04090a` |
| LCD screen | `lcd` | `#020a05` |
| Hairline rule | `rule` / `border` | `rgb(0 255 136 / .18)` |
| Faint rule | `ruleDim` | `rgb(0 255 136 / .08)` |
| Phosphor (accent) | `phosphor` / `accent` | `#00FF88` |
| Phosphor bright | `phosphor.bright` | `#7CFF6B` |
| Phosphor dim | `phosphor.dim` | `#1f5e3a` |
| Ink (text) | `ink` | `#9bf5b8` |
| Muted text | `muted` | `rgb(155 245 184 / .58)` |
| Faint text | `faint` | `rgb(155 245 184 / .32)` |
| Terminal cyan | `term.cyan` | `#00E5FF` |
| Terminal amber | `term.amber` / `p2` | `#FFB000` |
| Terminal magenta | `term.magenta` | `#FF2E9A` |
| Terminal red | `term.red` / `p1` | `#FF3030` |
| Priority P3 | `p3` | `#00E5FF` (cyan) |

> **Back-compat:** the original semantic names (`bg`, `surface`, `elevated`, `ink`, `muted`,
> `faint`, `accent`, `accent-soft`, `border`, `p1`–`p4`) are **remapped** onto the phosphor
> palette, so any pre-existing utility class renders on-brand without edits. New code should
> prefer the explicit tokens (`phosphor`, `term.*`, `panel`, `lcd`, `rule`).

## Type

| Family | Token | Used for |
|---|---|---|
| VT323 | `font-term` | Big display / headings / day numbers (uppercase) |
| Share Tech Mono | `font-lcd` | LCD readouts |
| IBM Plex Mono | `font-mono` | Labels, nav, metadata, task titles |
| Inter (system fallback) | `font-sans` | House body font — not bundled; UI is currently all-mono |

Headings are uppercase VT323 with `phosphor-glow`. Labels are uppercase mono with wide
letter-spacing (`tracking-[0.06em]`+). **Task titles stay mono in normal case** for
readability — the CRT character comes from font, color, and chrome, not from forcing user
content to all-caps.

Corners are squared (`borderRadius` scale flattened to 2–4px); dots/LEDs keep `rounded-full`.

## Reusable classes (`@layer components`)

| Class | What it is |
|---|---|
| `crt-stack` + `crt-scanlines` / `crt-vignette` / `crt-noise` / `crt-flicker` | Full-viewport CRT overlay (rendered by `CrtOverlay`, gated by the `crtEffects` pref). `pointer-events: none`. |
| `term-grid` | Vector-grid background (sidebar). |
| `term-grid-bg` | Faint masked grid backdrop behind app content. |
| `track-scan` | Subtle scanline texture for scrollable panes. |
| `panel` | Flat bordered surface. |
| `lcd-panel` | Glowing inset LCD screen (task detail, dialogs). |
| `lcd-inset` | LCD-style text input. |
| `metal-key` / `.is-primary` | Brushed-metal button (window + add controls). |
| `btn` / `btn-primary` | Pill button, uppercase mono. |
| `term-tag` | Bordered uppercase tag chip (`@tag`). |
| `glow-line` | Thin glowing phosphor divider. |
| `phosphor-glow` | Text glow for active/emphasis elements. |
| `led-dot` | Pulsing phosphor LED. |
| `term-caret` | Blinking block caret (`▮`). |
| `boot-screen` / `boot-splash` / `splash-*` | Boot sequence + glitch logotype (`BootSplash`). |
| `fade-in` | Generic entrance. |

## Motion & accessibility

- Animations: LED pulse, caret blink, CRT flicker, boot glitch, Framer layout transitions
  (the satisfying "sink to bottom" when a task completes).
- `@media (prefers-reduced-motion: reduce)` disables flicker, glitch, pulse, and entrance
  animations, and the boot sequence fast-forwards.
- The CRT overlay is **opt-out** at runtime: sidebar footer `CRT ON/OFF` or the command
  palette. The preference persists to `localStorage`.

## Radar

The Radar view (`views/RadarView.tsx`) is drawn on a `<canvas>` with a `requestAnimationFrame`
loop, so its colors are hardcoded hex/rgba rather than Tailwind tokens — but they mirror the
palette: accent `#00FF88`, and the labeled time-rings NOW `#FF6B6B` / 1 WEEK `#FFB000` / 1 MONTH
`#7CFF6B` / 1 QUARTER `#00E5FF` / SOMEDAY `#5fd0c4`. Pure red `#FF3030` is reserved for overdue
blips; other blips take their project's color.

A blip's **distance from center is a continuous, log-compressed time-to-deadline** (`lib/radar.ts`:
`daysUntilDue` → `radiusFracForDays`), so near-term tasks spread out and far-future ones compress
toward the rim; the labeled rings are just gridlines on that axis. Its **angle** defaults to the
project's sector, but blips are **freely draggable around the dial**: dropping one reschedules it to
the exact date under the cursor (radius → `daysFromFrac`) *and* pins a per-task `radarAngle`
(`angleFromPoint`) — a purely visual override that does **not** reassign the project. To stop
same-project/same-deadline tasks stacking on one spoke, `layoutBlipAngles` **auto-fans** each wedge's
blips apart only where they'd overlap, widening the arc near the crowded center (small circumference →
more degrees per pixel) and capping the spread so neighbouring wedges never collide; a manual angle
always wins. Clear a pinned angle by **right-clicking** the blip, via the selected-panel
"reset position", the header "reset layout", or the command palette. A pure angular nudge (radius
unchanged) skips the reschedule so it doesn't add a phantom entry to the activity timeline. The math
is unit-tested; the canvas honors `prefers-reduced-motion` (freezes the sweep, pings, and pulses).
Task-blip adaptation of the TerraByte `RADAR` project.

## Window chrome

The BrowserWindow is **frameless** (`frame: false`); the renderer draws its own `TitleBar`
(`TODOPLUS//SYS` logotype, live clock, open-count, minimize/maximize/close). Controls send
IPC (`window:minimize|maximize|close`) handled in `src/main/index.ts`. Drag regions use
`.drag-region` / `.no-drag`.

## Brand mark

The TerraByte globe-sword mark is a **monochrome mint (`#00E5A0`) on transparent** PNG:
`src/renderer/src/assets/logo.png` (imported by `Sidebar` + `BootSplash`, both rendered with a
phosphor `drop-shadow` and `mix-blend-mode: screen` for glow — the transparent background means the
blend is cosmetic, not load-bearing) and `build/icon.png` (the runtime window icon, set in
`main/index.ts`). The Windows installer/exe uses a multi-size **`build/icon.ico`** (256/128/64/48/32/16,
wired in `electron-builder.yml`). All three are regenerable from a single source mark with ImageMagick
(`-transparent "#050A08"` → resize / `-define icon:auto-resize`).
