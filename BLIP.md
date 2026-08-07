---
name: RADAR
horizon: week
priority: 1
category: Product
status: active
operation: TerraByte
created: 2026-06-20
last_session: 2026-08-06T21:26:16.663Z
---

# Tasks
<!-- RADAR-owned checklist. Edited by the app and `radar-blip task ...`. -->
- [ ] Fix the task due-date input writing one atomic BLIP.md per keystroke - commit on blur like TextField does
- [ ] Watcher: drop the **/BLIP.md glob watch target, watch the roots, and give makeIgnored the scanner project/ghost boundary parity
- [ ] Hoist the per-frame date math out of the RadarView rAF loop - its layout-cache signature does the work the cache exists to avoid
- [ ] Memoize taskDueDate on a day key so every caller stops re-parsing the same phrase
- [ ] Cut the rAF loop idle burn - ablate to apportion the cost, then move the static backdrop offscreen
- [ ] Eyeball the radar header + archive chip in a running window (wide / tall / near-square) — no component test covers them
- [ ] v1.1: build an in-app bulk-adopt/triage wizard — productize the manual ClaudeHub scoping flow we just ran by hand.
- [ ] Dogfood /blip sync for a week, then tune the Stop hook's substantive-work threshold
- [x] Publish radar-blip to npm (2FA + --provenance)
- [x] Cut the v1.0.0 GitHub release
- [x] Flip the repo public + upload the social preview
- [x] Publish radar-blip v1.1.0 to npm (sync + sessions + hook)
- [ ] Update the README screenshots for v2.0.x - the radar header and the archive shelf

# Session log
<!-- Append-only. `radar-blip handoff` adds a dated entry; prior entries are never rewritten. -->

## 2026-06-20 — TerraByte
- RADAR dogfoods its own format: this BLIP.md is the project's live state, kept current by the /blip skill.

## 2026-06-21 — Tate + Claude
- Shipped v1.0.0 — radar-blip published to npm, public GitHub release cut, repo made public on a clean PII-free squashed history.
- Stood up Tate's live radar: triaged all of ClaudeHub into 13 curated blips with tight workspace roots (excluded dead clients, utilities, dormant experiments).

## 2026-08-05 — Tate + Claude
- Retired next_action: the task queue is the plan and its first unchecked item is the next action; updateBlip migrates any legacy key into task #1 on the next write.
- Added radar-blip sync (one atomic reconciliation, snapshot-stable refs, --dry-run) and radar-blip sessions (digests Claude Code transcripts, incl. an ancestor-folder fallback).
- Rewrote the /blip skill as a deterministic five-step sync routine and shipped radar-blip hook stop as a Claude Code Stop hook.
- Fixed the unclearable neglect ring (a dated driver or paused now opts out; inline Archive in the panel), stopped the header running across the scope, and added the archive shelf.

## 2026-08-05 — Tate + Claude
- Closed an adversarial review pass: blip-write detection now covers the npx -y and npm run blip -- forms, the sessions digest drops out-of-project paths instead of naming them, and --limit/--max-chars reject junk instead of silently returning nothing.
- Routed Inbox quick capture through updateBlip, so it gains optimistic concurrency and a legacy Inbox finally retires its next_action.
- Proved the neglect fix end to end in a test: a rim blip dragged onto a dated ring gets a deadline and leaves the attention panel. Dragging further outward cannot clear it, by design.
- Confirmed the Stop hook in the wild — it stayed silent while this session had already synced, then fired correctly once 12 files changed after that entry.

## 2026-08-06 — Tate + Claude
- Diagnosed the v2.0.x CPU burn end to end - two independent causes, and the BLIP.md write itself is innocent at 6-13 ms per task op.
- The action spike is the watcher glob target: chokidar skips its 1 s per-directory readdir throttle whenever hasGlob is set, so every atomic write triggers a readdirp storm - and self-write suppression runs after it, so it cannot help.
- The standing slowness is RadarView repainting the whole scene 60 times a second - 208 percent of a core on the radar view against 15 percent with it unmounted.
- Found a data bug: the task due-date input writes one atomic BLIP.md per keystroke, persisting dates like 0002-08-12 en route to the real one.

# Notes
<!-- Human-only. Tooling never rewrites this section. -->
