# RADAR — Session Handoff

_Last updated: 2026-06-04. The resume point for a fresh session._

Read alongside **`CLAUDE.md`** (architecture + routing table + conventions), **`docs/DESIGN.md`**
(TERRABYTE.SYS skin + the full radar spec), **`docs/BLIP-SCHEMA.md`** (the `BLIP.md` schema of
record), and **`docs/RELEASING.md`** (publishing). Origin story: `docs/RADAR-PIVOT.md`. Approved
build plan: `~/.claude/plans/linked-yawning-scroll.md`.

## What RADAR is

TerraByte's **personal project radar**. Every project you're working on is a **blip**, fed by a
plain-text **`BLIP.md`** in that project's root which your AI coding agent keeps current via
**`/blip`**. The loop: _agent writes state → plain file in your repo → the desktop radar visualizes
it, live._ Distance from center = deadline (continuous) or fuzzy horizon; size = priority; color =
category; angle = category sector. A project with tasks is a **fleet** (a ring of "ship" markers).
Local-first, offline, no account — you own your state as Markdown.

**Four invariants (never violate):** name = RADAR / unit = blip · AI-fed never micromanaged ·
universal (errand → deadline → project → operation) · local-first plain files you own.

It evolved from the ToDoPlus task app; the repo is `TerraByte-Dev/ToDoPlus` and will be renamed
**RADAR** at release.

## Where things stand

- **Branch `feat/9-radar-pivot` → draft PR #10 (Closes #9). NOT merged to `main`.** All work since
  the pivot lives here. `main` is the pre-pivot ToDoPlus + the 3 merged polish PRs.
- **Gates green:** `npm run typecheck` ✓ · `npm test` **112** (86 app + 26 engine) ✓ · `npm run build` ✓.
- **Monorepo (npm workspaces):** `packages/blip-core` = the bulletproof `radar-blip` engine (parse/
  serialize `BLIP.md`, byte-faithful round-trip + atomic writes, CLI, `/blip` skills). App at repo root.
- **Built so far (P0–P5 + several feedback rounds):** monorepo + vendored engine; `deadline`/
  `radar_angle`/`operation` fields; the `BLIP.md` main backend (scan + chokidar watch + config + Inbox
  + `window.radar` IPC); the project-radar renderer; **ghost blips** + adopt; Neglected view; status
  visuals; activity heatmap; onboarding; cross-platform packaging + electron-updater; **right-click
  removal** (archive/delete/dismiss + Workspace settings); the **BLIP.md boundary** scan; **fleets**;
  the **category compass**; the **interactive NOW center → attention panel** (overdue + neglected);
  **per-task `(due …)`** ship urgency; and a tested **`scheduleForDrop`** so drops land accurately.

## Run it

```bash
npm run dev          # build:core → electron-vite dev (HMR) → boots into the Radar
npm test             # vitest: app (renderer libs + main store) + engine
npm run typecheck    # tsc (node + web); build:core runs first
npm run build        # production bundle (engine bundles into the main process)
npm run package      # electron-builder (Win NSIS / mac dmg / linux AppImage)
npm run blip -- <args>   # the radar-blip CLI from source
```

First run creates the workspace + Inbox at **`~/Documents/RADAR/Inbox/BLIP.md`**; config lives at
`<userData>/radar-config.json`. UI prefs (`crtEffects`, `showCompleted`, `onboarded`) → localStorage.

## ⚠️ The dev-restart gotcha (important)

During this session, `electron-vite dev` did **not** reliably restart the Electron **main** process
when `src/main/**` or `src/preload/**` changed — the renderer hot-reloaded, but new **IPC channels
weren't registered** until a full restart. Symptom: a renderer action that calls a brand-new
`window.radar.*` method silently fails (the store now logs a `console.warn` instead of vanishing-then-
reappearing). **After any main/preload change, fully restart:** close the window (that exits
`npm run dev`) and re-run, or kill the tree and relaunch. Renderer-only changes are fine via HMR.

## Conventions (from `CLAUDE.md` + global)

- **Branch-first** off `main`; **Conventional Commits**; open PRs as **draft**; **merge-commit**;
  never merge red. End commit messages with the `Co-Authored-By: Claude …` trailer.
- **Never hand-edit a `BLIP.md`** — every write goes through the engine (atomic, round-trip-clean,
  never clobbers `# Notes`/unknown keys). A parse failure becomes a "signal-lost" blip, never overwritten.
- typecheck + test + build green before declaring anything done. Add tests + docs with each feature.

## Gotchas / mental model

