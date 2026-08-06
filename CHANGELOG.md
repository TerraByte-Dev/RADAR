# Changelog

All notable changes to RADAR. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [SemVer](https://semver.org/). The `radar-blip` engine is versioned with the app
until it stabilizes.

## [Unreleased]

## [2.0.0] — 2026-08-05

**Breaking (`radar-blip`):** `BlipFields.next_action`, `Blip#setNextAction`, and
`CreateBlipOptions.next_action` are gone from the published package's public types — a
compile-time break for any external consumer. `BLIP.md` files themselves are **not** breaking:
a legacy `next_action` key migrates itself into task #1 on the first write.

### Added

- **`radar-blip sync`** — one JSON reconciliation (session-log lines + task adds/dones/edits/
  removals + field changes) applied in a **single atomic write**. Every task ref, whether a
  1-based position or exact text, resolves against the pre-sync snapshot, so ops can't shift
  each other; a bad ref fails the whole sync without writing a byte. `--dry-run` prints the plan.
- **`radar-blip sessions`** — digests this folder's Claude Code transcripts
  (`~/.claude/projects/<slug>/*.jsonl`, streamed) since `last_session` into a compact
  prompts / files-written / commands / commits summary. Exploration noise is filtered out and
  token-shaped strings are redacted. This is what lets `/blip sync` reconcile against what a
  session *actually did* rather than what the agent remembers.
- **`radar-blip hook stop`** — a Claude Code **Stop** hook that nudges the agent to run
  `/blip sync` when a session in a tracked repo ends with unlogged work. Fires at most once per
  session, silent in untracked repos, and fails open.
- **`radar-blip task add --top`** and **`task mv <n|text> <to>`** — put a task at the head of the
  queue, i.e. make it the next action. Same op in the app: hover a task and click ⤒.
- **The archive shelf** — a chip in the radar's bottom-left dead space opens a panel listing
  archived and shipped projects with Restore / Reveal / Delete. Archived projects were previously
  invisible and unrecoverable from the UI.

### Changed

- **`next_action` is retired.** The task queue is the plan: tasks are in priority order and the
  first unchecked one *is* the next action. The field is gone from the schema, the CLI, the app
  model, and the detail panel; the **first write of any kind migrates** a legacy value into task
  #1 and drops the key. `--next` survives as a deprecated alias for "insert as the top task".
- **The `/blip` skill is now a deterministic five-step `sync` routine** (read state → read the
  session → reconcile → one write → report) instead of prose, with explicit failure modes and
  double-log avoidance.
- **Neglect is no longer unclearable.** `isNeglected` only ever consulted `last_session`, which
  only `handoff` writes — so nothing done in the app could clear the centre ring. A project with
  a dated driver (a task `(due …)` or a hard `deadline` — exactly what dragging a blip from the
  rim onto a dated ring writes) is now never neglected, `paused` opts out alongside
  `shipped`/`archived`, and an overdue project no longer double-counts as neglected too. The
  attention panel gained an inline **Archive** action so the escape hatch is where the problem is.
- **The radar header no longer runs across the scope.** It is measured against the dial's own
  geometry and confined to the dead space beside it, and the long meta line is now a short
  stacked block. The radar circle itself is unchanged — nothing shrinks it.
- `# Tasks` rendering honors task *order* as well as identity: reordering re-slots the checklist
  through the original lines, so interleaved prose, sub-bullets, and fenced examples still
  round-trip verbatim.

## [1.0.0] — 2026-06-19

The first RADAR release.

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

- The legacy task stack (JSON task store, task CRUD IPC, task-grained types and
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
