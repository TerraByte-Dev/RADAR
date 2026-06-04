# ToDoPlus → RADAR — Pivot Handoff

_Prepared 2026-06-03. Read this with `CLAUDE.md`, `HANDOFF.md`, and `docs/DESIGN.md`._

## The move

We're repivoting: **refine ToDoPlus into RADAR** — TerraByte's *personal project radar*. ToDoPlus
already is the best-built radar app we have (CRT skin, continuous-deadline canvas radar, calendar,
logbook, NLP, keyboard control, tests). RADAR is the *product vision* it should become. This session
keeps ToDoPlus's polish and grows it into RADAR. (TerraPlayer is a separate music app and is **done**
for now — out of scope.)

## What RADAR is (the vision)

> "RADAR turns every project you're working on into a **blip** on a radar screen. Each blip is fed by
> a plain-text **`BLIP.md`** file that your **AI coding agent writes for you** as you work (via the
> `/blip` command). You get a living, bird's-eye view of everything you're building — without ever
> filling out a to-do app."

The game-changing loop: **agent writes your state → it's a plain file in your repo → a desktop radar
visualizes it.** Four invariants (set in stone; everything else is open):

1. **Name = RADAR, unit = blip.**
2. **AI-fed, never micromanaged** — state is a byproduct of agent work; if a feature adds manual
   upkeep, it's probably wrong.
3. **Universal** — must fit *everything*: a one-line errand, a hard deadline, a sprawling project, a
   whole business operation.
4. **Local-first plain files** — you own it as Markdown (the Obsidian stance); tool-neutral (Claude
   Code + Codex).

**Who it's for:** people juggling many projects who lose the thread between them. (One project + good
memory → you don't need a radar.) Origin (Tate, CONCEPT.md): *"I struggle at knowing my next steps…
because I usually have a lot of projects on my radar at any moment."*

## The two codebases (and why this pivot is natural)

| | **ToDoPlus** (`C:\Users\tatew\Desktop\ToDoPlus`) | **RADAR** (`…\TerraByte Solutions LLC\Production\Products\RADAR`) |
|---|---|---|
| Grain | **Tasks** (fine), one JSON store | **Projects** (coarse), one `BLIP.md` per repo |
| Radar axis | **Continuous, log-compressed days-to-due** (exact dates, drag-to-reschedule) | 3 discrete horizons (today/week/someday), drag snaps to bucket |
| Skin | TERRABYTE.SYS phosphor-green CRT | leaner teal (`#35e6b0`), frameless |
| Stack | React+TS, Zustand, Tailwind, Radix, Framer, cmdk, chrono NLP, **vitest** | React+TS, Zustand, Tailwind, **chokidar** (live file-watch); no NLP/tests |
| Data | renderer → IPC → `repository.ts` (atomic JSON) | scans configured roots for `BLIP.md`, parses via shared `radar-blip` engine, watches for changes |

**Key insight:** ToDoPlus's continuous deadline radar already *solves RADAR's #1 open gap* (real
dates vs fuzzy horizons). ToDoPlus brings the polish + the deadline engine; RADAR brings the
**project layer** (BLIP.md ingestion, agent-fed state, multi-project portfolio view) and the
**`blip-core` engine** (npm `radar-blip`) that the app, a CLI, and the `/blip` skill all share.

## The data model to absorb — `BLIP.md`

