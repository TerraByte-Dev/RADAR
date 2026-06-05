# RADAR — Settings & Theming Handoff

_Prepared 2026-06-05. The task for the next session: build a **robust, tabbed Settings** in RADAR —
centered on a **theme system** (the headline ask) — matching the TerraByte signature already in
**OpenEdu** and **TerraPlayer**, plus a handful of genuinely useful settings. Read this with
`CLAUDE.md`, `HANDOFF.md`, and `docs/DESIGN.md` (the TERRABYTE.SYS skin)._

## Goal

Replace RADAR's minimal Settings (today: a single "Workspace" dialog — scanned roots + dismissed
projects) with a **professional tabbed Settings surface**. The centerpiece is a **theme picker**
(recolor the CRT skin + offer clean Dark/Light "universal" themes that drop the scanlines), reusing
the exact pattern Tate already shipped in OpenEdu. Then add useful sections (radar behavior, updates/
about, data export, keyboard) without violating RADAR's invariants.

The CRT toggle + ⚙ Settings button already live in the **top bar** (`TitleBar.tsx`) as of this
session — that's the entry point; this task fills in what opens.

## ⚠️ Start here: commit the confirmed work first

Branch **`feat/close-the-loop`** has **three confirmed-good but UNCOMMITTED chunks** from the last
session (Tate said "this is good"). Commit them before starting, so this work lands clean:

```bash
git switch feat/close-the-loop        # already here

# 1) close the loop (git-seeded adopt + proactive /blip skill)
git add src/main/store/gitseed.ts src/main/store/gitseed.test.ts src/main/store/projects.ts \
        src/main/store/projects.test.ts skills/claude/blip/SKILL.md skills/codex/blip.md
git commit   # feat(radar): seed adopt from git history + proactive /blip self-feed

# 2) deadlines live on tasks (effective-deadline model)
git add src/renderer/src/lib/taskDue.ts src/renderer/src/lib/projectRadar.ts \
        src/renderer/src/lib/selectors.ts src/renderer/src/views/RadarView.tsx \
        src/renderer/src/views/CalendarView.tsx src/renderer/src/components/ProjectDetail.tsx \
        src/renderer/src/lib/*.test.ts docs/BLIP-SCHEMA.md CLAUDE.md HANDOFF.md
git commit   # feat(radar): deadlines live on tasks (effective deadline drives distance)

# 3) move CRT + Settings into the top bar (this session's last change)
git add src/renderer/src/components/TitleBar.tsx src/renderer/src/components/Sidebar.tsx
git commit   # feat(ui): move CRT + settings controls into the title bar
```

