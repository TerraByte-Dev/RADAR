# Identity

**RADAR** — TerraByte's personal **project radar**. Every project you're working on is a **blip**
on a radar screen, fed by a plain-text **`BLIP.md`** in that project's root which your AI coding
agent keeps current via the **`/blip`** command. The loop: *agent writes state → plain file in your
repo → the desktop radar visualizes it, live*. Distance = deadline (continuous) or fuzzy horizon,
size = priority, color = category, angle = category sector (drag-pinnable). Opening a blip reveals
that project's task checklist + session log. Wears the **TERRABYTE.SYS** Y2K terminal / CRT
phosphor-green skin. Electron + React + TypeScript, **local-first, offline, no account** — you own
your state as Markdown files.

> Evolved from the ToDoPlus task app (see `docs/RADAR-PIVOT.md`). The repo is being renamed
> ToDoPlus → RADAR. Four invariants: **name = RADAR / unit = blip · AI-fed never micromanaged ·
> universal · local-first plain files you own.**

## Monorepo

npm workspaces. The bulletproof `BLIP.md` engine is vendored as a package and bundled into the app.

| Package | Path | Responsibility |
|---|---|---|
| **Engine** (`radar-blip`) | `packages/blip-core/` | Parse/merge/serialize `BLIP.md` with a **byte-faithful round-trip + atomic write** guarantee, the `radar-blip` CLI bin, and `skills install`. ESM (NodeNext). `npm run build:core` compiles it to `dist/` (bundled into the Electron main process via `externalizeDepsPlugin({ exclude: ['radar-blip'] })`). Schema of record: `docs/BLIP-SCHEMA.md`. |
| **Skills** | `skills/{claude/blip/SKILL.md,codex/blip.md}` | The `/blip` skills (single source of truth); `copy-skills.mjs` bundles them into the package at build. |
| **App** | repo root (`src/**`) | The RADAR desktop app. |

## Routing Table (app)

| Area | Path | Responsibility |
|---|---|---|
| Main process | `src/main/index.ts` | App lifecycle, **frameless** window, window-control IPC, global quick-add hotkey, **auto-update** (packaged only) |
| BLIP backend | `src/main/store/{projects,config,watch,workspace,selfwrite}.ts` | Scan roots for `BLIP.md` (+ ghost repos), read/write via the engine, chokidar live-watch (self-write-suppressed), config (roots + maxDepth + the app-managed workspace), Inbox blip. **Only code that touches disk.** Unit-tested (`projects.test.ts`, `workspace.test.ts`). |
| Radar IPC | `src/main/ipc/radar.ts` | Registers `radar:*` channels (scan/read/setFields/task/handoff/init/inbox/config/pickFolder/openPath/reveal/openInEditor) + pushes `radar:projects-changed`. (`ipc/handlers.ts` + `store/repository.ts` are the **dormant** legacy task store — removed in a later cleanup.) |
| Preload | `src/preload/index.ts` | Exposes typed **`window.radar`** (project model) + `window.api` (window controls, quick-add hotkey, platform). Types in `index.d.ts`. |
| Shared types | `src/shared/radar.ts` | `ProjectRecord`, `RadarConfig`, `BlipFieldPatch`, `RadarApi`, `Horizon`/`BlipStatus` (plain types — **no engine import**, so the renderer never pulls in node-only code). IPC channel names in `src/shared/types.ts`. |
| Renderer entry | `src/renderer/src/{main,App}.tsx` | `main.tsx` imports brand fonts + CSS; `App.tsx` composes TitleBar + Sidebar + view + dialogs + CRT/Boot/Onboarding overlays. Default `view` is `radar`. |
| Components | `src/renderer/src/components/` | `Sidebar`, `ProjectDetail`, `QuickAdd`, `CommandPalette`, `ActivityHeatmap`, `Onboarding`, `TitleBar`, `CrtOverlay`, `BootSplash` |
| Views | `src/renderer/src/views/` | `RadarView` (canvas project radar — default), `ProjectListView` (Due Soon / Neglected / Inbox / All), `CalendarView` (deadlines), `LogbookView` (heatmap + cross-project session feed) |
| State | `src/renderer/src/store/useStore.ts` | Zustand: `projects` from `window.radar.scan()` + live `onProjectsChanged`; UI/nav state; prefs (`crtEffects`, `showCompleted`, `onboarded`, localStorage); mutations (`setFields`/`taskOp`/`handoff`/`setRadarAngle`/`capture`/`adopt*`). |
| Logic | `src/renderer/src/lib/` | `radar.ts` (generic continuous time-scale math, unit-tested), `projectRadar.ts` (project→radar mapping), `taskDue.ts` (per-task `(due …)` parsing + urgency), `selectors.ts` (views/calendar/logbook/heatmap/neglected), `nlp.ts` (quick-add parser), `date.ts`, `palette.ts`, `useKeyboard.ts` |
| Theme | `src/renderer/src/styles/index.css` + `tailwind.config.js` | TERRABYTE.SYS phosphor tokens + CRT layer (see `docs/DESIGN.md`) |