One Markdown file in a project's root *is* that project's radar state (its presence = "tracked
project"; no central registry). All writes go through **one engine** (`blip-core`/`radar-blip`) with a
**byte-for-byte round-trip + atomic write** guarantee; unparseable files become a "signal lost" blip,
never overwritten. **Golden rule: never hand-edit a BLIP.md — go through `radar-blip`.**

- **Frontmatter (10 known keys):** `name`, `horizon` (today|week|someday → ring), `priority` (1–5 →
  size), `category` (free text → color), `status` (active|paused|blocked|shipped|archived → styling),
  `next_action` (one imperative line → queue subtitle), `created`, `last_session`, `tags`, `links`.
  Unknown keys preserved verbatim.
- **Body (3 headings):** `# Tasks` (RADAR-owned GFM checklist → progress arc), `# Session log`
  (append-only `## YYYY-MM-DD — <author>` handoff entries), `# Notes` (human-only, never touched).
- **CLI:** `radar-blip init | show | set | task | handoff | skills install`. `/blip` skill default =
  `handoff` (agent writes 1–4 past-tense bullets + the next action).

## What the user is looking for (from FEEDBACK.md / CONCEPT.md)

Loved as-is: the radar view, today/week/someday looseness, the BLIP.md-per-project + `/blip` skill
idea. *"A great starting point… there is much to think through, let's plan together. Get something
bulletproof."* The wishlist:

- **First-class deadlines/dates** — reconcile fuzzy horizons with real dates (ToDoPlus already has this).
- **Universal capture** — how do non-code tasks / errands / pure deadlines get onto the radar
  *without* an agent-bearing repo? (The hardest open question for invariant #3.)
- **3-tier model:** task → project → **operation** (a cluster of projects shown as a zoomable radar
  *sector*) + lightweight tiny-task blips.
- **Auto-discovery / "ghost blips":** read `CLAUDE.md`/`AGENTS.md`, surface un-adopted repos as ghost
  blips with one-click adopt (zero setup; read anything, only ever *write* `BLIP.md`).
- **Activity heatmap** — GitHub-style project history / momentum (CONCEPT core wish; deferred Phase 5).
- **Stale / "Neglected" view** — auto-flag projects inactive >30 days so nothing is forgotten.
- **Status visuals** — blocked pulses, shipped dims, archived hidden, signal-lost, progress arcs.
- **Productization** — publish `radar-blip` to npm (`npx radar-blip`), kill hardcoded paths,
  cross-platform, signed installer + auto-update, first-run onboarding/workspace discovery.
- **Keep it a simple Electron app** in the TerraPlayer mold — *not* a heavy agent harness.

## Open design questions to settle in planning (don't build before these)

1. **Repo home / identity:** evolve the *ToDoPlus repo* into RADAR (rename later) and pull in
   `blip-core`? Or fold ToDoPlus's polish into the existing RADAR repo? (Working assumption: ToDoPlus
   is home; reuse `blip-core` as a dependency or vendor it.)
2. **Grain reconciliation:** ToDoPlus is task-grained (JSON); RADAR is project-grained (BLIP.md files
   on disk). How do tasks, projects, and operations coexist on one radar — and where does each live?
3. **Deadlines × horizons:** keep ToDoPlus's exact dates as the backbone and *derive* today/week/
   someday bands from them? (Likely yes — best of both.)
4. **Universal capture** for non-repo items (errands/deadlines) without breaking "AI-fed, local files."
5. **Productization scope** for v1 (npm CLI, onboarding, cross-platform, auto-update) vs later.

## Current ToDoPlus state (where you're starting)

- **`main`** has the radar **angular-drag** feature (PR #2, merged).
- **Three open draft PRs** — decide whether to merge before the pivot:
  - **#4** radar review fixes · **#6** 16-color project palette · **#8** transparent globe-sword logo + `.ico`
- Gates on `main`: `npm run typecheck` ✓ · `npm test` (59) ✓ · `npm run build` ✓.
- Private repo `TerraByte-Dev/ToDoPlus`. Conventions in `CLAUDE.md` (branch-first, Conventional
  Commits, draft PRs, tests+docs+build green before "done").

## Working mode for the new session

**Plan first — the user explicitly wants to design this together and "get something bulletproof."**
Read the references, then enter plan mode and propose the ToDoPlus→RADAR architecture (answering the
open questions above) and present it for approval **before** writing code.

## References

- RADAR product folder: `C:\Users\tatew\Desktop\Tate\TerraByte Solutions LLC\Production\Products\RADAR`
  — read `CONCEPT.md`, `FEEDBACK.md`, `CLAUDE.md`, `SPEC.md`, `docs/BLIP-SCHEMA.md`, the desktop app
  (`apps/desktop/src`), and the engine (`packages/blip-core/src`). (`01-building/`, `02-documenting/`
  are empty.)
- RADAR repo: `TerraByte-Dev/RADAR` (GitHub). The `/blip` skill is already installed in this environment.
