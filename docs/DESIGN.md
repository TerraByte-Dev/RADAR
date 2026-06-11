# TERRABYTE.SYS — RADAR design system

RADAR wears the same Y2K terminal / CRT phosphor skin as the rest of the TerraByte apps
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
| Terminal amber | `term.amber` | `#FFB000` |
| Terminal magenta | `term.magenta` | `#FF2E9A` |
| Terminal red | `term.red` / `p1` | `#FF3030` |

> **Back-compat:** the original semantic names (`bg`, `surface`, `elevated`, `ink`, `muted`,
> `faint`, `accent`, `accent-soft`, `border`, `p1` — alert red) are **remapped** onto the
> phosphor palette, so any pre-existing utility class renders on-brand without edits. New code
> should prefer the explicit tokens (`phosphor`, `term.*`, `panel`, `lcd`, `rule`).

**Category swatches** are a separate curated set — 16 calm, wheel-ordered hues in
`lib/palette.ts` (`PROJECT_COLORS`), kept clear of the phosphor accent and the overdue red so a
category's color never reads as state. A blip's color comes from its `category`:
`projectRadar.categoryColor` gives the house categories (Client/Product/Admin/Personal/…) fixed
picks and hashes any other name deterministically into the wheel — there is no per-project
recolor UI; recategorize to recolor.

## Themes

The palette above is the **default `terrabyte` theme**; the whole skin recolors at runtime. The
mechanism is CSS-variable tokens + a small theme engine (`lib/theme.ts`).

**Token model (the one architectural rule).** Every Tailwind color maps onto a CSS variable holding
**space-separated RGB channels** (`rgb(var(--phosphor-rgb) / <alpha-value>)`), and the hand-written
component classes use **full-color tokens derived from those channels** (`--phosphor:
rgb(var(--phosphor-rgb))`). Both live in `styles/index.css`. Because the derived tokens reference the
channels lazily, a theme only has to swap the *base channels* and every utility, class, shadow, and
the canvas recolor for free:

- **Base channels** (`:root`): `--phosphor-rgb`, `--phosphor-bright-rgb`, `--phosphor-dim-rgb`,
  `--ink-rgb`, `--bg-rgb`, `--panel-rgb`, `--panel-lite-rgb`, `--hover-rgb`, `--lcd-rgb`,
  `--term-{cyan,amber,magenta,red}-rgb`.
- **Derived tokens**: `--phosphor`, `--ink`, `--bg`, `--panel`, `--rule` (= `phosphor / .18`),
  `--ink-dim`, `--phosphor-faint`, … — never redefined per theme; they re-resolve against the new
  channels on the same `<html>`.

**Registry (`lib/theme.ts`).** `THEMES: Theme[]` — `{ id, name, blurb, family, swatch }`. Two
families: **`crt`** (recolored TERRABYTE.SYS — scanlines + grid + glow) and **`universal`** (clean
Dark/Light, no CRT, flat neutral rules). `applyTheme(id)` sets `data-theme` on `<html>`, reconciles
the `crt-off` class, persists `radar.theme`, and dispatches `radar-theme-change`. `resolveCrtOff`
(pure, unit-tested) decides the overlay: universal → always off; crt → honor the manual
`radar.crt-off` pref. `themeBoot()` (called in `main.tsx` before render) applies the stored theme +
CRT class **pre-paint**, so there's no flash. `useThemeState()` keeps the title bar + Appearance tab
in sync via the events.

**Adding a theme** = one `THEMES` entry + one `html[data-theme="…"]` block in `index.css` overriding
the base channels (and, for non-black backgrounds, `--bg-rgb`/`--panel-rgb`/…). No component code
changes — that's the invariant.

**CRT toggle.** One source of truth: the `html.crt-off` class. CSS hides `.crt-stack` + `.term-grid-bg`
under it; universal themes force it on; the title-bar monitor button + Appearance toggle both route
through `setCrtOff` (persisted to `radar.crt-off`). The store's `crtEffects` is a synced mirror.

