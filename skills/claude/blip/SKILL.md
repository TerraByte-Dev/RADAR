---
name: blip
description: Keep this project's BLIP.md current for RADAR. Use on /blip, when asked to log progress or queue next steps, and unprompted when real work ends in a folder tracked by a BLIP.md.
---
<!-- radar-blip-skill v1 -->
# /blip

BLIP.md is the project's re-entry note: someone opening it cold should know in five seconds
where things stand and the one next step. You supply the judgement; `radar-blip` does every
write. Never edit BLIP.md directly.

## Routine
1. `radar-blip brief` prints the Now line, every open task with its number, the latest log,
   work since the last sync, and `rev`, `owner` and `payloadPath`.
2. Write JSON to `payloadPath`, then `radar-blip sync --agent Claude --file "<payloadPath>"`.

If a hook or the user names a project folder, add `--path "DIR"` (quoted) to both commands.
Exit 2 means no BLIP.md there: do nothing, but if a folder was named, check the path and
tell the owner. Run `radar-blip init` only when asked.

```json
{ "rev": "<from brief>",
  "now": "Offline tides are merged but hidden until the harbour list is refreshed.",
  "log": ["Shipped the moon-phase strip behind a flag", "Wrote the harbour import script, dry run by default"],
  "done": [2, "Fix the widget refresh loop"],
  "add": [{ "title": "Refresh the bundled harbour list",
            "detail": ["Sources are listed in data/README.md section 4"], "top": true }] }
```
Other keys: `reopen`, `remove`, `edit` ([{"ref":3,"title":"…","detail":["…"]}]), `move`
([{"ref":5,"to":"top"}]), `status` ("active" | "blocked"), `name`. A ref is a number from the
brief you just read (send its `rev`) or the whole title as the brief prints it; part of a
title is refused, in `remove` most of all. `detail` in `edit` replaces all of the task's
detail, and brief shows detail for task 1 only: run `radar-blip show` first. In `move`, `to`
is where the task ends up ("top", "bottom" or its final position), not a step. Never
complete or remove a title and `add` it again in one payload: send the add in a second sync.
A rejection lists every problem and writes nothing: fix and resend. Unsure? `--dry-run`.

## What good looks like
- **now** (required when you log, max 140): the state, not the session.
  Yes: "The small widget is half built on feat/widget-view; the large one is live."
  No: "Merged the widget and fixed the refresh." (a log entry); "Working on the widget." (says nothing)
- **title** (max 80): the action, readable alone. The rest goes in `detail` (8 lines of 160).
  Yes: "Refresh the bundled harbour list so offline tides turn on"
  No: "TURN ON OFFLINE TIDES - code is merged and hidden (release…" (label plus essay)
  No: "NOTE: the store page now lists the old icon" (a note: put it in detail or log)
- **log** (1 to 6 bullets, max 200 each): what changed, past tense, findable in git.
  Yes: "Fixed the widget refresh loop (stale cache key)". No: "Did some work on the widget".
- **name**: what the owner says aloud. Send one only when brief reports `name-missing` or
  `name-slug`: "dungeon-dig" becomes "Dungeon Dig".
- The first open task is the next step: make sure it really is. Start a task only the owner
  can do with the `owner` from brief: "<owner>: approve the terms in PR #21".
- Mark done only what is finished and verified. Fix a bad title with `edit`.

## Limits
- Nothing new since the last sync: run `sync` with `{}` to acknowledge, so RADAR stops asking.
- `E_NEEDS_MIGRATE`: tell the owner. Do not run `migrate` yourself.
- The project's due date, focus, tags, pausing and archiving belong to the owner (a task
  gets a due only when the owner gave one). Run `radar-blip set <field> <value>` only when
  the owner asked for that change in this conversation; otherwise say your suggestion in chat.
- Sentence case. No ALL CAPS labels. No keys, tokens or passwords in any field.
