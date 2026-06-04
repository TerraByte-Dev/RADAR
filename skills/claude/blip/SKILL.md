---
name: blip
description: Capture or update the current project's BLIP.md — the per-project state file behind the RADAR project radar. Use when the user runs /blip, or asks to log session progress / write a handoff, set the project's next action / horizon / priority / category / status, or add and check off the project's tasks. Shells out to the shared `radar-blip` CLI so the file stays byte-safe and round-trip-clean.
---

# /blip

Records the state of the project you're working in into its `BLIP.md`, so the RADAR
desktop app — and your next session — always reflect reality. **You supply the prose**
(what got done, what's next); the **`radar-blip` CLI performs every write**, atomically,
appending to the session log and never touching `# Notes` or unknown frontmatter keys.

**Golden rule: never hand-edit `BLIP.md`. Always go through `radar-blip`.** The app, the
CLI, and this skill share one engine precisely so they can't disagree — editing the file
by hand breaks that guarantee.

## Resolve the CLI (do this first)
Use the first form that works:
1. `radar-blip <args>` — when it's on `PATH` (installed via `npm i -g radar-blip`, or wired up by `radar-blip skills install`).
2. `npx -y radar-blip <args>` — zero-install fallback (fetches the package on first run).

Run from the **project's root folder** (the CLI writes `./BLIP.md` by default); to target
another folder, append `--path "DIR"`.

## Route the invocation
Read what the user typed after `/blip`. With no subcommand, the default is **handoff**.

### `/blip` or `/blip handoff` — log a session + set the next action
1. From the conversation, summarize **what was accomplished this session** into 1–4 short,
   concrete past-tense bullets ("wired chokidar live-watch", not "did some work").
2. Decide the single most useful **next action**.
3. Pick the author: the user's `git config user.name` + " + Claude" (e.g. `"Ada + Claude"`).
   If the name is unknown, omit `--author` and the CLI defaults to the OS user. Then run
   (repeat `--line` per bullet):
   ```
   radar-blip handoff --line "<did X>" --line "<did Y>" --next "<next action>" --author "<name> + Claude"
   ```
   The CLI appends a dated entry to `# Session log` (append-only — prior entries are never
   rewritten) and updates `next_action`.
4. If it reports `no BLIP.md`, the folder isn't initialized — run `/blip init` first, then
   re-run the handoff.

### `/blip task ...` — manage the project's checklist
- `/blip task "text"` → `radar-blip task add "text"`
- `/blip task done|undone|toggle|rm <n|text>` → forward verbatim (task numbers are 1-based).
- `/blip task list` → `radar-blip task list`.

### `/blip init` — create a BLIP.md for this folder
`radar-blip init` (the CLI names the project from the folder). Add what you already know:
`--category "<e.g. Product>"`, `--horizon <today|week|someday>`, `--priority <1-5>`,
`--deadline <YYYY-MM-DD>` (a hard due date — drives the radar's exact distance, overriding the
fuzzy horizon), `--operation "<cluster>"` (groups related projects into one radar sector),
`--next "<first action>"`. Use `--force` only to overwrite an existing file (confirm first).

### `/blip set ...` — change radar fields
Forward to `radar-blip set`: `--horizon`, `--deadline <YYYY-MM-DD>` (hard due date),
`--priority 1-5`, `--category`, `--operation "<cluster>"`,
`--status <active|paused|blocked|shipped|archived>`, `--next "..."`, `--name`,
`--tag` (repeatable). Example: `/blip set --status blocked --next "waiting on API key"`, or
`/blip set --deadline 2026-07-01` to pin a real deadline.

### `/blip show` — print current state
`radar-blip show` (add `--json` for machine output).

## After any write
Tell the user briefly what changed (e.g., "Logged 3 lines; next action set to …"). If
`npm run dev` is running, the RADAR app reflects the change live via its file watcher.

## Notes & failure modes
- **Quoting**: wrap every `--line`, `--next`, task text, and `--path` value in double quotes
  so values containing spaces (paths, sentences) survive the shell.
- **`radar-blip: command not found`** → use the `npx -y radar-blip <args>` fallback, or
  install it once with `npm i -g radar-blip`.
- **Never touch `# Notes`** or unknown frontmatter keys — the engine preserves them verbatim,
  and so must you.
