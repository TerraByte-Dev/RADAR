# ToDoPlus — Session Handoff

_Last updated: 2026-06-02_

A pointer for picking ToDoPlus back up in a fresh session. Read alongside **`CLAUDE.md`** (routing
table + conventions) and **`docs/DESIGN.md`** (the TERRABYTE.SYS skin). Your auto-memory index
(`MEMORY.md`) also loads the key durable facts.

## What ToDoPlus is right now

Local-only Electron + React + TS desktop to-do app wearing the **TERRABYTE.SYS** Y2K/CRT phosphor
skin. Feature-complete and green on all gates.

- **Radar** *(default view, the flagship)* — canvas radar; a blip's **distance from center = its real
  time-to-deadline** on a continuous log-compressed scale (NOW · 1 WEEK · 1 MONTH · 1 QUARTER rings +
  outer SOMEDAY band). Rotating sweep, pings, subtask progress arcs, priority-sized blips, overdue in
  red at the bullseye. **Drag a blip anywhere**: the radius reschedules it to the exact date under the
  cursor (live `+12D` preview) and the angle is **pinned** as a per-task `radarAngle` (visual only,
  doesn't change the project). Same-project/same-deadline blips **auto-fan** so they never stack;
  right-click (or the panel / header / palette "reset") clears a pinned angle. `lib/radar.ts` (pure
  math, unit-tested) + `views/RadarView.tsx`.
- **Today** — merged Today+Upcoming: dated tasks, overdue/today bright, future faded under a
  `▾ horizon` divider.
- **Calendar** — month grid, day panel, drag-to-reschedule, inline add.
- **Logbook** — activity feed across all tasks.
- **Completion** — strike-through **in place** (checklist-style), sinks to bottom; `showCompleted`
  toggle; Today only keeps *today's* completions (no pile-up).
- Subtasks, notes, activity timeline, projects, P1–P4, snooze, natural-language quick-add
  (`#project @tag p1 tomorrow 5pm`), command palette (`⌘/Ctrl+K`), global quick-add hotkey, full
  keyboard control.
- **Chrome** — frameless window, custom `TitleBar` (logo + live clock + window controls), CRT overlay
  (toggleable), boot splash. The **TerraByte globe-sword logo** is in the sidebar, boot splash, and
  installer icon (rendered `mix-blend-mode: screen` so the black backdrop drops out).

## State of play

- **Gates green:** `npm run typecheck` ✓ · `npm test` (59 tests) ✓ · `npm run build` ✓.
- **Git:** private repo `TerraByte-Dev/ToDoPlus`, branch `main`. git user is configured locally
  (TerraByte-Dev / terrabytedeveloper@gmail.com).
- **Related:** `TerraByte-Dev/TerraDeck` (private) is a history-preserving copy of TerraPlayer where
  the *combined* player+ToDo app will live — **not started**, docs only. Base TerraPlayer is untouched.
  See that repo's `TERRADECK.md` + `docs/INTEGRATION-PLAN.md`. (Out of scope for ToDoPlus sessions.)

## Run it

```bash
npm install          # if deps aren't present
npm run dev          # electron-vite dev (HMR) — launches into the Radar
npm test             # vitest: nlp, date, selectors, radar
npm run typecheck    # tsc (node + web)
npm run build        # production bundle
npm run package      # electron-builder → Windows NSIS installer (uses electron-builder.yml + build/icon.png)
```

## Working conventions (from `CLAUDE.md`)

- **Branch-first** — cut `type/short-desc` off `main` before real work; don't commit features to main.
- **Conventional Commits**; open PRs as **draft**; merge-commit; don't merge until tests pass.
- Run typecheck + tests + build before declaring anything done. This session also used an adversarial
  multi-lens **review workflow** (find → verify) for big features — worth repeating for substantial work.

## Gotchas

- Editing `src/main/**` or `src/preload/**` doesn't always hot-reload the Electron main process —
  **restart `npm run dev`** to pick up main/preload changes (frameless window, IPC, icon).
- **Real user data** lives in the OS userData dir (`%APPDATA%/todoplus/todoplus-data.json`), written
  atomically by `src/main/store/repository.ts` — the only code that touches disk. Don't break the
  schema; the repo normalizes/backfills older docs.
- UI prefs (`crtEffects`, `showCompleted`) persist to **localStorage**; the boot splash is gated by
  **sessionStorage** (plays once per launch). None of this is in the data file.
- Fonts are bundled offline via `@fontsource` (VT323, Share Tech Mono, IBM Plex Mono) and imported in
  `main.tsx` to satisfy the strict prod CSP. Inter was intentionally dropped (UI is all-mono).
- The radar canvas recomputes "now" every frame (so horizons stay live across midnight) and honors
  `prefers-reduced-motion`.

## Candidate next threads (pick or replace)

- **Radar polish:** snap-highlight the nearest ring while dragging; `j`/`k` to cycle blips by soonest
  deadline; click empty radar to quick-add at that horizon.
- **Recurring tasks** (repeat rules) and/or **due reminders** via native notifications.
- **Settings panel** — CRT intensity, data export/import (JSON backup — it's local-only), theme knobs.
- **Packaging/release** — produce a signed NSIS installer; consider `electron-updater` like TerraPlayer.
- **Logo polish** — a transparent-background PNG + proper multi-size `.ico` for a cleaner taskbar icon.
- **More tests** — component/interaction coverage (the radar interaction layer is only manually verified).

## First moves in a fresh session

1. Read `CLAUDE.md` + this file; skim `docs/DESIGN.md`.
2. `npm run dev` and confirm the Radar renders; `npm test` to confirm green.
3. Cut a branch for whatever you pick, then go.