**Canvas.** The `<canvas>` radar can't read Tailwind classes, so `lib/radarColors.ts` reads the
accent/ink channels off the resolved CSS vars, caches them, and recomputes only on `radar-theme-change`
(never per rAF frame). Only the **scope chrome** (accent sweep/rings/center/selection) is themed;
**semantic data colors** (overdue `#FF3030`, soon `#FFB000`, the time-ring scale, category hues) stay
fixed constants — they encode meaning, not the skin.

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
| `crt-stack` + `crt-scanlines` / `crt-vignette` / `crt-noise` / `crt-flicker` | Full-viewport CRT overlay (rendered by `CrtOverlay`, gated in CSS by the theme engine's `html.crt-off` class — the store's `crtEffects` is a synced mirror). `pointer-events: none`. |
| `term-grid` | Vector-grid background (sidebar). |
| `term-grid-bg` | Faint masked grid backdrop behind app content. |
| `track-scan` | Subtle scanline texture for scrollable panes. |
| `panel` | Flat bordered surface. |
| `lcd-panel` | Glowing inset LCD screen (project detail, dialogs). |
| `lcd-inset` | LCD-style text input. |
| `metal-key` / `.is-primary` | Brushed-metal button (close buttons, calendar nav, the Keyboard tab's keycaps). |
| `btn` / `btn-primary` | Pill button, uppercase mono. |
| `term-tag` | Bordered uppercase tag chip (`@tag`). |
| `glow-line` | Thin glowing phosphor divider. |
| `phosphor-glow` | Text glow for active/emphasis elements. |
| `led-dot` | Pulsing phosphor LED. |
| `term-caret` | Blinking block caret (`▮`). |
| `boot-screen` / `boot-splash` / `splash-*` | Boot sequence + glitch logotype (`BootSplash`). |
| `fade-in` | Generic entrance. |

## Motion & accessibility

- Animations: LED pulse, caret blink, CRT flicker, boot glitch — all hand-rolled CSS
  (no animation library dependency).
- `@media (prefers-reduced-motion: reduce)` disables flicker, glitch, pulse, and entrance
  animations, and the boot sequence fast-forwards.
- The CRT overlay is **opt-out** at runtime: the title-bar monitor button, Settings →
  Appearance, or the command palette. The preference persists to `localStorage`
  (`radar.crt-off`, owned by the theme engine).

## Radar

The Radar view (`views/RadarView.tsx`) is a `<canvas>` + `requestAnimationFrame` loop that plots
**projects** (one per `BLIP.md`). Pure math lives in `lib/radar.ts` (generic time‑scale, unit‑tested),
`lib/projectRadar.ts` (project→radar mapping), and `lib/taskDue.ts` (per‑task `(due …)` parsing).
Colors mirror the palette: accent `#00FF88`, time‑rings NOW/1 WEEK/1 MONTH/1 QUARTER/SOMEDAY;
`#FF3030` for overdue, `#FFB000` for "due soon", the category color otherwise.

**Distance from center** is a continuous, log‑compressed time‑to‑deadline (`projectRadiusFrac` →
`radiusFracForDays`) driven by the project's **effective deadline** — the *soonest of* its nearest
incomplete task's `(due …)` date and an optional project‑level hard `deadline` — falling back to the
fuzzy `horizon` band (today/week/someday). **Angle** is the project's **category sector** (`sectorBase`), drag‑pinnable
to a per‑project `radar_angle` (visual only — never reassigns the category). **Size** = priority;
same‑sector/same‑day blips **auto‑fan** (`layoutBlipAngles`, fanning *around* pinned obstacles, cached
on a data signature and recomputed live only mid‑drag).

**Fleets.** A project with tasks is a **hollow ring** holding one small "ship" marker per open task
(the ring grows with open‑task count); a project with no tasks is a single solid blip. Tasks may carry
an optional `(due …)` marker (chrono‑parsed) and ships tint by urgency (overdue = red, ≤2 days = amber,
else category). So "due someday *and* tomorrow" reads naturally — the project rings by its own deadline,
with a bright ship for the urgent task inside.

**Category compass.** Each category gets a faint colored wedge + a rim label, so *direction* around the
dial is meaningful (organize by category, not just distance).

**Interactive NOW center.** A real DOM hit-target sits over the bullseye (so it never fights the
overdue blips that pile up there). When anything needs attention the center pulses — **red** for
overdue, **amber** for neglected-only — with a count; clicking expands the **attention panel**:
overdue projects + overdue tasks + neglected projects, one click from selecting each.

**Drag** reschedules via the tested `scheduleForDrop` only when the drop changes day‑bucket (a pure
angular nudge just re‑pins; a near‑center drop un‑pins). A drop in the **someday band** clears the
deadline *and* pins `horizon: someday`, so the blip stays at the rim instead of snapping back to a
stale horizon band — placements land where you put them. **Right‑click** a blip for its menu (adopt/dismiss a ghost;
open/reset/archive/delete a project), or empty space to add a project / capture a task. **Status
visuals**: blocked pulses, shipped dims, archived hidden, a parse error is a dashed "signal‑lost" ring,
and an un‑adopted repo is a faint dashed **ghost**. Per‑task parsing + overdue derivation run in memos
off the rAF loop (refreshed on a slow tick); the canvas honors `prefers-reduced-motion`. Ported and
grown from the TerraByte `RADAR` project.

## Window chrome

The BrowserWindow is **frameless** (`frame: false`); the renderer draws its own `TitleBar`
(`RADAR//SYS` logotype, live clock, open-count, live version badge, the CRT + settings cluster,
minimize/maximize/close). Controls send
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