Gates are green as of handoff: `npm run typecheck` ✓ · `npm test` **128** ✓ · `npm run build` ✓.
Use the conventions in `CLAUDE.md` (Conventional Commits, `Co-Authored-By` trailer, don't push/merge
without Tate's review).

## The signature references (read these — don't reinvent)

### OpenEdu — the gold-standard theme system  ⭐
`C:\Users\tatew\Desktop\Tate\TerraByte Solutions LLC\Production\Products\OpenEdu`

- **`src/lib/theme.ts`** — the whole model in ~90 lines. A `THEMES: Theme[]` list where each theme is
  `{ id, name, blurb, family: 'crt' | 'universal', swatch: {bg, accent, ink} }`. The UI is **100%
  CSS-variable driven**: a theme is just a named bundle of CSS-var overrides declared as
  `[data-theme="…"]` blocks in `index.css`. `applyTheme(id)` sets `html[data-theme]`, reconciles the
  `crt-off` class, persists to `localStorage`, and dispatches a `oe-theme-change` event. CRT on/off is
  a **separate manual pref** (`crt-off` class + key) that only matters for `crt`-family themes —
  `universal` themes force the overlay off *without* clobbering the manual pref (so switching back
  restores it). `resolveCrtOff(theme, manualOff)` is the pure, unit-tested reconciliation.
- **`src/lib/useTheme.ts`** (`useThemeState`) — a hook that listens to the theme/CRT events so the
  titlebar toggle and the Appearance tab stay in sync.
- **`src/views/settings/sections/Appearance.tsx`** — the picker UI: a responsive grid of **swatch
  cards** (bg + glowing accent dot + ink bars), an active-ring + "CRT"/"Clean" family badge + blurb,
  and a separate "Scanline overlay" toggle row (disabled on universal themes).
- **`src/views/settings/Settings.tsx`** — the **shell**: left-rail tabs + a **search box** that filters
  sections by `label + keywords`, autosave with a "Saved ✓" footer flash, and a declarative `SECTIONS`
  registry. Primitives live in `src/views/settings/primitives` (`Section`, `SettingRow`, `Toggle`,
  `useSettings`, `matchText`) and the tab list in `…/registry`.
- **`src/lib/settings-schema.ts` / `settings-io.ts`** — versioned **export/import** of settings
  (`{ kind, version, theme, crtOff, settings, … }`) with sanitizing validation; unit-tested. A good
  model for a RADAR "Data" tab.
- **`theme.test.ts`** — pattern for unit-testing the theme/CRT reconciliation without a DOM.
- The `[data-theme]` CSS-var blocks live in OpenEdu's `src/index.css`. Skim them to see how a single
  block recolors the entire app.

### TerraPlayer — the tabbed-modal shell + updates/about pattern
`C:\Users\tatew\Desktop\TerraPlayer\src\components\Settings.tsx`

- A tabbed modal (left nav rail: `UPDATES / AUDIO / LIBRARY / ABOUT`, with disabled "SOON" tabs) and an
  **Updates pane** (check → download → progress bar → install&restart) + an "About" feel and a
  **danger-zone uninstall**. Good reference for a RADAR **Updates/About** tab — RADAR already ships
  electron-updater (`src/main/index.ts` auto-update, packaged only).
- `src/components/TitleBar.tsx` is the shared chrome signature RADAR's title bar already matches.

### RADAR — what exists today
- **`src/renderer/src/components/Settings.tsx`** — the current minimal modal (Radix `Dialog`, just
  "Workspace": scanned roots + dismissed). Either grow this into the shell or replace it; the data it
  manages (roots/ignored via `window.radar` config IPC) becomes the **Workspace** tab.
- **`src/renderer/src/components/TitleBar.tsx`** — already opens Settings and hosts the CRT toggle
  (reads `crtEffects` from the store, calls `toggleCrt`).
- **`src/renderer/src/components/CrtOverlay.tsx`** + store `crtEffects` (localStorage) — the current
  CRT mechanism. Fold this into the theme system (CRT becomes per-theme-aware, universal themes off).
- **`src/renderer/src/store/useStore.ts`** — UI prefs (`crtEffects`, `showCompleted`, `onboarded`) in
  localStorage. Add `themeId` here (or a dedicated `lib/theme.ts`, OpenEdu-style — preferred).

## 🔑 The one architectural decision: tokens → CSS variables

**RADAR's color tokens are hardcoded hexes in `tailwind.config.js`** (`phosphor: '#00FF88'`,
`ink: '#9bf5b8'`, `panel: '#020503'`, `term.cyan`, `p1`, …). They are **not** CSS-variable-backed, so
nothing can recolor them at runtime today. OpenEdu's whole theme system works *because* its tokens are
`var(--…)`. **So step 1 of theming RADAR is refactoring `tailwind.config.js` to map each color token
onto a CSS variable**, then defining the variable values in `src/renderer/src/styles/index.css` —
a default `:root` set plus one `[data-theme="…"]` override block per theme.

Pattern (Tailwind v3, alpha-channel safe):
```js
// tailwind.config.js
phosphor: { DEFAULT: 'rgb(var(--phosphor) / <alpha-value>)', bright: 'rgb(var(--phosphor-bright) / <alpha-value>)' },
ink: 'rgb(var(--ink) / <alpha-value>)', panel: 'rgb(var(--panel) / <alpha-value>)', /* … */
```
```css
/* index.css */
:root, [data-theme="terrabyte"] { --phosphor: 0 255 136; --ink: 155 245 184; --panel: 2 5 3; /* … */ }
[data-theme="amber"]   { --phosphor: 255 176 0;  --ink: 255 208 116; /* … */ }
[data-theme="dark"]    { --phosphor: 68 147 248; --ink: 201 209 217; --panel: 13 17 23; /* … */ }  /* universal: also drop CRT */
```
Store channels as space-separated RGB triples so `<alpha-value>` and existing `rgb(… / 0.x)` utilities
keep working. Default theme = the current TERRABYTE.SYS phosphor green (`terrabyte`), so nothing
regresses if the refactor is faithful.

### The RADAR-only wrinkle: the canvas
OpenEdu is pure DOM/CSS, so themes "just work." **RADAR draws the radar on a `<canvas>` with
hardcoded colors** — `ACCENT = '#00FF88'`, `SIGNAL_LOST`, `AMBER` in `RadarView.tsx`; the ring colors
in `lib/radar.ts` `TIME_RINGS`; and `categoryColor`/`PROJECT_COLORS` in `projectRadar.ts`/`palette.ts`.
Canvas can't read Tailwind classes. To theme the radar, read the resolved CSS variables at runtime via
`getComputedStyle(document.documentElement).getPropertyValue('--phosphor')` (cache them; recompute on
the theme-change event — not per rAF frame), or keep a small `themeId → {accent, rings…}` map. Decide
how far to theme the canvas: at minimum the accent/sweep + center; ideally the ring palette too. Keep
honoring `prefers-reduced-motion`. **This is the main extra work vs. OpenEdu — scope it explicitly.**

