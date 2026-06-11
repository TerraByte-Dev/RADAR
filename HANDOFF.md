# RADAR — Session Handoff

_Last updated: 2026-06-11. The resume point for a fresh session._

Read alongside **`CLAUDE.md`** (architecture + routing table + conventions), **`docs/DESIGN.md`**
(TERRABYTE.SYS skin + the full radar spec), **`docs/BLIP-SCHEMA.md`** (the `BLIP.md` schema of
record), and **`docs/RELEASING.md`** (publishing). Origin story: `docs/RADAR-PIVOT.md`.

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

- **The whole pivot is a review stack of draft PRs, none merged.** `main` is still the pre-pivot
  ToDoPlus + the 3 merged polish PRs. The stack, bottom-up:
  1. `feat/9-radar-pivot` → **draft PR #10** (Closes #9) — the pivot itself.
  2. `feat/close-the-loop` → **draft PR #11** (git-seeded adopt, deadlines-on-tasks, title-bar chrome).
  3. `feat/settings-themes` → **draft PR #12** (theme engine + tabbed Settings).
  4. `chore/13-ship-v1` → **draft PR #14** (Closes #13) — the ship-v1 cleanup (legacy stack deleted,
     RADAR rebrand finished, README/DESIGN rewritten, publish-ready engine, dogfood `BLIP.md`).
  5. `fix/15-agent-ready-public-prep` → **draft PR #16** (Closes #15) — the pre-public hardening
     (59-agent adversarial audit → 39 confirmed findings, all fixed: security allowlists + IPC
     guards, engine round-trip + concurrency bulletproofing, error boundary, launch sequencing).
  Review top-down or bottom-up, then merge each into its base (merge commits, per convention).
- **Gates green:** `npm run typecheck` ✓ · `npm test` **212** (154 app + 58 engine) ✓ ·
  `npm run build` ✓ · dev smoke under `sandbox: true` ✓.
- **Monorepo (npm workspaces):** `packages/blip-core` = the bulletproof `radar-blip` engine (parse/
  serialize `BLIP.md`, byte-faithful round-trip + atomic writes, CLI, `/blip` skills). App at repo root.
- **Built so far (P0–P5 + several feedback rounds):** monorepo + vendored engine; `deadline`/
  `radar_angle`/`operation` fields; the `BLIP.md` main backend (scan + chokidar watch + config + Inbox
  + `window.radar` IPC); the project-radar renderer; **ghost blips** + adopt; Neglected view; status
  visuals; activity heatmap; onboarding; cross-platform packaging + electron-updater; **right-click
  removal** (archive/delete/dismiss + Workspace settings); the **BLIP.md boundary** scan; **fleets**;
  the **category compass**; the **interactive NOW center → attention panel** (overdue + neglected);
  **per-task `(due …)`** ship urgency; and a tested **`scheduleForDrop`** so drops land accurately.
- **Session 2026-06-05 (on `feat/close-the-loop`, now PR #11):** close the loop (git-seeded adopt +
  self-feeding `/blip` skills) · deadlines live on tasks (effective deadline, driving-milestone drag,
  inline per-task due editors — see memory `deadlines-live-on-tasks`) · CRT + Settings into the title bar.
