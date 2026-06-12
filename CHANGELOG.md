# Changelog

All notable changes to RADAR. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [SemVer](https://semver.org/). The `radar-blip` engine is versioned with the app
until it stabilizes.

## [Unreleased]

The first RADAR release — evolved from the ToDoPlus task app
(origin story: `docs/RADAR-PIVOT.md`).

### Added

- **The project radar** (default view): every project is a blip fed by a plain-text `BLIP.md`.
  Distance = continuous log-compressed time to the *effective deadline* (soonest open task
  `(due …)` or an optional hard `deadline`, falling back to a fuzzy horizon band); size =
  priority; color + angle = category sector (drag-pinnable, auto-fanning). Fleets (one ship
  marker per open task, tinted by urgency), the interactive NOW center with an overdue/neglected
  attention panel, drag-to-reschedule, and right-click context menus.
- **The `radar-blip` engine + CLI** (`packages/blip-core`): parse/merge/serialize `BLIP.md`
  with a byte-faithful round-trip + atomic-write guarantee; `init`/`show`/`set`/`task`/
  `handoff`/`skills install`; the `/blip` skills for Claude Code + Codex.
- **Ghost blips**: repos with `.git`/`CLAUDE.md`/`AGENTS.md` but no `BLIP.md` surface faintly;
  one-click Adopt writes a fresh blip seeded from git history (honest recency + first log entry).
- **Universal capture**: NLP quick-add (`#project` routes to that repo, else the Inbox blip),
  global hotkey, command palette.
- **Views**: Due Soon / Neglected / Inbox / All lists, deadline calendar (drag to reschedule),
  Logbook (GitHub-style activity heatmap + cross-project session feed).
- **Settings + themes**: CSS-variable theme engine (8 CRT recolors + clean Dark/Light), tabbed
  Settings (Appearance / Radar / Workspace / Keyboard / Data / About), settings export/import,
  in-app auto-update flow.
- **TERRABYTE.SYS skin**: frameless window, BIOS boot splash, CRT overlay, phosphor glow.
- **RADAR brand art**: the radar-scope app icon (taskbar/installer/window, multi-size `.ico`) and
  the README masthead/hero/divider/social-preview assets (`docs/assets/`).
- A renderer **error boundary**: a crash in one view degrades gracefully instead of blanking
  the whole app.

### Removed

- The legacy ToDoPlus task stack (JSON task store, task CRUD IPC, task-grained types and
  helpers). Project state lives exclusively in per-project `BLIP.md` files you own.

### Fixed

- **Atomic-write durability**: engine writes flush to disk before the swap, so a crash
  mid-write can never leave a truncated or corrupt `BLIP.md`.
- **Engine round-trip fixes**: more `BLIP.md` shapes now survive parse → serialize
  byte-faithfully.

### Security

- Everything sourced from a `BLIP.md` is treated as **untrusted input**: external links and
  file open/reveal targets are allowlisted before the app acts on them. Threat model:
  `.github/SECURITY.md`.
