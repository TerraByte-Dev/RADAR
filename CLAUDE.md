# Identity

**ToDoPlus** — a local-only desktop to-do app with Todoist-style natural-language capture,
full keyboard control, projects, priorities, subtasks, notes, an activity timeline, and a
calendar. Wears the **TERRABYTE.SYS** skin: a Y2K terminal / CRT phosphor-green aesthetic
shared across TerraByte apps (see `TerraPlayer`, `terrabyte-site`). Electron + React +
TypeScript, offline, no account.

## Routing Table

| Area | Path | Responsibility |
|---|---|---|
| Main process | `src/main/index.ts` | App lifecycle, **frameless** BrowserWindow, window-control IPC, global quick-add hotkey |
| IPC | `src/main/ipc/handlers.ts` | Bridges data channels to the repository (window controls live in `index.ts`) |
| Persistence | `src/main/store/repository.ts` | Local JSON document, atomic writes (only code that touches disk) |
| Preload | `src/preload/index.ts` | Exposes typed `window.api` (incl. `platform` + window controls); types in `index.d.ts` |
| Shared types | `src/shared/types.ts` | Domain types (`Task`, `Project`, `Priority`) + `IPC` channel names + `TodoApi` |
| Renderer entry | `src/renderer/src/{main,App}.tsx` | `main.tsx` imports brand fonts + CSS; `App.tsx` composes TitleBar + Sidebar + view + dialogs + CRT/Boot overlays |
| Components | `src/renderer/src/components/` | `Sidebar`, `TaskRow`, `TaskDetail`, `QuickAdd`, `CommandPalette`, `TaskContextMenu`, `ProjectContextMenu`, `PriorityFlag`, `TagChip`, `TitleBar`, `CrtOverlay`, `BootSplash` |
| Views | `src/renderer/src/views/` | `RadarView` (canvas radar — the default view), `TaskListView` (Today/Inbox/Completed/Project), `CalendarView` (month grid + day panel), `LogbookView` (activity feed) |
| State | `src/renderer/src/store/useStore.ts` | Zustand store: data + UI state + radar/calendar nav + prefs (`crtEffects`, `showCompleted`, persisted to localStorage) + all mutations. Default `view` is `radar`. |
| Logic | `src/renderer/src/lib/` | `nlp.ts` (quick-add parser), `date.ts` (+ calendar grid), `radar.ts` (blip horizon/angle math), `selectors.ts` (views, completion, calendar, radar), `palette.ts`, `useKeyboard.ts` |
| Theme | `src/renderer/src/styles/index.css` + `tailwind.config.js` | TERRABYTE.SYS phosphor tokens + CRT design-system layer (see `docs/DESIGN.md`) |

## Stack & Conventions

- **Build:** electron-vite (main/preload/renderer split, HMR). `npm run dev` to develop. Editing `src/main/**` or `src/preload/**` requires the dev server to restart the Electron main process.
- **UI:** React 18 + TS, Tailwind (theme tokens in `tailwind.config.js`), Framer Motion, Radix UI (menus/dialogs), cmdk (palette), lucide-react (icons).
- **Fonts:** bundled offline via `@fontsource` — VT323 (display), Share Tech Mono (LCD), IBM Plex Mono (UI/labels). Imported in `main.tsx` so the strict prod CSP stays satisfied. Inter is the `sans` token's body font but is left to the system fallback (UI is all-mono).
- **Aesthetic:** phosphor-green (`#00FF88`) on black; existing semantic tokens (`bg`/`surface`/`ink`/`accent`/`p1`–`p4`) are **remapped** onto the phosphor palette so legacy utilities render on-brand. New tokens: `phosphor.*`, `term.*`, `panel`, `lcd`, `rule`. CRT effects (scanlines/vignette/flicker) are a toggleable overlay (`CrtOverlay`, pref `crtEffects`).
- **Radar:** the flagship view (ported from the TerraByte `RADAR` project, adapted from project-blips to task-blips). A `<canvas>` + rAF loop in `RadarView.tsx`; pure math in `lib/radar.ts` (unit-tested). Distance from center is a **continuous, log-compressed time-to-deadline** (`daysUntilDue` → `radiusFracForDays`): dead-center = now, with labeled gridline rings (NOW · 1 WEEK · 1 MONTH · 1 QUARTER) and an outer SOMEDAY band; timed dues use fractional days, overdue eases into the bullseye. Angle defaults to the **project sector** but is freely draggable — dropping a blip pins a per-task `radarAngle` (visual only; **does not** change the project), and same-project/same-deadline blips **auto-fan** (`layoutBlipAngles`) so they don't stack on one spoke. Size = priority, color = project color (red if overdue). Dragging a blip reschedules to the **exact** date under the cursor (radius → inverse `daysFromFrac`) *and* pins its angle (`angleFromPoint`), with a live date preview; a pure angular nudge skips the reschedule so it doesn't pollute the activity timeline. Clear a pinned angle via right-click on the blip, the selected-panel "reset position", the header "reset layout", or the command palette.
- **Nav:** sidebar "Views" is intentionally trimmed to **Radar · Today · Calendar · Logbook**. Inbox/Snoozed/Completed are reachable via the command palette (`⌘/Ctrl+K`). **Today merges the old Today + Upcoming** — every dated task, with future-dated ones rendered faded under a "▾ horizon" divider (see `tasksForView`/`TaskListView`).
- **Completion UX:** completed tasks stay struck-through **in place** (checklist-style), sunk to the bottom of their list; `showCompleted` collapses them. In Today only tasks completed *today* linger (no pile-up); Inbox/Project keep the full checklist. They also remain in the Completed view + Logbook. See `tasksForView` in `selectors.ts`.
- **NLP:** chrono-node + a small tokenizer in `lib/nlp.ts` (`p1`–`p4`/`!n`, `#project`, `@tag`). Pure & unit-tested (`nlp.test.ts`).
- **Data flow:** renderer → Zustand action → `window.api` (preload) → IPC → `Repository`. The renderer never touches disk. UI prefs persist to localStorage, not the data file.
- **Config files** (`tailwind.config.js`, `postcss.config.js`) are **CommonJS** — no `"type": "module"` in package.json.
- **Scripts:** `npm run dev` · `npm test` (vitest) · `npm run typecheck` · `npm run build` · `npm run package` (electron-builder, Windows NSIS).

## Goal

The single best local-only to-do app: right-click context menus, projects, P1–P4 priorities,
subtasks, notes, an activity timeline (the flagship feature), natural-language quick-add, a
calendar with drag-to-reschedule, and full keyboard control — all wearing the TerraByte
brand. Researched against Todoist (NLP capture), Things 3 (keyboard-first UX), and
TickTick (breadth). Habits/Pomodoro remain deferred.
