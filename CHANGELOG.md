# Changelog

All notable changes to RADAR. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [SemVer](https://semver.org/). The `radar-blip` engine tracks the app's version
while it stabilizes, but only moves in releases that actually change it — an app-only release
leaves the published engine where it is.

## [Unreleased]

## [2.0.2] — 2026-08-06

App-only — the `radar-blip` engine is unchanged and stays at 2.0.1 on npm.

### Fixed

- **Every task edit spiked the CPU, and the file watcher was the reason.** `startWatch` passed
  chokidar **glob** targets (`<root>/**/BLIP.md`). chokidar@3 applies its 1 s per-directory
  readdir throttle *only* to non-glob targets — `hasGlob` is set whenever the watch path differs
  from the resolved parent, and `nodefs-handler.js#_handleRead` skips the throttle for it
  entirely. So every raw change notification spawned a full `readdirp`: an `lstat` per dirent plus
  a micromatch evaluation against the glob. One atomic `BLIP.md` write fires ~10 notifications, so
  a single checkbox click paid that storm ten times over — measured at **4.5× the CPU** of the
  fixed path on an 8-project fixture, and far worse on a real workspace. It also starved the libuv
  threadpool the write itself was using, so the write slowed from ~4 ms to ~25 ms. The main thread
  never blocked, which is why it presented as fans and lag rather than a freeze.
  > Self-write suppression could never have helped: `isSelfWriteEcho` runs *after* chokidar has
  > already paid. Exactly one `change` was emitted per write and it was correctly swallowed.
  The watcher now watches the plain roots and filters by basename — which is also the shape
  chokidar 4 requires, since it removed glob support.
- **The watcher walked into every project it had already found.** `makeIgnored` mirrored the
  scanner's `SKIP_DIRS` + dot-dir rules but not its **boundaries**: `classify()` stops descending
  at a project (`BLIP.md`) or ghost (`.git`/`CLAUDE.md`/`AGENTS.md`) directory, and the watcher did
  not — so it walked, and held a watch handle on, the entire source tree of every blip it had
  already found. On a real 11-root workspace that was **1,492 directories and 30,362 files; with
  parity it is 15 and 12**, matching the scanner. The rule is applied to the root itself too, since
  a root is usually a single project folder rather than a container of them. A boundary directory
  still watches its own `BLIP.md` — that file is the entire point.
- **Typing a due date wrote a garbage date to disk, several times.** `<input type="date">` fires
  `change` for every keystroke that leaves a *complete* valid date, so typing a year emitted four
  of them — atomically persisting `(due 0002-08-12)`, `(due 0020-08-12)` and `(due 0202-08-12)` on
  the way to the real date, in unawaited writes that raced each other. Both date inputs (a task's
  `(due …)` and the project `deadline`) now commit on blur — and on unmount, so closing the panel
  with Escape flushes the edit rather than dropping it — the same shape `TextField` already used
  for text. Because the commit is now deferred, a task's date is referenced by its **text** rather
  than its list index: a rescan can reorder the queue between focus and blur, and a stale text ref
  fails loudly into a resync instead of quietly dating whatever slid into that slot.
- **The watcher could take the main process down.** `chokidar.watch(...)` had no `error` listener,
  and an unhandled `error` on an EventEmitter throws. A root that disappears mid-session (an
  unplugged drive, a renamed folder) now warns instead.
- **Adopting or deleting a project left the watcher's boundary map stale.** Only `addRoot` and
  `removeRoot` rebuilt the watcher, so deleting a `BLIP.md` — which makes the scanner start
  descending into that folder again — left any blip nested underneath it invisible to the live
  loop, silently. `radar:init` and `radar:delete` now rewatch too.

### Changed

- **The radar's per-frame date math moved into a memo.** `frame()` recomputed each blip's radius
  and layout fraction per contact per frame, and the layout cache built its *signature* by calling
  `deadlineWholeDays` — the key cost more than the value it guarded. That dragged a chrono parse of
  every dated task into all 60 frames a second (~1.2 ms/frame, 7.4% of a core). Now computed once
  per `(contacts, nowTick)` alongside `shipColors` — the same 2-minute tick the ship colours and
  the attention panel already used.
- **`taskDueDate` memoizes its chrono parse.** The same immutable task lines were re-parsed by the
  urgency sort comparator, `taskText`, the detail panel and the radar. Keyed by phrase *and
  reference hour*, so a duration like `(due in 3 hours)` still crosses midnight correctly instead
  of being frozen to the day it was first parsed on.

### Known — not fixed here

- **The radar canvas still repaints at 60 fps whether or not anything changed** (~190% of a core
  while the radar view is on screen; it drops to ~15% on any other view and ~0.3% minimized).
  The static backdrop — gradient, rings, wedges, spokes, ticks, labels — depends only on radius,
  DPR, palette and categories, and belongs on an offscreen canvas drawn once. Deliberately held
  back: it is the largest change of the set and wants visual review rather than a hotfix.

## [2.0.1] — 2026-08-06

### Fixed

- **Auto-update never worked — in any release.** `registerUpdates` did
  `import('electron-updater').then(({ autoUpdater }) => …)`, but electron-updater installs
  `autoUpdater` as a lazy getter on `module.exports`
  (`Object.defineProperty(exports, 'autoUpdater', { get: … })`). Node's CJS→ESM named-export
  detection (cjs-module-lexer) cannot see that getter shape, so the namespace has **no**
  `autoUpdater` key: the destructure yielded `undefined` and the very next statement
  (`autoUpdater.autoDownload = false`) threw — *before any listener was attached*, including
  the `error` one. The result was a check that reported nothing at all: no update, no
  up-to-date, no error, spinner forever. Deterministic, and present since v1.0.0.
  Verified under real Electron 33 / Node 20.18, and in the shipped `app.asar` of both 1.0.0
  and 2.0.0. Resolution now goes through `resolveAutoUpdater`, which falls back to
  `default.autoUpdater` (`module.exports`) and throws loudly rather than returning `undefined`.
  > Anyone on **1.0.0 or 2.0.0 must install 2.0.1 by hand once** — the code that fetches
  > updates is inside the broken binary, so no published release can reach it. From 2.0.1
  > onward the updater works.
- **An update failure could strand the UI on "scanning…"** — a rejected `invoke` is the one
  failure that never arrives on the event channel. Both `check()` and `download()` now catch it,
  and the main-process handlers report load failures the updater cannot report itself.
- **A stalled connection would wedge every later check for the process's lifetime.**
  electron-updater's HTTP timeout hooks `request.on('socket')`, which Electron's
  `net.ClientRequest` never emits, and `AppUpdater` caches its in-flight check promise until it
  settles. Checks are now bounded at 30 s.

### Added

- **An updater log** at `<userData>/logs/updater.log` (~25 lines, no new dependency). The bug
  above was invisible for six weeks precisely because nothing recorded it — and note that
  `autoUpdater.logger` alone would *still* have recorded nothing, since the failure was in the
  code that assigns the logger. This wraps the `import()` itself.

### Security

- **`radar-blip sessions` redaction missed several common credential shapes** — npm
  (`npm_…`), GitHub fine-grained (`github_pat_…`), GitLab, PyPI, DigitalOcean and Google
  API keys all passed through untouched. That matters more here than in most tools: a
  digest is fed to a model, which may quote it into a `# Session log` that gets committed.
  Added those patterns plus a catch-all for `_authToken=` / `_auth=` / `_password=`
  assignments, so an opaque token still gets caught by the shape of its assignment.

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