## Stack & Conventions

- **Build:** electron-vite. **Always `npm run build:core` first** (the scripts `dev`/`build`/`package`/`test`/`typecheck` do this) so the engine `dist/` + types resolve. Editing `src/main/**` or `src/preload/**` restarts the main process.
- **Golden rule:** **never hand-edit a `BLIP.md`** — every write goes through the engine (atomic, round-trip-clean, never clobbers `# Notes` or unknown keys). A file that fails to parse becomes a "signal lost" blip and is never overwritten.
- **Radar:** `<canvas>` + rAF loop in `RadarView.tsx`. **Deadlines live on tasks:** distance = continuous log-compressed days to the project's *effective* deadline — the **soonest of** its nearest incomplete task `(due …)` and an optional project-level hard `deadline` (`datedDeadlineDays`/`daysUntilDeadline` → `radiusFracForDays`) — falling back to the horizon band when there's no dated driver; rings NOW · 1 WEEK · 1 MONTH · 1 QUARTER + SOMEDAY. Angle = **category sector** (drawn as a faint labeled wedge "compass"), drag-pinned to a per-project `radar_angle` (visual only); same-sector/same-day blips **auto-fan** (`layoutBlipAngles`, around pinned obstacles). A project with tasks is a **fleet** (hollow ring + one ship-marker per open task; ships tint by each task's `(due …)` urgency via `lib/taskDue.ts`); no tasks → a solid blip. The **NOW center** is interactive via a DOM hit-target over the bullseye (no canvas/blip fight): pulses red (overdue) / amber (neglected) with a count, click expands the **attention panel** (overdue projects + tasks + neglected). Drag **reschedules the driving milestone** (the nearest dated task, via `drivingTask`+`setTaskDue`) for a fleet, or sets the project `deadline` for a task-less blip — only when the drop changes day-bucket (someday band clears the date; `scheduleForDrop` pins `horizon: someday` for task-less blips). Right-click a blip (menu) or empty space (add/capture). Status visuals: blocked pulses, shipped dims, archived hidden, signal-lost dashed ring, **ghost** = faint dashed ring. Per-task parsing + overdue derivation run in memos off the rAF loop; layout cached on a data signature. Honors `prefers-reduced-motion`.
- **Universal capture:** the app-managed **Inbox `BLIP.md`** (in `<workspace>/Inbox/`). NLP quick-add (`#project` routes to that repo, else → Inbox) writes through the engine — the app is just another agent writing a plain file.
- **Ghost blips:** scan surfaces repos with `.git`/`CLAUDE.md`/`AGENTS.md` but no `BLIP.md`; one-click **Adopt** writes a fresh `BLIP.md`. Read anything; only ever *write* `BLIP.md`.
- **NLP:** chrono-node + a small tokenizer in `lib/nlp.ts` (`p1`–`p4`/`!n`, `#project`, `@tag`). Pure & unit-tested.
- **Data flow:** renderer → Zustand action → `window.radar` (preload) → `radar:*` IPC → engine → `BLIP.md` on disk; the watcher pushes `radar:projects-changed` back. The renderer never touches disk. UI prefs → localStorage.
- **Security:** `contextIsolation: true`, `nodeIntegration: false`, strict prod CSP. Quote paths with spaces; no literal BOM in source/commit messages.
- **Config files** (`tailwind.config.js`, `postcss.config.js`) are **CommonJS** — no `"type": "module"` in the app `package.json` (the engine package is ESM).
- **Scripts:** `npm run dev` · `npm test` (app + engine vitest) · `npm run typecheck` · `npm run build` · `npm run build:core` · `npm run package` (electron-builder) · `npm run blip -- <args>` (CLI from source). Release: `docs/RELEASING.md`.

## Goal

The single best local-first **project** radar: a bird's-eye view of everything you're building,
fed automatically by your AI agent (never micromanaged), owned as plain Markdown. Deadlines ×
fuzzy horizons, ghost-blip zero-setup adoption, a neglected-projects safety net, status visuals,
a session-log timeline + GitHub-style activity heatmap, NLP capture, and full keyboard control —
all wearing the TerraByte brand. **Deferred:** operations/sector zoom; git-fed heatmap signals.
