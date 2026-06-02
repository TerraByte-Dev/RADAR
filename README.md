<div align="center">

# TODOPLUS//SYS

**A local-only desktop to-do app wearing the TerraByte Y2K-terminal skin.**

Natural-language capture · full keyboard control · projects · P1–P4 priorities · subtasks ·
notes · an activity timeline · a calendar — phosphor-green on black, offline, no account.

`Electron` · `React 18` · `TypeScript` · `Tailwind` · `Zustand`

</div>

---

## Why

Ideas come fast. ToDoPlus is the place to dump them without breaking flow — type a line,
hit enter, get back to work. It's offline-first (your data never leaves the machine), driven
almost entirely from the keyboard, and styled to match the rest of the **TerraByte Solutions**
toolkit (see [`TerraPlayer`](https://github.com/TerraByte-Dev/TerraPlayer) and
[`terrabyte-site`](https://github.com/TerraByte-Dev/terrabyte-site)): a CRT phosphor terminal
that boots like an old workstation and glows like a green-screen.

## Features

- **Radar** *(the default view)* — a CRT radar that plots your active tasks as blips where
  **distance from center is the actual time to the deadline** on a continuous, log-compressed scale:
  dead-center = now, with labeled gridline rings at **NOW · 1 WEEK · 1 MONTH · 1 QUARTER** and an
  outer **SOMEDAY** band for undated tasks. Timed tasks sit at fractional positions and creep inward
  as the hour approaches; overdue tasks pull into the bullseye (red). Angle = project, size =
  priority, color = the project's color. A sweep rotates and **pings** each blip as it passes;
  subtask progress draws an arc around it. **Drag a blip to reschedule it to the exact date under the
  cursor** — a live `+12D` preview follows your drag; drop it in the outer band to clear the date.
  Click a blip for full detail; hover for a quick readout. Adapted from the TerraByte `RADAR` project.
- **Natural-language quick-add** — `Pay rent tomorrow 5pm p1 #finance @home` parses the date,
  priority (`p1`–`p4` or `!1`–`!3`), project (`#`), and tags (`@`) automatically.
- **Strike-through completion** — checking a task crosses it out **in place** like a paper
  checklist; it sinks to the bottom of the list instead of vanishing. Toggle `show completed`
  to collapse the done items (they always stay in **Completed** + the **Logbook**).
- **Today (merged horizon)** — the old Today + Upcoming in one list: overdue and due-today tasks
  up top, future-dated ones faded below a `▾ horizon` divider so the whole runway is visible at once.
- **Calendar** — a month grid of your scheduled tasks. Click a day to see/triage it, drag a
  task to another day to reschedule (its time-of-day is preserved), and add straight into a day.
- **Subtasks** — break a task into a checklist with its own progress count.
- **Notes & Activity timeline** — freeform notes plus a running history (created, rescheduled,
  completed, reopened, snoozed) and follow-up notes per task. The **Logbook** aggregates every
  meaningful event across all tasks, grouped by day.
- **Projects** — color-coded, right-click to rename / recolor / delete.
- **Priorities** — P1–P4 flags that drive sort order.
- **Snooze** — hide a task until later today / tomorrow / the weekend / next week.
- **Command palette** (`⌘/Ctrl+K`) — jump to any view, run actions, toggle CRT effects.
- **Global quick-add hotkey** (`⌘/Ctrl+Shift+Space`) — capture from anywhere, even unfocused.
- **TERRABYTE.SYS skin** — boot sequence, CRT scanlines/vignette/flicker, phosphor glow,
  brushed-metal window controls, LCD panels. Toggle the CRT overlay any time (sidebar `CRT` /
  palette). Respects `prefers-reduced-motion`.

## Keyboard

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `⌘/Ctrl+K` | Command palette | | `x` / `space` | Toggle complete |
| `q` / `⌘/Ctrl+N` | Quick add | | `enter` | Expand / collapse |
| `j` / `↓` | Next task | | `s` | Star (mark active) |
| `k` / `↑` | Previous task | | `⌫` / `del` | Delete |

`⌘/Ctrl+Shift+Space` opens quick-add globally (works when the app isn't focused).

## Quick-add syntax

```
Ship the build friday 9am p1 #work @release
└──── title ────┘ └─ date ─┘ │   │       └ tag
                             │   └ project
                             └ priority  (p1–p4 or !1–!3)
```

## Develop

```bash
npm install      # includes bundled brand fonts (@fontsource/*)
npm run dev       # electron-vite dev with HMR
npm test          # vitest (nlp, selectors, date/calendar)
npm run typecheck # tsc, node + web projects
npm run build     # production bundle
npm run package   # electron-builder → Windows NSIS installer
```

> Editing `src/main/**` or `src/preload/**` restarts the Electron main process; renderer
> changes hot-reload.

## Architecture

```
src/
  main/          Electron main — frameless window, window-control IPC, global hotkey
    store/repository.ts   the ONLY code that touches disk (atomic JSON writes)
    ipc/handlers.ts       bridges data channels → repository
  preload/       typed window.api bridge (data + platform + window controls)
  shared/types.ts         domain types + IPC channel names + TodoApi (one source of truth)
  renderer/src/
    App.tsx               TitleBar + Sidebar + view + dialogs + CRT/Boot overlays
    components/           Sidebar, TaskRow, TaskDetail, QuickAdd, CommandPalette,
                          context menus, TitleBar, CrtOverlay, BootSplash, …
    views/                RadarView (canvas radar), TaskListView, CalendarView, LogbookView
    store/useStore.ts     Zustand: data + UI + radar/calendar + prefs + all mutations
    lib/                  nlp, date (+ calendar grid), radar (blip math), selectors, palette, useKeyboard
    styles/index.css      TERRABYTE.SYS design system (see docs/DESIGN.md)
```

**Data flow:** renderer → Zustand action → `window.api` (preload) → IPC → `Repository`.
The renderer never touches disk. UI preferences (CRT on/off, show-completed) live in
`localStorage`, separate from your task data.

**Your data** lives in a single JSON file in the OS user-data directory
(`%APPDATA%/todoplus/todoplus-data.json` on Windows), written atomically. No telemetry, no
network — the app works with the cable unplugged.

## Design system

The phosphor-green CRT skin is documented in [`docs/DESIGN.md`](docs/DESIGN.md) — color tokens,
fonts, and the reusable CSS classes (`lcd-panel`, `metal-key`, `term-tag`, `phosphor-glow`,
`crt-*`, …).

---

<div align="center">
<sub>TERRABYTE SOLUTIONS · LOCAL · OFFLINE · YOURS</sub>
</div>
