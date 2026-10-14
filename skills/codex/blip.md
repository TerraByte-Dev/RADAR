---
description: Keep this project's BLIP.md current for RADAR via the radar-blip CLI. Run at the end of real work in any folder that has a BLIP.md.
argument-hint: "[nothing = sync]"
---
<!-- radar-blip-skill v1 -->
BLIP.md is this project's re-entry note: where things stand and the one next step. You supply
the judgement; `radar-blip` does every write. Never edit BLIP.md directly.

1. `radar-blip brief` — Now line, every open task with its number, recent log, work since the
   last sync, plus `rev`, `owner`, `payloadPath`. If the user named a folder, add
   `--path "DIR"` (quoted) to both commands. Exit code 2 means no BLIP.md there: stop, but if a
   folder was named, check the path and tell the user. Run `radar-blip init` only when asked.
2. Write JSON to `payloadPath` and run `radar-blip sync --agent Codex --file "<payloadPath>"`:

   {"rev":"<from brief>",
    "now":"<one sentence, max 140 chars: where the project stands>",
    "log":["<what changed, past tense, max 200 chars>"],
    "done":[2,"<the whole title>"],
    "add":[{"title":"<action, max 80 chars>","detail":["<the rest>"],"top":true}]}

3. If the CLI rejects the payload it lists every problem and wrote nothing. Fix and resend.

Name a task by its number from the brief (send `rev`) or by its whole title as the brief
prints it; part of a title is refused. `remove` takes the whole title or a number, never a
fragment. In `move`, `to` is the task's final position ("top", "bottom" or a number), not a
step. One payload cannot complete or remove a title and also `add` it: send the add in a
second sync. `detail` in an `edit` replaces all of the task's detail, and brief shows detail
for task 1 only: run `radar-blip show` first.

now is the state, not the session: "The small widget is half built; the large one is live."
not "Fixed the refresh and added a moon tab." A title is an action that reads alone: "Refresh
the bundled harbour list", not "TURN ON OFFLINE TIDES - code is merged and…". Log bullets say
what changed: "Fixed the widget refresh loop (stale cache key)", not "Did some work".
1 to 6 log bullets. Sentence case, no ALL CAPS labels, no secrets. Nothing new: sync `{}`.
The owner decides the project's due date, focus, tags, pausing and archiving (a task gets a
due only when the owner gave one): use `radar-blip set` only when asked in this conversation.
`E_NEEDS_MIGRATE`: tell the owner, do not migrate.

Do this without being asked when you finish a meaningful piece of work in a tracked folder.