- **Session 2026-06-11 — the ship-v1 cleanup (`chore/13-ship-v1`, PR #14, Closes #13):**
  1. **Legacy stack deleted for real** (it had still been *live* — `Repository.open()` +
     `registerIpcHandlers()` ran every launch): `repository.ts`, `handlers.ts`, the task IPC channels,
     `Task`/`Project`/`AppData` types, the task half of `window.api` (`TodoApi` → slim `AppApi`), and
     the dead Task-typed exports in `lib/{radar,date,palette}.ts` (+ their tests). `Priority`/`DueDate`
     survive for quick-add. `framer-motion` dropped (zero imports).
  2. **Rebrand finished:** BootSplash boots RADAR (BIOS lines describe the real subsystems), title-bar
     version badge reads `app.getVersion()` live, `index.css` header, README fully rewritten for RADAR,
     `docs/DESIGN.md` staleness table fixed, `CHANGELOG.md` + root `LICENSE` added.
  3. **Publish-ready engine:** `radar-blip` has `prepublishOnly` (dist/ + skills/ are git-ignored — an
     unbuilt publish would have shipped an empty tarball silently), `sideEffects: false`, self-contained
     source maps, a synced README (+ annotated `BLIP.md` example). Root manifest is `private: true`.
     `npm pack --dry-run` verified clean (33 files). The name is unclaimed on npm.
  4. **Dogfood:** the repo carries its own engine-written `BLIP.md` (P1 / Product / week + the v1
     release prereqs as tasks). Run the `/blip` handoff at session end. The documented
     `npm run blip -- <args>` script now actually exists (it didn't).
- **Session 2026-06-12 — pre-public hardening (`fix/15-agent-ready-public-prep`, PR #16, Closes #15):**
  a 6-lens adversarial audit (agent contract, security, durability, CLI fuzz, repo hygiene, schema
  edges) confirmed 39 findings; every one is fixed. Highlights: BLIP.md `links:` could *execute*
  local files (now scheme-allowlisted end-to-end); `exec('code "path"')` injection (now constant-cmd
  + cwd); the engine's round-trip guarantee broke on fenced `# Tasks` headings and prose inside the
  Tasks section (now fence-aware + line-preserving); read-modify-write clobbered concurrent writers
  (new `updateBlip` optimistic concurrency, used by CLI + app); self-write suppression swallowed
  agent writes for 1.5 s (now content-hash echo detection); one garbage `deadline:` white-screened
  the whole app (now guarded + ErrorBoundary); IPC paths validated (`ipc/guard.ts`); `sandbox: true`
  (dev-smoke-tested); single-instance lock. **Launch sequencing is now load-bearing** — see
  `docs/RELEASING.md`: npm-publish *before* going public (the skills' `npx -y radar-blip` fallback +
  an unclaimed name = squatter code-execution), and a private `TerraByte-Dev/RADAR` prototype repo
  blocks the rename until freed.

## Run it

```bash
npm run dev          # build:core → electron-vite dev (HMR) → boots into the Radar
npm test             # vitest: app (renderer libs + main store) + engine
npm run typecheck    # tsc (node + web); build:core runs first
npm run build        # production bundle (engine bundles into the main process)
npm run package      # electron-builder (Win NSIS / mac dmg / linux AppImage)
npm run blip -- <args>   # the radar-blip CLI from source (PowerShell: npm run blip "--" <args>)
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
- **Deadlines live on tasks:** a task line may carry `(due friday)` / `(due 2026-07-01)` (chrono-parsed,
  `lib/taskDue.ts`, editable inline in `ProjectDetail` + on the calendar). A project's radar distance
  is its **effective deadline** — the *soonest of* its nearest incomplete task `(due …)` and an
  optional project-level hard `deadline` (the task-less "whole thing is due X" / errand case),
  falling back to the fuzzy horizon. Dragging a fleet reschedules its driving milestone; dragging a
  task-less blip sets the project deadline. (`isOverdueProject` stays hard-deadline-only so late tasks
  aren't double-counted in the NOW panel.)
- **Radar math is pure + tested:** `lib/radar.ts` (generic time scale, fanning), `lib/projectRadar.ts`
  (project→radar mapping, `datedDeadlineDays`/effective deadline, `scheduleForDrop`, `currentDayBucket`),
  `lib/taskDue.ts` (`nearestTaskDue`/`drivingTask`/`setTaskDue`). Touch these with tests.
- The canvas recomputes "now" each frame (live across midnight) and honors `prefers-reduced-motion`.
  Per-task parsing + overdue/neglected derivation run in memoized selectors **off** the rAF loop.
- **No legacy left:** the old ToDoPlus task store is fully deleted (PR #14). `shared/types.ts` now
  holds only `Priority`/`DueDate` (quick-add value types), the IPC channel names, and the slim
  `AppApi`. `BLIP.md` is the only data model.

## ✅ Done — robust Settings + theming  (on `feat/settings-themes`, PR #12)

Shipped the full theme system + tabbed Settings (5 phases):
1. **Theme engine** (`lib/theme.ts`): `THEMES` registry (8 CRT recolors + clean Dark/Light), `applyTheme`/
   `resolveCrtOff`/`getThemeId` + `radar-theme-change`/`radar-crt-change` events, `useTheme` hook, and a
   pre-paint `themeBoot()` (no flash). CRT is one source of truth — the `html.crt-off` class (engine-set)
   gates the overlay + grid in CSS; the store's `crtEffects` is a synced mirror; the legacy pref migrates.
2. **Tokenize**: every Tailwind color → `rgb(var(--…-rgb) / <alpha-value>)`; `:root` channel triples +
   derived tokens + one `[data-theme]` block per theme in `index.css`. Default `terrabyte` is byte-identical.
3. **Canvas theming** (`lib/radarColors.ts`): RadarView reads accent/ink off the CSS vars (cached, recomputed
   on theme-change, off the rAF loop). Scope chrome themes; **semantic data colors stay fixed**.
4. **Settings shell** (`components/Settings.tsx` + `settings/`): tabbed dialog (rail + search + autosave),
   OpenEdu-shaped, re-skinned to TERRABYTE.SYS. Tabs: Appearance (theme picker + CRT toggle), Radar
   (neglected threshold — now a real setting), Workspace, Keyboard, Data (export/import + reset layout),
   About (version + electron-updater check→download→install via a new `window.api` update surface).
5. **Docs**: `docs/DESIGN.md` → a **Themes** section (token model, registry, CRT mechanism, canvas recolor).

Verified live (boot clean + a synthwave recolor + the open Settings shell, screenshotted). **Known caveat:**
the universal **Light** theme is best-effort — the token system recolors the bulk, but the radar canvas +
hardcoded `bg-black/40` scrims are inherently dark-scope, so Light is usable, not pixel-polished. Dark + the
CRT family are excellent.

## Next focus — Tate's call

**The whole pivot is built, cleaned, and waiting on review.** The highest-leverage move now is not
more code: review the PR stack (#10 ← #11 ← #12 ← #14), merge it down, then run the v1 release
prereqs that only Tate can do — **publish `radar-blip` to npm** (guarded by `prepublishOnly`),
**rename the repo ToDoPlus → RADAR + make it public** (electron-builder `publish.repo` + auto-update
already point at `TerraByte-Dev/RADAR`; flip `About.tsx`'s repo link after), and **code-signing**
(`docs/RELEASING.md`). Then dogfood mornings against the real portfolio (memory:
`radar-spine-dogfood-the-loop`). After that, pick from the **Standing UX backlog** below.

### Standing UX backlog (after / alongside settings)

The mechanics and data model are solid and tested; this is the longer **how it feels to use** list.
Strong candidate threads (pick, reorder, or replace):

- **Visual cohesion across the new surfaces.** `ProjectDetail`, `Settings`, `Onboarding`,
  `AttentionPanel`, the right-click menus, and the list views were built feature-first — give them a
  unified pass on spacing, hierarchy, motion, and the CRT skin (`docs/DESIGN.md` is the reference).
  framer-motion was dropped in ship-v1 (zero imports) — reintroduce a motion lib (or hand-rolled
  CSS transitions) if panel-open / view-switch / blip-select motion is wanted.
- **Navigation flow.** Clicking a sidebar/list project currently jumps to the radar and opens the
  detail aside. There's no dedicated "project page." Decide the canonical flow: radar-centric (select →
  aside) vs. a richer project view. Make selecting, opening, and going back feel obvious.
- **The detail panel.** Functional but dense (field editors + checklist + session log + links). Rework
  hierarchy; make the session-log timeline (the user's flagship love) shine; further task UX (reorder,
  natural-language due entry). _(Inline per-task `(due …)` editing now ships — a date input per open
  task in `ProjectDetail` + drag-on-calendar.)_
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

Deferred and tracked in PR #10: operations sector-zoom · git-fed heatmap signals. Release prereqs
(npm publish · repo rename · code-signing) are now tasks in this repo's own `BLIP.md`.

## First moves in a fresh session

1. Read `CLAUDE.md` + this file; skim `docs/DESIGN.md` (skin + radar) and `docs/BLIP-SCHEMA.md`.
2. `git switch chore/13-ship-v1` (the stack tip); `npm run dev` (confirm the Radar boots) and
   `npm test` (confirm green, 140).
3. Check `BLIP.md` at the repo root — it is the live state of this project; keep it current
   (`/blip` handoff at session end, every write through the engine).
4. If the stack has merged, branch off `main`; otherwise branch off the stack tip. Tests + docs as
   you ship. Restart `npm run dev` after any main/preload edit.
