---
description: Capture or update the current project's BLIP.md via the shared radar-blip CLI — the per-project state file behind the RADAR project radar. Logs a session/handoff, sets next action / horizon / priority / category / status, or manages the project's tasks. Also run it proactively at the natural end of a working session in any repo that has a BLIP.md.
argument-hint: "[handoff | task \"text\" | init | set --status blocked --next \"…\" | show]"
---

Record the state of the project in the current working directory into its `BLIP.md`, so the
RADAR desktop app and the next session reflect reality. **You supply the prose** (what got
done, what's next); the **`radar-blip` CLI performs every write** — atomically, append-only
on the session log, and never touching `# Notes` or unknown frontmatter keys.

**Never hand-edit `BLIP.md`. Always go through `radar-blip`** — the app, the CLI, and this
prompt share one engine so they can't disagree.

**Run it proactively.** RADAR is *AI-fed, never micromanaged*: at the natural end of a working
session in a repo that has a `BLIP.md`, run `handoff` on your own initiative — don't wait to be
asked. One handoff per session; no nagging, no trivial no-ops. If there's no `BLIP.md`, leave the
repo alone (don't auto-`init`). Only ever write `BLIP.md` — never other files.

## Resolve the CLI (first form that works)
1. `radar-blip <args>` — when it's on `PATH` (via `npm i -g radar-blip` or `radar-blip skills install`).
2. `npx -y radar-blip <args>` — zero-install fallback.

Run from the project root (the CLI writes `./BLIP.md`); else append `--path "DIR"`.

## Interpret the arguments: `$ARGUMENTS`
With no argument, the default is **handoff**.

- **(empty) or `handoff`** — Summarize what was accomplished this session into 1–4 concrete
  past-tense bullets, decide the single next action, then run (one `--line` per bullet). For
  the author use the user's `git config user.name` + " + Codex"; if unknown, omit `--author`
  (the CLI defaults to the OS user):
  ```
  radar-blip handoff --line "<did X>" --line "<did Y>" --next "<next action>" --author "<name> + Codex"
  ```
  The CLI appends a dated `# Session log` entry (append-only) and updates `next_action`. If it
  reports `no BLIP.md`, run `init` first, then retry.
- **`task "text"`** → `radar-blip task add "text"`. `task done|undone|toggle|rm <n|text>` and
  `task list` → forward verbatim (task numbers are 1-based).
- **`init`** → `radar-blip init` (names the project from the folder); add `--category`,
  `--horizon today|week|someday`, `--priority 1-5`, `--deadline YYYY-MM-DD` (hard due date),
  `--operation "<cluster>"`, `--next "…"` if known. `--force` overwrites.
- **`set …`** → forward to `radar-blip set`: `--horizon`, `--deadline YYYY-MM-DD`, `--priority 1-5`,
  `--category`, `--operation "<cluster>"`, `--status active|paused|blocked|shipped|archived`,
  `--next "…"`, `--name`, `--tag` (repeatable).
- **`show`** → `radar-blip show` (`--json` for machine output).

Quote every `--line`, `--next`, task text, and `--path` value (paths contain spaces). After
writing, state briefly what changed; if `npm run dev` is running, the RADAR app updates live.
