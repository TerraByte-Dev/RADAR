# Identity

**RADAR** — TerraByte's local-first board for picking projects back up. Every tracked project
keeps a plain-text **`BLIP.md`** in its root: a one-line `now`, a task queue whose first open
task is the next step, and a newest-first session log. Coding agents keep it current through the
**`/blip`** skill and three Claude Code hooks; the desktop app reads every tracked project and
shows what was last worked on and the one next step. Recency is derived from git and file times,
never typed, and nothing is ever overdue. Electron + React + TypeScript, **no account, no server,
no telemetry**.

> Repo: **`TerraByte-Dev/RADAR`** (public). App and engine are both **3.0.0**.

## Monorepo

npm workspaces. The engine is a real package, compiled into the app and published to npm.

| Package | Path | Responsibility |
|---|---|---|
| **Engine** (`radar-blip`) | `packages/blip-core/` | The v3 document model (`src/core/`: parse, read model, edits, lint, sync payload, secrets), locked atomic writes (`io.ts`, `lock.ts`, `atomic.ts`), the registry (`registry.ts`), per-project state (`state.ts`), activity from git and file times (`activity.ts`, `git.ts`), `brief.ts`, `board.ts`, setup and doctor (`setup.ts`, `doctor.ts`), the Claude Code hooks and live sessions (`src/agents/claude/`), and the CLI (`src/cli/`). ESM, NodeNext, Node ≥ 22.12. Version 2 files are read and migrated by `core/` (`migrateFile`); the 2.x engine and its API are gone. Format of record: `docs/BLIP-SCHEMA.md`. |
| **Skills** | `skills/claude/blip/SKILL.md`, `skills/codex/blip.md` | The `/blip` skill and Codex prompt (single source of truth; `copy-skills.mjs` copies them into the package at build). Each carries the `<!-- radar-blip-skill vN -->` stamp setup looks for. |
| **App** | repo root (`src/**`) | The desktop app. |

## Routing table (app)

| Area | Path | Responsibility |
|---|---|---|
| Main process | `src/main/index.ts` | Lifecycle, window (hidden title bar, native controls overlaid and recoloured), single-instance lock, CSP, `setup.ensure()` on start, auto-update (packaged only). |
| Board | `src/main/board.ts` | The tracked records and their activity; polls only while the window is visible; pushes `project.changed` / `project.removed` / `activity.changed`. |
| IPC | `src/shared/ipc.ts` (the one route table), `src/main/ipc.ts`, `src/preload/bridge.ts` | Every route and event is declared once in `shared/ipc.ts`; main registers a handler for each, the preload forwards only those names as `window.radar`, and the renderer is typed by it. Every invoke resolves to `{ ok, data } | { ok: false, error }`. |
| System | `src/main/system.ts` | Open in editor (an absolute VS Code / Cursor executable, never one inside the project), reveal, `openExternal` (`http:`/`https:`/`mailto:` only). |
| Setup | `src/main/shim.ts`, `src/main/user-path.ts` | The `<data>/bin/radar-blip` shim that runs the bundled CLI (with the app's runtime when no Node ≥ 22.12 is on PATH), and the user PATH change, reached only through the `setup.path` confirmation. |
| Updates, window | `src/main/updater.ts`, `src/main/window-state.ts` | electron-updater (download on find, restart to install, 30 s bound on a check); window position and size. |
| Shared model | `src/shared/model.ts` | `ProjectRecord`, `Activity`, `EditOp` and the rest: type-only re-exports from `radar-blip`, so the renderer bundle never includes engine code. |
| Views | `src/renderer/src/views/` | `PickUp`, `ProjectPage`, `Scope`, `Log`, `Settings`, `FirstRun`. |
| Components | `src/renderer/src/components/` | `ContinueStrip`, `ProjectRow`, `NextCard`, `Queue`, `Editor`, `Scope`, `Digest`, `Palette`, `PickPopover`, `KeysSheet`, `TopBar`, `StatusBar`, `Toast`, `Banner`, atoms and glyphs. |
| Stores | `src/renderer/src/store/` | `board.ts` (records from `projects.list` + events), `shell.ts` (view, selection, overlays, toasts). |
| Logic | `src/renderer/src/lib/` | `derive.ts` (recency, groups, pickOrder, digest; pure, unit-tested), `scope.ts` (the scope layout; pure), `keymap.ts` (the one keymap table), `prompts.ts` (re-entry and catch-up prompts), `edits.ts`, `actions.ts`, `fuzzy.ts`, `prefs.ts`, `theme.ts`. |
| Styles | `src/renderer/src/styles/` | `tokens.css` (the only file with colour values), `app.css`, `fonts.css`. See `docs/DESIGN.md`. |

## Conventions

- **Never hand-edit a `BLIP.md`.** Every write goes through the engine: locked, atomic, all or
  nothing, every unmanaged byte copied. That includes this repo's own `BLIP.md` (RADAR tracks
  itself): use `/blip` at the end of a session.
- **The renderer never touches disk.** renderer → `window.radar.invoke(route)` → main → engine →
  `BLIP.md`; the board pushes the new record back. A new route goes in `shared/ipc.ts` first.
- **Owner fields are the owner's.** `name`, `due`, `focus`, `tags`, `links` and the statuses
  `paused` / `archived` change only when the owner asks. Agents write `now`, tasks, the log, and
  `active` / `blocked`.
- **Nothing is overdue, nothing is a guilt signal.** A due date is shown as a date only. Judge
  UI changes by whether they lower the cost of re-entering a project.
- **Design rules are tested:** colours only in `tokens.css`, no keyframes or animation loops,
  transitions only inside `prefers-reduced-motion: no-preference`, fonts only from the bundle,
  every key binding in `lib/keymap.ts`.
- **A `BLIP.md` is untrusted input** (cloned repos write them). No shell-string interpolation;
  every git call runs through `packages/blip-core/src/git.ts` (`systemGit().run`) with fsmonitor,
  hooks and the pager off; never `execFile('git', …)` directly.
- **Config files** (`tailwind.config.js`, `postcss.config.js`) are CommonJS: no `"type":
  "module"` in the app's `package.json` (the engine package is ESM).
- **Test data is invented.** `scripts/demo-data.mjs` builds one made-up developer's projects;
  no test, fixture, screenshot or doc may use a real project's name or text.
- **CPU:** the owner works on this machine. Run `npm test` and `npm run e2e` once per change,
  never in a loop; no load generators; one Electron instance at a time; kill what you start.
- Quote paths with spaces; no literal BOM in source or commit messages.

## Scripts

```bash
npm run dev          # build:core, then electron-vite dev (restart after editing src/main or src/preload)
npm run typecheck    # build:core + main, renderer and e2e projects
npm test             # app + engine vitest
npm run test:full    # the idle-machine timing numbers (RADAR_TEST_FULL=1)
npm run e2e          # build, then Playwright against the built app on the demo data
npm run demo         # build, then the app on the demo data
npm run package      # build:core, build, bundle:cli, electron-builder
npm run blip -- <args>   # the CLI from source (PowerShell: npm run blip "--" status)
```

Release: `docs/RELEASING.md`. README screenshots: `docs/screenshots/README.md`.
