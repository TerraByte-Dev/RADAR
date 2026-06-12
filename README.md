<div align="center">

# RADAR//SYS

**A personal project radar. Every project you're building is a blip on the scope.**

Each blip is fed by a plain-text `BLIP.md` in that project's root, kept current by your AI
coding agent via `/blip`. The loop: *agent writes state → plain file in your repo → the
desktop radar visualizes it, live.* Phosphor-green on black, local-first, offline, no account.

`Electron` · `React 18` · `TypeScript` · `Tailwind` · `Zustand`

[![License: MIT](https://img.shields.io/badge/license-MIT-00E5A0)](LICENSE)
![Local-first](https://img.shields.io/badge/local--first-no%20account%2C%20no%20server-00E5A0)
![Platforms](https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-2f2f2f)
![Status](https://img.shields.io/badge/status-pre--1.0-orange)

<!--
  HERO ASSET — drop a capture of the radar here, then uncomment the line below.
  Suggested: docs/hero.png (or .gif), the radar view at 1180×800 with a few blips + one fleet.
  ![RADAR — the project radar](docs/hero.png)
-->

</div>

---

## Why

You don't need another task manager — you need to *see the whole fleet*: every repo, side
project, and errand on one screen, with the truth about what's due, what's blocked, and what
you've quietly abandoned. RADAR is that bird's-eye view, and you never feed it by hand. Your
coding agent writes a `BLIP.md` as you work; the radar watches the files and redraws within a
second. Your state is Markdown you own, in your repos, readable in any editor, versioned by git.

**Four invariants:** name = RADAR / unit = blip · AI-fed, never micromanaged · universal
(errand → deadline → project → operation) · local-first plain files you own.

## Status

**Pre-1.0.** Installers aren't published yet — build from source (see [Develop](#develop); it's
`npm install` + `npm run dev` and you're on the scope). The `radar-blip` npm package ships with
the v1 release; until then, `npm i -g ./packages/blip-core` gives you the CLI + skills locally.

## The radar

A live CRT scope (the default view) where:

- **Distance from center = time to the *effective deadline*** on a continuous, log-compressed
  scale — labeled rings at **NOW · 1 WEEK · 1 MONTH · 1 QUARTER**, plus an outer **SOMEDAY**
  band. The effective deadline is the *soonest of* the nearest open task's `(due …)` date and
  an optional project-level hard `deadline`, falling back to a fuzzy horizon
  (`today | week | someday`). Overdue pulls into the bullseye.
- **Size = priority** (1–5), **color + angle = category** — each category gets a labeled wedge
  ("compass"); same-sector, same-day blips auto-fan apart. Drag a blip around the dial to pin
  its angle (visual only).
- **A project with tasks is a fleet** — a hollow ring with one ship marker per open task, each
  tinted by its own due-date urgency. No tasks → a solid blip.
- **The NOW center is alive** — it pulses red (overdue) or amber (neglected) with a count;
  click it for the attention panel: overdue projects, overdue tasks, and projects you haven't
  touched in N days (threshold in Settings).
- **Drag to reschedule** — dropping a fleet on a new ring rewrites its *driving* task's
  `(due …)`; a task-less blip gets its `deadline` moved. The outer band clears the date.
- **Status visuals** — `blocked` pulses, `shipped` dims, `archived` hides, a `BLIP.md` that
  fails to parse shows a red dashed "signal lost" ring (and is never overwritten), and
  un-adopted repos appear as faint dashed **ghosts**.
- A rotating sweep pings blips as it passes. Honors `prefers-reduced-motion`.

## Features

- **Ghost blips + one-click adopt** — point RADAR at a folder of repos; anything with `.git`,
  `CLAUDE.md`, or `AGENTS.md` but no `BLIP.md` surfaces as a ghost. Adopting writes a fresh
  `BLIP.md` seeded honestly from git history (real recency + a first session-log entry from
  the latest commit). Read anything; only ever *write* `BLIP.md`.
- **Universal capture** — quick-add parses natural language (`Renew domain friday p1 #radar
  @admin`); `#project` routes the task to that repo's `BLIP.md`, anything else lands in the
  app-managed **Inbox** blip. Works globally via `Ctrl/⌘+Shift+Space`, even unfocused.
- **Views** — **Due Soon** (effective deadline ≤ 7 days, or a `today`/`week` horizon),
  **Neglected** (the safety net),
  **Inbox**, **All Projects**, a **Calendar** of task milestones + hard deadlines (drag chips
  between days to reschedule), and the **Logbook**: a GitHub-style activity heatmap over every
  project's session log plus a cross-project session feed.
- **Project detail** — field editors (horizon, deadline, priority, status, category, operation,
  next action), the task checklist with inline per-task `(due …)` editors, the session-log
  timeline, and links — every write goes through the engine.
- **Settings + themes** — a tabbed Settings dialog (searchable): 8 CRT recolors
  (TERRABYTE.SYS, Ice, Amber, Tangerine, Crimson, Vapor, Synthwave, Ultraviolet) + clean
  Dark/Light, CRT overlay toggle, neglected threshold, workspace roots, settings
  export/import, and in-app updates.
- **TERRABYTE.SYS skin** — BIOS boot sequence, CRT scanlines/vignette/flicker, phosphor glow,
  frameless window with a custom title bar. Same family as
  [`TerraPlayer`](https://github.com/TerraByte-Dev/TerraPlayer).

## The /blip loop

```sh
npm i -g radar-blip
radar-blip skills install     # → Claude Code + Codex /blip skills
```

At the end of a working session your agent runs `radar-blip handoff` — appending dated bullets
to the project's `# Session log` and updating `next_action`, atomically and round-trip-clean.
The app's watcher picks the write up live. The engine ([`packages/blip-core`](packages/blip-core),
npm name `radar-blip` — first publish lands with the v1 release; until then
`npm i -g ./packages/blip-core`) guarantees: **byte-faithful round-trips, atomic writes,
append-only session log, and it never touches `# Notes` or unknown frontmatter keys.** Never
hand-edit a `BLIP.md`; the CLI, the app, and the skill share this one engine, so they can't
disagree. This repo carries [its own `BLIP.md`](BLIP.md) — RADAR is a blip on its own radar.

## Keyboard

| Key | Action |
|---|---|
| `Ctrl/⌘+K` | Command palette (views, actions, jump to any project) |
| `q` / `Ctrl/⌘+N` | Quick capture |
| `Ctrl/⌘+Shift+Space` | **Global** quick capture (works when the app isn't focused) |
| `Esc` | Close dialog / deselect blip |
| any key | Skip the boot sequence |

## Quick-capture syntax

```
Ship the build friday 9am p1 #radar @release
└── title ───┘ └─ date ─┘ │  │      └ tag
                          │  └ project → that repo's BLIP.md (else Inbox)
                          └ priority  (p1–p4 or !1–!3)
```

## Develop

```sh
npm install
npm run dev        # build:core → electron-vite dev → boots into the radar
npm test           # vitest: app (renderer libs + main store) + engine
npm run typecheck  # tsc, node + web projects
npm run build      # production bundle
npm run package    # electron-builder → Win NSIS / mac dmg / linux AppImage
npm run blip -- <args>   # the radar-blip CLI from source
```

> Editing `src/main/**` or `src/preload/**` needs a full dev restart (new IPC channels don't
> hot-register); renderer changes hot-reload. In PowerShell, quote the arg separator when
> passing flags: `npm run blip "--" init --name X`. Releases: `docs/RELEASING.md`.

## Architecture

npm workspaces monorepo — the `BLIP.md` engine is a real package, bundled into the app.

```
packages/blip-core/       the radar-blip engine + CLI (parse/merge/serialize BLIP.md,
                          byte-faithful round-trip, atomic writes) + bundled /blip skills
skills/                   the /blip skill sources (claude + codex) — single source of truth
src/
  main/                   Electron main — frameless window, global hotkey, auto-update
    store/                scan roots for BLIP.md (+ ghosts), engine read/write, chokidar
                          watch, config, Inbox, git-seeded adopt — the ONLY code touching disk
    ipc/radar.ts          radar:* channels + live projects-changed push
  preload/                typed window.radar (project model) + window.api (app chrome)
  shared/                 ProjectRecord/RadarConfig/RadarApi types + IPC channel names
  renderer/src/
    views/                RadarView (canvas scope), ProjectListView, CalendarView, LogbookView
    components/           Sidebar, ProjectDetail, QuickAdd, CommandPalette, Settings + tabs,
                          Onboarding, TitleBar, CrtOverlay, BootSplash, ActivityHeatmap
    store/useStore.ts     Zustand: projects from scan + live watch; UI state; prefs
    lib/                  pure, unit-tested math + parsing: radar/projectRadar (time scale,
                          fanning, effective deadline), taskDue, nlp, selectors, theme, date
    styles/index.css      TERRABYTE.SYS design system + CSS-variable themes (docs/DESIGN.md)
```

**Data flow:** renderer → Zustand action → `window.radar` (preload) → `radar:*` IPC → engine →
`BLIP.md` on disk; the watcher pushes changes back. The renderer never touches disk.

**Your data:** per-project `BLIP.md` files in *your* repos (schema: `docs/BLIP-SCHEMA.md`),
plus an app-managed workspace at `~/Documents/RADAR` (Inbox). App config lives in
`<userData>/radar-config.json`; UI prefs in `localStorage`. No telemetry, no network — the
only optional network call is the update check.

## Security model

A `BLIP.md` is **untrusted input** — the app parses any blip it finds, including in repos you
cloned but didn't write. So: links from blip content are allowlisted (`http:`/`https:` only),
nothing in a blip is ever executed, and the renderer never touches disk (context isolation, no
node integration, strict CSP — every write funnels through the typed IPC surface into the
engine). Everything runs locally; the update check is the only network call. Vulnerability
reports: [`.github/SECURITY.md`](.github/SECURITY.md).

## Design system

The phosphor CRT skin + the theme engine are documented in [`docs/DESIGN.md`](docs/DESIGN.md) —
tokens, fonts, reusable classes, the theme registry, and the full radar rendering spec.

---

<div align="center">
<sub>TERRABYTE SOLUTIONS · LOCAL · OFFLINE · YOURS</sub>
</div>
