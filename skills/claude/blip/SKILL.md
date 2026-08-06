---
name: blip
description: Sync or update the current project's BLIP.md — the per-project state file behind the RADAR project radar. Use when the user runs /blip or /blip sync, or asks to log session progress, write a handoff, check off what got done, queue the next steps, or set the project's horizon / priority / category / status / deadline. ALSO use proactively, without being asked, at the natural end of a working session in any repo that has a BLIP.md — reconcile the file with what the session actually did so the radar reflects reality. Shells out to the shared `radar-blip` CLI so the file stays byte-safe and round-trip-clean.
---

# /blip

Keeps a project's `BLIP.md` telling the truth, so the RADAR desktop app — and your next
session — always reflect reality. **You supply the judgment** (what got done, what's next);
the **`radar-blip` CLI performs every write**, atomically and round-trip-clean, never
touching `# Notes` or unknown frontmatter keys.

**Golden rule: never hand-edit `BLIP.md`. Always go through `radar-blip`.** The app, the CLI
and this skill share one engine precisely so they can't disagree.

## The model, in one line

**The task queue IS the plan.** Tasks are the literal next steps, in priority order, and the
**first unchecked task is the project's next action** — there is no separate `next_action`
field (it was retired; the engine promotes any leftover one to task #1 on the next write).
So "setting the next action" means *putting that task first*, and finishing work means
*checking tasks off*. Keep the queue honest and the radar takes care of itself.

## Run it proactively — this is the whole point

RADAR is **AI-fed, never micromanaged**. When you finish a meaningful chunk of work in a repo
that has a `BLIP.md`, run the sync on your own initiative before you wrap up. Honor the limits:

- **No `BLIP.md`? Leave the repo alone.** Never auto-`init` — adoption is the user's call.
- **Only ever write `BLIP.md`.** Never record state in `CLAUDE.md`, `AGENTS.md`, or anywhere else.
- **Nothing happened? Write nothing.** A log entry for a session that only read files is noise.

## Resolve the CLI (do this first)

Use the first form that works: `radar-blip <args>` (installed via `npm i -g radar-blip`), else
`npx -y radar-blip <args>`. Run from the **project root** (it writes `./BLIP.md`); target
another folder with `--path "DIR"`.

---

# `/blip sync` — the flagship. Reconcile the file with reality.

This is the default when the user types `/blip` with no subcommand. Follow all five steps in
order, every time. Do not improvise a different sequence.

### 1. Read what RADAR currently believes

```
radar-blip show --json
```

Gives you the tasks **with their 1-based positions**, plus `status`, `priority`, `horizon`,
`deadline`, and `last_session`. If it reports `no BLIP.md`, stop — see *Failure modes*.

### 2. Read what actually happened

```
radar-blip sessions --json
```

Digests this folder's Claude Code transcripts since `last_session`: the user's asks, the files
written, the commands run, the commits made. Use it to catch work from **earlier sessions that
were never logged** — that's the gap it exists to close.

**Your live conversation outranks it.** For the session you're in, you know what the work
*meant*; the digest only knows what it touched. Use the digest to fill in the past and to
jog your memory, and your own knowledge for the present. If `sessions` finds nothing, that's
fine — carry on from the conversation alone.

### 3. Reconcile — decide, explicitly, four things

1. **Which open tasks are now done.** Only ones genuinely finished. Note their positions/text.
2. **What the work revealed that belongs in the queue**, in the order you'd actually do them.
   The single most important one goes **first** (`"top": true`).
3. **1–4 session-log bullets**: short, concrete, past tense. "wired chokidar live-watch",
   not "did some work". Say what changed, not what you thought about.
4. **Whether any field changed**: `status` (`blocked` when waiting on someone, `shipped` when
   it's out the door), a `deadline`, a `priority`.

If all four come back empty, say so and write nothing.

### 4. Apply it in ONE call

Build the payload and pipe it to `radar-blip sync`. Every ref — a 1-based position or the exact
task text — resolves against the list you saw in step 1, so they can't shift each other. Any bad
ref fails the whole sync without writing a byte.

```jsonc
{
  "tasks": {
    "done": [2, "publish to npm"],          // positions and/or exact text
    "add": [
      { "text": "wire the triage wizard", "top": true },   // ← the new next action
      { "text": "write its tests", "due": "2026-07-01" }   // (due …) drives radar distance
    ],
    "rm": [5],                               // only for tasks that turned out to be wrong
    "edit": [{ "ref": 3, "text": "reworded task" }]
  },
  "fields": { "status": "active" },
  "session": { "lines": ["did X", "did Y"], "author": "<git user.name> + Claude" }
}
```

**Invocation.** Piping a here-doc is the only form that behaves identically on every shell —
prefer it, and never try to inline JSON in a shell argument:

```bash
radar-blip sync <<'JSON'
{ ...payload... }
JSON
```

On **Windows PowerShell**, pipe a single-quoted here-string instead (the closing `'@` must be at
column 0), or write the payload to a temp file and use `--file`:

```powershell
@'
{ ...payload... }
'@ | radar-blip sync
```

Use `--dry-run` first if you're unsure about your refs — it validates and prints the plan
without writing.

### 5. Report one line

e.g. *"Synced RADAR: 2 tasks done, 3 queued (next: wire the triage wizard), logged 2 lines."*
If `npm run dev` is running, the app reflects it live via its file watcher.

### Don't double-log

If you already synced this session, a second `/blip sync` should log **nothing** new — only
apply task/field changes since. `last_session` tells you where the previous entry ended;
never re-describe work that's already in `# Session log`.

---

## Other subcommands

### `/blip task ...` — the queue
- `/blip task "text"` → `radar-blip task add "text"` (appends)
- `/blip task "text" --top` → adds it as the **next action**
- `/blip task done|undone|toggle|rm <n|text>` → forward verbatim (positions are 1-based)
- `/blip task mv <n|text> <to>` → re-prioritize; `mv 4 1` makes task 4 the next action
- `/blip task list` → `radar-blip task list`

### `/blip init` — create a BLIP.md for this folder
`radar-blip init` (named from the folder). Add what you know: `--category "<e.g. Product>"`,
`--horizon <today|week|someday>`, `--priority <1-5>`, `--deadline <YYYY-MM-DD>` (a hard due
date — overrides the fuzzy horizon), `--operation "<cluster>"`, `--task "<first step>"`.
`--force` overwrites an existing file (confirm first).

### `/blip set ...` — radar fields
Forward to `radar-blip set`: `--horizon`, `--deadline <YYYY-MM-DD>`, `--priority 1-5`,
`--category`, `--operation`, `--status <active|paused|blocked|shipped|archived>`, `--name`,
`--tag` (repeatable). Example: `/blip set --status blocked`.

### `/blip handoff` — log only
`radar-blip handoff --line "did X" --line "did Y" --author "<name> + Claude"`. Prefer
`/blip sync`; use this only when the tasks genuinely need no change.

### `/blip show` — print current state
`radar-blip show` (add `--json`).

---

## Failure modes

- **`no BLIP.md`** → the folder isn't tracked. **Do not init on your own.** Say so and offer.
- **`radar-blip: command not found`** → use `npx -y radar-blip <args>`, or `npm i -g radar-blip`.
- **`sync: no task matching …`** → your ref is stale. Re-run `radar-blip show --json` and use an
  exact position or exact text. Nothing was written.
- **`invalid sync payload: unknown key …`** → a typo'd key. The schema is exactly `session`,
  `tasks` (`done`/`undone`/`rm`/`edit`/`add`), and `fields`.
- **`frontmatter has YAML errors`** → the file is "signal lost" and is never overwritten. Tell
  the user to fix it by hand.
- **Quoting**: rephrase prose to avoid embedded double quotes — it's the only form that works
  identically in every shell. Always quote `--path` values (paths contain spaces).
- **Never touch `# Notes`** or unknown frontmatter keys; the engine preserves them and so must you.
- **Keep the payload small.** `BLIP.md` is a git-tracked file a human reads: 1–4 log bullets of
  one line each, and tasks phrased as steps, not paragraphs. Nothing enforces a size limit —
  that restraint is yours.

## Automatic sync (optional)

`radar-blip hook stop` is a Claude Code **Stop** hook that nudges you to run `/blip sync` when a
session in a tracked repo ends with unlogged work. Add to `~/.claude/settings.json`:

```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "radar-blip hook stop", "timeout": 15 }] }] } }
```

It fires at most once per session, stays silent in untracked repos, and fails open.