## Proposed plan (phased — each phase shippable + green)

1. **Theme engine** — add `src/renderer/src/lib/theme.ts` (OpenEdu-shaped: `THEMES`, `getThemeId`,
   `applyTheme`, `resolveCrtOff`, events) + a `useTheme` hook. Add an inline pre-paint script in
   `index.html` (or early in `main.tsx`) that reads `localStorage` and sets `data-theme` + `crt-off`
   **before first paint** (no flash). Unit-test the reconciliation. _No visual change yet._
2. **Tokenize** — refactor `tailwind.config.js` colors → `rgb(var(--…))` and define `:root` +
   `[data-theme]` blocks in `index.css`. Verify the default theme is byte-identical to today. Fold the
   existing `crtEffects` store pref into the new `crt-off` mechanism (keep one source of truth; update
   `TitleBar`'s toggle + `CrtOverlay` to read it).
3. **Theme the canvas** — make `RadarView`/`lib/radar` read accent + ring colors from CSS vars (cached,
   recomputed on theme change). 2–3 starter themes (terrabyte/amber/dark) to prove it end-to-end.
4. **Settings shell** — tabbed surface (rail + search + autosave footer), OpenEdu-style. Port the
   current Workspace dialog into a **Workspace** tab. Add the **Appearance** tab (theme swatch grid +
   CRT toggle row). Mount from `TitleBar`'s ⚙ (already wired).
5. **Fill out themes** — port OpenEdu's CRT family (green/amber/ice/synthwave/…) recolored to RADAR's
   tokens + universal Dark/Light. Update `docs/DESIGN.md` to document the theme tokens.
6. **More sections** (below), as time allows.

## Settings inventory (themes first, then useful additions)

- **Appearance** ⭐ — theme picker (CRT family + universal Dark/Light); CRT scanline toggle (moved
  here from titlebar's quick-toggle, which stays as the shortcut); optional: glow intensity,
  reduced-motion override, UI density/font scale.
- **Radar behavior** — neglected threshold (currently **hardcoded 30d** in `selectors.isNeglected` —
  make it a setting); default horizon/priority for newly adopted blips; show faded "done" ships;
  angular grouping category-vs-operation (a parked idea); someday-band behavior. (Some read in pure
  selectors → thread the value through, keep them testable.)
- **Workspace** — the existing scanned roots + dismissed projects + `maxDepth` (config IPC already
  exists in `src/main/store/config.ts`); default capture/Inbox location.
- **Updates / About** — version, check-for-updates (electron-updater is wired, packaged-only),
  release notes / repo links. Mirror TerraPlayer's Updates pane.
- **Data** — export/import settings (OpenEdu `settings-schema` pattern), "open config file",
  "reset radar layout/pins" (a `resetRadarLayout` action already exists in the store).
- **Keyboard** — a shortcuts reference (⌘K palette, `q`/⌘N quick-add, Esc); future: rebinding.

## Acceptance criteria & gotchas

- **No flash**: theme + crt-off apply before first paint (pre-paint inline script reading localStorage).
- **Default unchanged**: the `terrabyte` theme must render pixel-identical to today after tokenization.
- **One CRT source of truth**: reconcile the existing `crtEffects` store pref with the new theme
  `crt-off` so the titlebar toggle, Appearance toggle, and `CrtOverlay` never disagree (OpenEdu uses
  events for exactly this).
- **Canvas recolor** reads CSS vars off the rAF loop (cache + recompute on theme change); keep
  `prefers-reduced-motion`.
- **Invariants** (`CLAUDE.md`): local-first, no account; settings are UI prefs (localStorage) —
  workspace/config changes still go through the existing `window.radar` config IPC, never hand-written.
- **Tests + docs**: unit-test theme reconciliation + any settings-schema export/import (pure, DOM-free,
  like OpenEdu). Update `docs/DESIGN.md` with the theme tokens. `npm run build:core` first;
  typecheck + test + build green before "done".
- **Dev restart**: Settings is renderer-only (HMR is fine) *unless* you add config IPC for new knobs
  (e.g. `maxDepth`, neglected threshold persisted server-side) — those touch `src/main/**`, so fully
  restart `npm run dev` (the dev-restart gotcha in `HANDOFF.md`).

## First moves
1. Commit the three chunks (top of this doc). Confirm gates green.
2. Read OpenEdu `lib/theme.ts` + `Appearance.tsx` + `Settings.tsx`, and RADAR's `tailwind.config.js`
   + `styles/index.css` + current `Settings.tsx`.
3. Cut `feat/settings-themes` off `feat/close-the-loop` (or work the branch directly).
4. Do Phase 1 → 2 → 3 (engine → tokenize → canvas) before any picker UI, so theming is real end-to-end,
   then build the shell + Appearance tab. Tests + docs as you go.