- **Scan is boundary-stopped:** a folder with a `BLIP.md` is a project boundary — the scanner never
  descends into its subfolders. **Adopt a folder** = "this folder is one project" (writes its `BLIP.md`,
  only it shows). **Scan a workspace** (add root) = "find all projects under this parent" (surfaces
  child repos as **ghosts**). To remove something: right-click → Archive (hide) / Delete BLIP.md
  (remove file) / Dismiss (ghost); **⚙ Workspace** (sidebar footer) removes a scanned root.
- **Per-task due:** a task line may carry `(due friday)` / `(due 2026-07-01)` (chrono-parsed,
  `lib/taskDue.ts`) — tints its fleet ship by urgency and feeds the NOW attention panel. A project
  still rings the radar by *its own* deadline.
- **Radar math is pure + tested:** `lib/radar.ts` (generic time scale, fanning), `lib/projectRadar.ts`
  (project→radar mapping, `scheduleForDrop`, `currentDayBucket`), `lib/taskDue.ts`. Touch these with tests.
- The canvas recomputes "now" each frame (live across midnight) and honors `prefers-reduced-motion`.
  Per-task parsing + overdue/neglected derivation run in memoized selectors **off** the rAF loop.
- **Dormant legacy:** the old task store (`src/main/store/repository.ts`, `src/main/ipc/handlers.ts`,
  the task half of `TodoApi`, and `Task`/`Project` in `src/shared/types.ts`) is **unused but still
  compiled** (kept because `lib/nlp.ts` imports `Priority`/`DueDate`). Removing it cleanly is an open
  cleanup thread — leave it until you do that intentionally.

## Next focus — proper UX flow & UI feel

The mechanics and data model are solid and tested; the next pass is **how it feels to use.** Strong
candidate threads (pick, reorder, or replace):

- **Visual cohesion across the new surfaces.** `ProjectDetail`, `Settings`, `Onboarding`,
  `AttentionPanel`, the right-click menus, and the list views were built feature-first — give them a
  unified pass on spacing, hierarchy, motion, and the CRT skin (`docs/DESIGN.md` is the reference).
  Framer Motion is a dependency but barely used now; tasteful transitions (panel open, view switches,
  blip select) would lift the whole feel.
- **Navigation flow.** Clicking a sidebar/list project currently jumps to the radar and opens the
  detail aside. There's no dedicated "project page." Decide the canonical flow: radar-centric (select →
  aside) vs. a richer project view. Make selecting, opening, and going back feel obvious.
- **The detail panel.** Functional but dense (field editors + checklist + session log + links). Rework
  hierarchy; make the session-log timeline (the user's flagship love) shine; better task UX
  (inline due editing, reorder, the `(due …)` affordance is currently just placeholder text).
- **Capture & keyboard flow.** Quick-add (`q` / ⌘N) routes to Inbox or `#project`. Keyboard control is
  minimal right now (only ⌘K palette + quick-add) — the old Things-style `j/k/x/enter` nav was dropped
  in the pivot. Rebuild keyboard-first flow for projects if it fits the vision.
- **Empty / first-run states.** Onboarding exists but is basic; empty views and the "no contacts"
  radar could guide better. Make a brand-new user's first 60 seconds obvious.
- **Fleet & radar tuning** (parked ideas from testing): faded "done" ships so you see progress; a `+N`
  overflow when a fleet has >7 open tasks; let the angular grouping be **operation** vs **category**
  (a toggle); snap-highlight the nearest ring while dragging.
- **Operations (3rd tier).** The `operation` field round-trips and is editable, but the **sector-zoom**
  interaction (cluster projects into a zoomable wedge) is unbuilt — a big UX feature when ready.
- **Category management.** Categories are free-text today (no picker, color is hashed). A light
  category manager (rename, recolor, the compass legend) would help organization.

Deferred and tracked in PR #10: operations sector-zoom · git-fed heatmap signals · npm publish +
repo rename + code-signing (release prereqs) · removing the dormant legacy task stack.

## First moves in a fresh session

1. Read `CLAUDE.md` + this file; skim `docs/DESIGN.md` (skin + radar) and `docs/BLIP-SCHEMA.md`.
2. `git switch feat/9-radar-pivot`; `npm run dev` (confirm the Radar boots) and `npm test` (confirm green).
3. Adopt a couple of folders / add a workspace root so you have real blips to design against.
4. Pick a UX/UI thread above, cut a `type/short-desc` branch off `feat/9-radar-pivot` (or work the PR
   branch directly), and go — tests + docs as you ship. Restart `npm run dev` after any main/preload edit.
