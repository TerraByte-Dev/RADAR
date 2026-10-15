# The BLIP.md format (version 3)

A `BLIP.md` is one plain Markdown file in the root of a project folder. It answers two
questions for anyone opening the project cold: **where did this leave off, and what is the
one next thing to do?** RADAR reads these files to show all your projects at a glance, and
AI coding agents keep them current as a side effect of working.

The file is yours. It is ordinary Markdown with a short YAML header, it lives in your
folder (and in your git history if you want it there), and you can read or edit it in any
editor. This page describes exactly what the file may contain and how RADAR reads it.

- [A complete example](#a-complete-example)
- [The header](#the-header)
- [Tasks](#tasks)
- [Session log](#session-log)
- [Everything else in the file](#everything-else-in-the-file)
- [Editing by hand](#editing-by-hand)
- [Writing it well](#writing-it-well)
- [Problems RADAR reports](#problems-radar-reports)
- [Files from version 2](#files-from-version-2)
- [Limits at a glance](#limits-at-a-glance)

---

## A complete example

```markdown
---
blip: 3
name: Lantern Notes
now: Sync is merged but switched off until the conflict screen is designed.
status: blocked
focus: true
due: 2026-11-18
tags: [product, mobile]
links:
  - Repo: https://example.com/lantern/notes
  - https://lantern.example.com
---

# Tasks

- [ ] Design the conflict screen so sync can be switched on
  Sync is merged behind the sync_v2 flag.
  Two sketches are in design/conflicts.md.
  - Then flip the flag for the test group
  - Watch the error log for a day
- [ ] Renew the signing certificate (due 2026-10-31)
  The current one expires on the first of November.
- [ ] Write the release notes for 4.2
- [ ] Robin: approve the wording in PR #21

## Done

- [x] Merge the sync engine behind a flag (done 2026-10-11)
- [x] Move the backlog out of the old tracker (done 2026-10-06)
  The export lives in docs/backlog-2026.csv.

# Session log

## 2026-10-11 16:48 — Robin + Claude
- Merged the sync engine behind the sync_v2 flag
- Added a retry queue for uploads that fail offline
- Wrote two sketches for the conflict screen

## 2026-10-06 09:12 — Robin + Claude
- Moved the backlog out of the old tracker and closed the board
- Fixed the crash when a note has no title
```

Three parts: a **header** between the two `---` lines, a **`# Tasks`** section, and a
**`# Session log`** section. Nothing else is required, and every part is optional.

The file is UTF-8. Unix (`LF`) and Windows (`CRLF`) line endings both work and are kept as
they are; so is a byte-order mark if the file has one.

---

## The header

The header is YAML: one `key: value` per line.

| Key | Value | Meaning |
|---|---|---|
| `blip` | `3` | The format version. Always the first key. A file without it is a [version 2 file](#files-from-version-2). |
| `name` | text, 2–32 characters | What you call the project out loud. If it is missing, RADAR shows the folder name and says so; it never writes a name for you. |
| `now` | one line, up to 140 characters | Where the project stands right now, in plain words, and what it is waiting on if anything. |
| `status` | `active`, `blocked`, `paused` or `archived` | `active`: being worked on. `blocked`: waiting on a person or an outside event (the `now` line says which). `paused`: deliberately parked. `archived`: finished or dropped, off the board. Missing or unrecognised means `active`. |
| `focus` | `true` | Pins the project to the top. Leave the key out when it is not pinned; `focus: false` is never written. |
| `due` | `YYYY-MM-DD` | A real deadline for the whole project, if it has one. Anything that is not a real calendar date in exactly this form is read as "no due date". |
| `tags` | a list, for example `[product, mobile]` | Any number of tags. **The first tag is the project's group**: it decides how RADAR groups and colours the project. Tags are lower-case words joined by hyphens (`client-work`). |
| `links` | a list | Each item is a web address, or `Label: address`. Only `http:`, `https:` and `mailto:` links are shown. |

Any other key is yours. RADAR keeps it exactly as written and never reads it. For example,
a `created:` date or a `repo:` line stays where you put it.

When RADAR rewrites the header it puts its own keys in the order of the table above,
followed by your keys in the order you had them.

### Who changes what

| Field | Changed by |
|---|---|
| `name`, `due`, `focus`, `tags`, `links`, and the statuses `paused` and `archived` | You. An agent changes them only when you ask it to. (An agent may suggest a `name` while the project has none.) |
| `now`, the tasks, the log, and the statuses `active` and `blocked` | Agents, as they work, and you whenever you like. |

Facts such as the time of the last change, the current git branch or the number of recent
commits are worked out from the folder when needed. They are never stored in `BLIP.md`.

---

## Tasks

Everything under the `# Tasks` heading.

```markdown
# Tasks

- [ ] An open task
  A line of detail.
  - A detail bullet
- [ ] Another open task (due 2026-10-31)

## Done

- [x] A finished task (done 2026-10-11)
```

**A task is a checkbox line at the start of a line**: `- [ ]` for open, `- [x]` for done,
then the title.

**Everything under a title belongs to that task**, up to the next task, the `## Done`
heading or the end of the section. That covers indented lines, bullets, blank lines in the
middle and lines that are not indented at all. When a task is moved, finished or removed,
all of those lines go with it. An indented checkbox (`  - [ ] …`) is detail, not a task of
its own.

**The order is the priority. The first open task is the next step.** There is no separate
"next" or priority field.

**Open tasks sit above `## Done`; finished tasks sit under it, newest first.** Whether a
task is open is decided by its checkbox, not by where it sits, so ticking a box in place is
fine: see [Editing by hand](#editing-by-hand).

**A due date** is written at the end of the title as ` (due YYYY-MM-DD)`. Only that exact
form counts. `(due friday)` is treated as part of the title, and RADAR tells you so,
because a phrase like "friday" means a different day every week.

**A finished task** carries ` (done YYYY-MM-DD)` at the end of its title: the day it was
ticked. Its due date, if it had one, is dropped at that point.

**Two tasks are the same task** when their titles match after ignoring capital letters,
extra spaces and a final full stop. RADAR will not add a second open task with a title you
already have.

Nothing inside a fenced code block (three backticks or three tildes) is ever read as a
task or a heading.

---

## Session log

Everything under the `# Session log` heading (a section called `# Log` is read the same
way): a short record of what changed, **newest entry first**.

```markdown
# Session log

## 2026-10-11 16:48 — Robin + Claude
- Merged the sync engine behind the sync_v2 flag
- Added a retry queue for uploads that fail offline
```

An **entry** is a `## ` heading and every line under it, up to the next `## ` heading.

New entries are written by RADAR with the heading `## YYYY-MM-DD HH:MM — who`, in your
local time, taken from the computer's clock. `who` is your name, plus the agent's name
when an agent wrote the entry. Each line of the entry is a `- ` bullet. A new entry always
goes directly under the `# Session log` heading.

**Existing entries are never rewritten.** Not re-wrapped, not re-dated, not re-ordered.
That holds for entries you wrote by hand in any shape: a heading with only a date, a
heading with no date at all, paragraphs instead of bullets, bullets that wrap over several
lines. RADAR shows the date, time and author when it can find them in the heading, and
shows the heading as written when it cannot.

Two entries may have the same heading. Nothing is merged.

---

## Everything else in the file

Any other top-level section (a line starting with `# `), and any text before the first
heading, is yours. RADAR keeps it byte for byte, in the same place, and never reads
meaning into it. A `# Notes` or `# Ideas` section is a good home for anything that is
neither a task nor a log entry.

If a file has two `# Tasks` sections, the first one is the task list and the second is
kept as ordinary text. A checklist inside one of your own sections is not a task list.

---

## Editing by hand

You can edit `BLIP.md` in any editor at any time. This is what RADAR promises.

**Never lost.** Header keys it does not know, sections it does not manage, text before the
first heading, every line under a task, every line of a log entry, the line-ending style
and the byte-order mark.

**Read correctly, and tidied the next time RADAR writes to the file.**

- A box you ticked in place: it counts as done straight away, and on the next write it
  moves under `## Done` and gets today's `(done …)` date.
- An unticked box under `## Done`: it counts as open, and on the next write it moves to
  the end of the open tasks.
- `* [ ]` instead of `- [ ]`, and `[X]` instead of `[x]`.
- A missing `## Done` heading, or a missing `# Tasks` or `# Session log` section. Each is
  created when first needed: `# Tasks` just above `# Session log` (or at the end of the
  file), `# Session log` at the end.

**Read and reported, never changed for you.** Titles over 80 characters, `(due …)` phrases
that are not dates, two open tasks with the same title, a `now` line over 140 characters,
an unrecognised `status`, and log entries that are out of date order.

**Read-only.** RADAR will show these files but refuses to write to them, so nothing can
make them worse:

- a header that is not valid YAML (fix the lines between the `---` markers), including a
  header whose closing `---` is missing;
- a header that says `blip: 4` or higher (written by a newer RADAR; update yours);
- a header with no `blip` key (a [version 2 file](#files-from-version-2));
- a file that is not UTF-8 text (re-save it as UTF-8).

**Changes RADAR refuses to make.** Before every write RADAR checks that the file, as it
would be saved, reads back as exactly the tasks and log entries it meant to write. If it
would not, the change is refused whole and the file is left as it was. That happens when:

- a code fence (three backticks or tildes) earlier in the file is never closed, and the
  change would land below it, inside the code: a new task at the end of the list, a new
  `# Tasks` or `# Session log` section, a log entry under a heading that sits below the
  fence. The message names the line that opens the fence; close it by hand
  (`fence-unclosed` in [Problems RADAR reports](#problems-radar-reports) points at it too);
- a detail line in the change would itself open a code fence that is never closed, or
  would be read as the `## Done` heading;
- a header change would leave YAML that no longer parses, for example removing a key
  that another key refers to with a YAML alias (`*name`).

`BLIP.md` is the only file RADAR creates or changes inside a project folder.

---

## Writing it well

These are the rules agents are held to when they write through RADAR. A hand edit may
break any of them: nothing is refused, and RADAR points out what it noticed.

### Name

What you would say out loud: "I worked on ___ today."

Good: `RADAR`, `Lantern Notes`, `Sam's Installs`, `Thesis research paper`, `lantern.page`.
Not a name: a folder name such as `game-mod-tools`, `_notes-review` or `01-Accounts`.
Write `Game Mod Tools`, `Notes review`, `Accounts`.

### The `now` line

One sentence a stranger could read: the state the project is in, and what it is waiting on.

Good:

- `Sync is merged but switched off until the conflict screen is designed.`
- `The small widget is half built on feat/widget-view; the large one is live.`
- `Blocked on Dana approving the print proofs.`
- `Shipped and quiet. Nothing planned.`

Not good:

- `Merged sync, fixed the refresh, added a retry queue and wrote two sketches` — that is what
  happened in one sitting; it belongs in the log. `now` says where things stand.
- `Working on sync.` — says nothing.
- `TURN ON SYNC` — that is a task, and it is shouting.

### Task titles and detail

The title is the action, readable on its own in a one-line list: 3 to 80 characters,
starting with a verb. Everything else goes in the detail lines underneath (up to 8 lines of
160 characters each when written through RADAR).

```markdown
- [ ] Store the six mail settings so sending turns on
  Code is deployed and switched off (build 20261011).
  The setting names are in deploy/README.md section 4.
```

Avoid:

- an all-capitals label in front: `EMAIL: ask the printer for a quote` → `Ask the printer
  for a quote`;
- all capitals: `ORDER THE NEW TILL ROLLS TODAY`;
- a note that is not an action: `NOTE: the console changed its menu` belongs in detail or
  in the log;
- a due date typed into the title in words: use ` (due YYYY-MM-DD)`.

A task only you can do starts with your name and a colon, so that "what is waiting on me"
is one search away: `Robin: approve the wording in PR #21`.

### Log bullets

What changed, in the past tense, concrete enough to find again: 1 to 6 bullets per entry,
each up to 200 characters.

Good: `Fixed the widget refresh loop (stale cache key)`, `Merged PR #24: cleaner walkthrough`.
Not good: `Did some work on sync`, `Investigated things`, or a paragraph.

When there is more to say than six bullets hold, put it where it will be found again: in
the detail of the task it concerns, or in a file in the project that the bullet names.

---

## Problems RADAR reports

`radar-blip lint` lists anything in a file that is worth a look. It never changes the file.
Each problem has a short code, and a line number where that makes sense.

Three are **errors**. `lint` exits 4 while any of them is there:

| Code | Meaning |
|---|---|
| `yaml-invalid` | The header is not valid YAML. The file is read-only until it is fixed. |
| `schema-newer` | The header says `blip: 4` or higher. The file is read-only here. |
| `fence-unclosed` | A code fence (three backticks or tildes) is opened on this line and never closed. Everything below it is read as code, so tasks and log entries under it are not seen, and nothing can be written below it until the fence is closed. |

The rest are **warnings**. The file works; these are things to tidy:

| Code | Meaning |
|---|---|
| `schema-v2` | A version 2 file. It can be read but not written until it is migrated. |
| `name-missing` | No `name`; the folder name is shown instead. |
| `name-slug` | The `name` looks like a folder name (`game-mod-tools`). |
| `now-missing` | No `now` line. |
| `now-long` | The `now` line is over 140 characters. |
| `title-long` | An open task's title is over 80 characters. |
| `title-shouting` | An open task's title is all capitals (three or more words). |
| `title-label` | An open task's title starts with an all-capitals label of four or more letters, such as `EMAIL:` or `NEEDS $99 -`. |
| `title-duplicate` | Two open tasks have the same title. |
| `detail-long` | The lines under one open task add up to more than 1,280 characters. |
| `log-bullet-long` | A log bullet is over 200 characters. |
| `due-not-iso` | A due date, in the header or at the end of an open task, is not a real `YYYY-MM-DD` date and is being ignored. |
| `done-in-queue` | A ticked task is still above `## Done`. It moves on the next write. |
| `open-in-done` | An unticked task is under `## Done`. It counts as open and moves on the next write. |
| `queue-too-long` | More than 25 open tasks. Nothing is refused; it is a nudge to prune. |
| `secret-shaped` | A line looks like it contains a password, key or token: a known token shape (`ghp_…`, `sk-…`, a JWT, an AWS key id, …), a package-manager `_authToken=` line, or a word such as `password`, `pin`, `token` or `api_key` followed by a value that is not a word (6 or more characters with a digit or a symbol in them, digits alone included, or 16 or more token characters in a row); after `Authorization: Bearer` any value counts. `password: reset flow`, a `$VAR`, a backticked name, a `<placeholder>`, a date, a link and a quoted lower-case phrase are prose and are not reported. Not caught: a password of letters only shorter than 16, a value under 6 characters, and a passphrase of lower-case words. Only the line number is reported, never the text. |

---

## Files from version 2

A file with no `blip` key was written by RADAR 2 or earlier. RADAR 3 **reads** it: your
projects, tasks and log all show up. It will not **write** to it until you run
`radar-blip migrate` once. Migration happens only when you ask for it, saves a copy of the
original first (outside your project folder), and tells you everything it changed. Running
it again on a migrated file does nothing.

What migration changes:

| In a version 2 file | In version 3 |
|---|---|
| no `blip` key | `blip: 3`, first |
| `category` | becomes the first tag (lower-case, hyphenated) |
| `operation` | becomes a tag, after your existing tags |
| `deadline` | renamed `due`, keeping only the date |
| `status: shipped` | `status: archived` |
| `horizon`, `priority`, `radar_angle`, `last_session` | removed. The order of the tasks is the priority now; `focus` pins a project. |
| `created` | kept as it is |
| ticked tasks scattered through the list | moved under `## Done`, in the same order, with their detail. No finish date is made up for them. |
| an open task with a title over 80 characters | split into a title and a first detail line (below) |
| a log with the oldest entry first | reordered newest first. Entries are moved whole and never edited. |
| the placeholder comments under `# Tasks` and `# Session log`, and a `# Notes` section containing only its placeholder comment | removed |
| every other key and section | untouched |

Migration never guesses at what only you can decide: it does not make up a `name`, a `now`
line or a `focus` pin.

### Files migration leaves alone

`radar-blip migrate` reports each of these and does not touch the file:

- a file with a `secret-shaped` line, unless you pass `--allow-secret-shaped`: the copy it
  saves first would hold the value too. The report gives the line numbers; move the value
  out of the file, or confirm it is not a secret, and run it again;
- a file that is not UTF-8 text, a header that is not valid YAML, or a header that cannot
  be rewritten without breaking it (a key that another key refers to with a YAML alias);
- a file that would not read back as migrated, almost always because of a code fence that
  is never closed (`fence-unclosed` gives its line). Close the fence and run it again;
- a file that keeps changing while it is being migrated (an editor saving it), or whose
  backup copy cannot be written.

Migration also does not run until the machine is ready for it: the `/blip` skill and the
hooks that keep the files current must be the version 3 ones, so that nothing writes a
migrated file the old way. `radar-blip setup` installs them.

### How a long title is split

Version 2 let a task run to any length on one line. Migration keeps the first part as the
title and moves the rest, unchanged, to the first detail line. It looks for a natural
break between character 20 and character 80: after `:`, `;` or `.`, or before a dash or
an opening bracket. It will not break inside `` `code` ``, `**bold**` or brackets, nor
after initials (`J.R. Hartwell`) or an abbreviation. If there is no natural break it cuts at
the last space that fits.

Nothing is lost and nothing is reworded: the title, a space, and the first detail line put
back together are exactly the original line. If splitting would leave two open tasks with
the same title (several tasks that start with the same lead-in, say), each of them is split
at its next break instead, and so on until every title is its own; a task that runs out
of breaks that way takes back the first of its titles that no other task ended up with.
A title never ends on a `(due …)` or `(done …)` from the middle of the line, which would
read back as a due date or a done stamp. Only tasks with the same text as another, and
tasks with nowhere else to break, are left as they were (and reported as `title-long`); the
migration report says why each one was left.

### Retired: `next_action`

Version 2 once kept the next step in a `next_action` header key. The next step is simply
the first open task now. On migration a `next_action` becomes the first task, unless a
task with that text already exists (open or done), and the key is removed either way.

---

## Limits at a glance

Lengths are counted in characters after collapsing runs of spaces.

| What | Limit | What happens beyond it |
|---|---|---|
| `name` | 2–32 characters | refused when written through RADAR |
| `now` | 140 characters, one line | refused when written through RADAR; reported in a hand-edited file |
| task title | 3–80 characters, not counting the `(due …)` and `(done …)` endings | refused when written through RADAR; reported in a hand-edited file |
| task detail written through RADAR | 8 lines of 160 characters | refused |
| one log entry written through RADAR | 6 bullets of 200 characters | refused |
| open tasks | 25 | a warning only; nothing is ever refused for the length of the list |

Hand edits and migration are exempt from every limit, because they must never lose what
you wrote. RADAR reports what is over instead.
