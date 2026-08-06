---
description: Sync the current project's BLIP.md via the shared radar-blip CLI — the per-project state file behind the RADAR project radar. Reconciles the task queue and session log with what the session actually did, and sets horizon / priority / category / status / deadline. Also run it proactively at the natural end of a working session in any repo that has a BLIP.md.
argument-hint: "[sync | task \"text\" | task mv 4 1 | init | set --status blocked | show]"
---

Keep the `BLIP.md` in the current working directory telling the truth, so the RADAR desktop app
and the next session reflect reality. **You supply the judgment** (what got done, what's next);
the **`radar-blip` CLI performs every write** — atomically, append-only on the session log, and
never touching `# Notes` or unknown frontmatter keys.

**Never hand-edit `BLIP.md`. Always go through `radar-blip`** — the app, the CLI, and this
prompt share one engine so they can't disagree.

**The task queue IS the plan.** Tasks are the literal next steps in priority order, and the
**first unchecked task is the next action** — there is no `next_action` field any more.

**Run it proactively.** RADAR is *AI-fed, never micromanaged*: at the natural end of a working
session in a repo that has a `BLIP.md`, run `sync` on your own initiative. One per session; no
nagging, and write nothing if nothing happened. If there's no `BLIP.md`, leave the repo alone
(don't auto-`init`). Only ever write `BLIP.md`.

## Resolve the CLI (first form that works)
1. `radar-blip <args>` — when it's on `PATH` (via `npm i -g radar-blip`).
2. `npx -y radar-blip <args>` — zero-install fallback.

Run from the project root (the CLI writes `./BLIP.md`); else append `--path "DIR"`.

## Interpret the arguments: `$ARGUMENTS`
With no argument, the default is **sync**.

- **(empty) or `sync`** — five steps, in order:
  1. `radar-blip show --json` → the tasks (1-based positions) + fields RADAR believes.
  2. `radar-blip sessions --json` → what the transcripts say actually happened since
     `last_session`. **This reads Claude Code's transcripts only** — under Codex it returns
     nothing, which is fine: skip straight to step 3 and reconcile from the conversation.
     Where it does work, use it to catch earlier work that was never logged; for the session
     you are in, your own knowledge always outranks it.
  3. Decide: which open tasks are **done**; what new tasks the work revealed, in the order
     you'd do them (the most important gets `"top": true`); 1–4 concrete past-tense log
     bullets; any field change (`status: blocked` when waiting, `shipped` when it's out).
  4. Apply it all in one call — refs resolve against the list from step 1, and a bad ref
     fails the whole sync without writing:
     ```
     radar-blip sync <<'JSON'
     {"tasks":{"done":[2],"add":[{"text":"<the real next step>","top":true}]},
      "session":{"lines":["<did X>","<did Y>"],"author":"<name> + Codex"}}
     JSON
     ```
     Add `--dry-run` first if unsure of your refs. On PowerShell pipe a `@'…'@` here-string
     (closing `'@` at column 0) or write the payload to a file and use `--file`.
  5. Report one line: what got checked off, what's next, how many lines logged.
- **`task "text"`** → `radar-blip task add "text"` (`--top` makes it the next action).
  `task done|undone|toggle|rm <n|text>`, `task mv <n|text> <to>`, `task list` → forward
  verbatim (positions are 1-based).
- **`init`** → `radar-blip init` (names the project from the folder); add `--category`,
  `--horizon today|week|someday`, `--priority 1-5`, `--deadline YYYY-MM-DD` (hard due date),
  `--operation "<cluster>"`, `--task "<first step>"`. `--force` overwrites.
- **`set …`** → forward to `radar-blip set`: `--horizon`, `--deadline YYYY-MM-DD`,
  `--priority 1-5`, `--category`, `--operation "<cluster>"`,
  `--status active|paused|blocked|shipped|archived`, `--name`, `--tag` (repeatable).
- **`show`** → `radar-blip show` (`--json` for machine output).

Quote every task text and `--path` value (paths contain spaces). Rephrase prose to avoid
embedded double quotes — it's the only form that works identically in every shell. After
writing, state briefly what changed; if `npm run dev` is running, the RADAR app updates live.
