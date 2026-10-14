# radar-blip

**Own your project state in a plain Markdown file your AI coding agent keeps current.**

`radar-blip` is the engine and CLI behind [RADAR](https://github.com/TerraByte-Dev/RADAR). Every
tracked project folder carries a `BLIP.md`: one Now line saying where the project stands, a task
queue whose first open task is the next step, and a newest-first log. Your coding agent (Claude
Code or Codex) keeps it current through the `/blip` skill; the RADAR desktop app shows every
project at once. The engine does every write, under a lock, atomically, and copies every byte it
does not manage.

## Install

```sh
npm i -g radar-blip
radar-blip setup        # the /blip skill and the Claude Code hooks; shows the change and asks first
radar-blip doctor       # checks that everything is in place
```

The RADAR desktop app ships its own copy of the CLI and runs the same setup from its first-run
screen; with the app there is no need for the npm package.

`setup` installs:

- the `/blip` skill at `~/.claude/skills/blip/SKILL.md` (or under `CLAUDE_CONFIG_DIR`), and the
  Codex prompt at `~/.codex/prompts/blip.md` when Codex is installed (`CODEX_HOME` is honoured);
- three Claude Code hooks in `settings.json`: `SessionStart`, `Stop` and `SessionEnd`, each
  `radar-blip hook <event>`. Only RADAR's own entries are added or replaced; every other byte of
  the file stays as it was, and the original is copied to `settings.json.radar-bak` first.

It is safe to run again: a machine that is already set up prints `Already set up.` Without a
terminal it needs `--yes`; `--dry-run` only prints. `radar-blip setup --remove` takes the hooks
and RADAR's skill files out again.

## How the loop works

1. **SessionStart** tells the agent the project's Now line and next task, and says so when there
   are commits nobody has logged yet.
2. **Stop** looks at the files the session edited and the commits it made, maps each to its
   project (a linked git worktree maps to its main checkout), and asks the agent to sync when one
   project has a commit or three edited files that are not in its log. It asks about one project
   at a time, and about the same project at most once every 20 minutes. A read-only session is
   never asked.
3. The agent runs `radar-blip brief`, writes one JSON payload, and runs `radar-blip sync`.

The hooks never block a session they do not understand: any problem means no output and exit 0.

## Commands

```
radar-blip init [--name N] [--now TEXT] [--task TITLE]…    start tracking this folder (never overwrites)
radar-blip show [--json]                                  the whole project
radar-blip brief [--json]                                 what an agent reads before a sync (--json is at most 8 KB)
radar-blip sync (--file PATH | -) [--agent NAME] [--dry-run]   apply one payload
radar-blip add "title" [--detail LINE]… [--due YYYY-MM-DD] [--top]
radar-blip done <n | "title">
radar-blip set <name | status | focus | due | tags> <value>
radar-blip lint [--all]                                   report problems; never rewrites
radar-blip migrate [--all] [--dry-run] [--allow-secret-shaped]   rewrite a v2 file as v3, once, with a backup
radar-blip status [--all] [--json]                        every tracked project, one row each
radar-blip track [DIR] [--find | --remove | --hide | --show]
radar-blip setup [--dry-run] [--yes] [--remove]
radar-blip doctor [--json]
radar-blip hook <session-start | stop | session-end>      Claude Code hooks (JSON on stdin)
```

Every project command takes `--path DIR` (default: the nearest folder above the current one that
holds a `BLIP.md`) and `--json`. Exit codes: `0` success, `1` usage or a rejected payload
(nothing written), `2` no project here, `3` the file cannot be written safely, `4` `lint` found
errors or `doctor` found a failure. `hook` always exits 0.

### A sync payload

```json
{ "rev": "5f0c9a1e77b3d204",
  "now": "Sync is merged but switched off until the conflict screen is designed.",
  "log": ["Merged the sync engine behind a flag", "Wrote the conflict-screen sketches"],
  "done": [2, "Renew the signing certificate"],
  "add": [{ "title": "Design the conflict screen", "detail": ["Two sketches are in design/conflicts.md"], "top": true }] }
```

A task is named by its number in the `brief` the agent just read (with that brief's `rev`) or by
its whole title. A payload that breaks a rule is rejected whole, with every problem listed at once.
`{}` acknowledges that the log already covers the work.

## What a BLIP.md looks like

```markdown
---
blip: 3
name: Lantern Notes
now: Sync is merged but switched off until the conflict screen is designed.
status: blocked
due: 2026-11-18
tags: [product, mobile]
---

# Tasks

- [ ] Design the conflict screen so sync can be switched on
  Two sketches are in design/conflicts.md.
- [ ] Write the release notes for 4.2

## Done

- [x] Merge the sync engine (done 2026-10-10)

# Session log

## 2026-10-11 16:48 — Robin + Claude
- Merged the sync engine behind the sync_v2 flag
```

`name`, `due`, `focus`, `tags`, `links` and the statuses `paused` / `archived` are the owner's;
agents write `now`, the tasks, the log and the statuses `active` / `blocked`. Last activity,
drift and branch are worked out from git and file times and never stored. The full format is in
[docs/BLIP-SCHEMA.md](https://github.com/TerraByte-Dev/RADAR/blob/main/docs/BLIP-SCHEMA.md).

Everything RADAR keeps besides `BLIP.md` (the project list, locks, backups, removed tasks) lives
in its data folder: `%APPDATA%\radar-blip` on Windows, `~/Library/Application Support/radar-blip`
on macOS, `${XDG_DATA_HOME:-~/.local/share}/radar-blip` on Linux, or `RADAR_BLIP_HOME`.

## Use as a library

```ts
import { buildBrief, parseSyncPayload, syncProject } from 'radar-blip';

const brief = await buildBrief(dir);
const res = await syncProject(dir, parseSyncPayload({ rev: brief.rev, done: [1] }), { author: 'Robin', agent: 'Claude' });
```

The package is ESM-only and needs Node 22.12 or later.

## License

MIT © TerraByte Solutions LLC
