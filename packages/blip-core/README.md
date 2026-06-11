# radar-blip

**Own your project state in a plain Markdown file your AI coding agent keeps current.**

`radar-blip` is the engine + CLI behind [RADAR](https://github.com/TerraByte-Dev/RADAR). Every
project folder carries a `BLIP.md` — a human-readable, git-friendly state file holding the
project's horizon, priority, status, next action, task checklist, and session log. Your AI
coding agent (Claude Code or Codex) writes it as you work via the `/blip` skill; the RADAR
desktop app plots every project as a blip on a radar. One shared engine performs every write —
atomically, preserving your prose and any unknown keys byte-for-byte.

## Install

```sh
npm i -g radar-blip      # global CLI
# …or run it without installing:
npx -y radar-blip <args>
```

## Install the /blip skill

```sh
radar-blip skills install            # Claude Code + Codex (both)
radar-blip skills install --claude   # just Claude Code  → ~/.claude/skills/blip/SKILL.md
radar-blip skills install --codex    # just Codex        → ~/.codex/prompts/blip.md
```

Then run `/blip` in any project from your coding agent to capture a handoff. Re-run with
`--force` to overwrite an existing install.

## Commands

```
radar-blip init     [--name N] [--horizon today|week|someday] [--priority 1-5] [--category C] [--status S] [--next "…"] [--deadline YYYY-MM-DD] [--operation O] [--force]
radar-blip show     [--json]
radar-blip set      [--horizon H] [--priority 1-5] [--category C] [--status S] [--next "…"] [--deadline YYYY-MM-DD] [--operation O] [--name N] [--tag T …]
radar-blip task     add "text" | done|undone|toggle|rm <n|text> | list
radar-blip handoff  [--line "did X" --line "did Y"] [--next "next action"] [--summary "…"] [--author A]
radar-blip skills install [--claude] [--codex] [--force]
```

Every command operates on `./BLIP.md` by default; target another folder with `--path "DIR"`.
With no `--author`, `handoff` stamps the session log with your OS username; `--summary` is an
extra bullet appended after the `--line`s. Flags are space-separated (`--flag value`, quoted if
multi-word) — `--flag=value` is not supported, and a value may not itself start with `--`.

## What a BLIP.md looks like

```markdown
---
name: RADAR
horizon: week          # fuzzy distance fallback: today | week | someday
priority: 1            # 1 (top) … 5 — blip size
category: Product      # color + sector on the radar
status: active         # active | paused | blocked | shipped | archived
next_action: Review the settings branch, then land the pivot PR
created: 2026-06-01
last_session: 2026-06-11
tags: [terrabyte, tooling]
---

# Tasks

- [ ] Publish radar-blip to npm (due 2026-06-20)
- [x] Delete the legacy task stack

# Session log

## 2026-06-11 — Tate + Claude
- Adopted the repo onto its own radar.

# Notes

Anything here is yours — tooling round-trips it byte-for-byte.
```

A task may carry a trailing `(due …)` marker — the RADAR app parses it (any chrono-readable
date) and lets **the soonest incomplete task's due date drive the blip's distance from center**.
An optional frontmatter `deadline:` is the project-level hard date for task-less blips.

## The BLIP.md guarantee

`radar-blip` owns a known frontmatter subset (`name, horizon, deadline, priority, category,
status, operation, next_action, radar_angle, created, last_session, tags, links`), the
`# Tasks` checklist, and the append-only `# Session log`. **`# Notes`, any other heading, and
any unknown frontmatter key are round-tripped verbatim** — fenced code blocks included, so an
example `# Tasks` inside your notes never fools the engine, and prose or sub-bullets inside the
real `# Tasks` section survive every checklist edit. Writes are atomic and durable (temp file +
fsync + rename); the CLI's read-modify-write commands retry on concurrent changes instead of
clobbering another writer. A file that fails to parse is never overwritten, and one whose
frontmatter has YAML errors is readable but **read-only** until fixed. Never hand-edit a
`BLIP.md` — go through `radar-blip` (or the app, or `/blip`); they share this one engine, so
they can't disagree.

## Use as a library

```ts
import { Blip, readBlip, writeBlipAtomic, updateBlip, createBlip } from 'radar-blip';

const blip = await readBlip('BLIP.md');
blip.setHorizon('today').addTask('Ship it');
await writeBlipAtomic('BLIP.md', blip);

// Read-modify-write that can't clobber a concurrent writer: if the file changes
// between read and write, the mutation is replayed on the fresh content (max 3 tries).
await updateBlip('BLIP.md', (b) => b.toggleTask('Ship it'));
```

Also exported: `detectAuthor`, `Blip.toReadModel()`, the `HORIZONS`/`STATUSES` enums, and the
types `BlipReadModel`, `SessionEntry`, `CreateBlipOptions`. The package is ESM-only
(`"type": "module"`); `require('radar-blip')` needs Node ≥ 20.19 / 22.12.

## License

MIT © TerraByte Solutions LLC
