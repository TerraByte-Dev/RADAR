# BLIP.md — Schema of Record

A `BLIP.md` lives in the **root of a project folder** and is that project's state on your radar. It is the single source of truth: the RADAR desktop app, the `radar-blip` CLI (`packages/blip-core`), and the `/blip` skills all read and write it through one shared engine.

The filename `BLIP.md` is the marker — a folder containing one is "a project RADAR tracks." No central registry exists; project state travels with the folder.

> **Golden rule:** never hand-edit a `BLIP.md`. Every write goes through `radar-blip` (the engine), which guarantees a byte-faithful round-trip and an atomic write.

---

## Anatomy

```markdown
---
name: RADAR
horizon: week
deadline: 2026-07-01
priority: 1
category: Product
status: active
operation: TerraByte
next_action: "Wire BLIP.md scan into the radar"
created: 2026-05-25
last_session: 2026-05-25T18:30:00-04:00
radar_angle: 123.5
tags: [terrabyte, tooling]
links:
  - https://github.com/TerraByte-Dev/RADAR
---

# Tasks
<!-- RADAR-owned checklist. Edited by the app and `radar-blip task ...`. -->
- [x] Decide architecture
- [ ] Scaffold the Electron app
- [ ] Port the radar to React

# Session log
<!-- Append-only. `radar-blip handoff` adds a dated entry; prior entries are never rewritten. -->
## 2026-05-25 — Ada + Claude
- Locked the shared-engine architecture.
- Next: build blip-core.

# Notes
<!-- HUMAN-ONLY. Tooling never reads meaning from or rewrites this section. -->
Whiteboard sketch lives in the bedroom.
```

---

## Frontmatter fields

| Field | Type | Allowed / format | Owner | Drives |
|---|---|---|---|---|
| `name` | string | any | user (default = folder name) | blip label |
| `horizon` | string | `today` \| `week` \| `someday` | **RADAR** | radar **distance** *fallback* when no `deadline` |
| `deadline` | date | ISO `YYYY-MM-DD` or datetime | **RADAR** | radar **distance** (exact, continuous time-to-due) — **overrides** `horizon` |
| `priority` | integer | `1`–`5` (1 = top) | **RADAR** | radar **blip size** |
| `category` | string | free text (e.g. `Client`, `Product`, `Admin`) | **RADAR** | radar **blip color** |
| `status` | string | `active` \| `paused` \| `blocked` \| `shipped` \| `archived` | **RADAR** | radar styling / filtering |
| `operation` | string | free text | **RADAR** | radar **sector** grouping (zoomable cluster) |
| `next_action` | string | one short imperative line | **RADAR** | queue subtitle |
| `radar_angle` | number | degrees `[0, 360)` | **RADAR** (app) | a **pinned** blip bearing (visual only; set by dragging — never reassigns the project) |
| `created` | date | `YYYY-MM-DD` | engine (set once on `init`) | — |
| `last_session` | datetime | ISO 8601 | engine (set by `handoff`) | recency / staleness |
| `tags` | string[] | any | user | filtering |
| `links` | string[] / objects | URLs or `{label: url}` | user | detail view |
| *(any other key)* | — | — | **preserved verbatim** | — |

**Defaults when a field is missing on read:** `horizon: someday`, `priority: 3`, `category: ""`, `status: active`, `name: <folder name>`. `deadline`, `operation`, and `radar_angle` are optional and stay missing when absent. `radar_angle` is normalized into `[0, 360)` on read; a non-numeric value is dropped. A `deadline` that isn't a parseable date is ignored by the radar (and rejected at the CLI).

---

## Body sections

The body is parsed by top-level (`#`) headings. Three heading names are meaningful (case-insensitive); **every other section, and any text before the first heading, is preserved untouched.**

- **`# Tasks`** — RADAR-owned GFM checklist (`- [ ]` / `- [x]`). Managed by the app and `radar-blip task add|done|undone|toggle|rm|edit`. Open tasks become the **ship-markers** inside a project's fleet ring. A task may carry an optional trailing **`(due …)`** marker (e.g. `- [ ] Pay invoice (due 2026-07-01)` or `(due friday)`) — chrono-parsed by the app to tint its ship by urgency and surface it in the NOW overdue panel; the engine keeps the text verbatim. A leading HTML comment is preserved.
- **`# Session log`** — append-only. `radar-blip handoff` adds a dated `## YYYY-MM-DD — <author>` entry and updates `last_session` + `next_action`. Prior entries are never edited or reordered.
- **`# Notes`** — human-only. The engine and skills never rewrite this section or derive behavior from it.

---

## Ownership & the non-destructive guarantee

The engine's serialize step is a **faithful round-trip**: parsing a file and serializing it back with no model changes reproduces the original byte-for-byte, except where a managed field/section was deliberately edited. Concretely:

1. **Unknown frontmatter keys** keep their value, order, and inline YAML comments.
2. **Unmanaged body sections** (`# Notes` and any user heading) are spliced back in their original position, verbatim.
3. **`# Session log`** is only ever appended to.
4. Writes are **atomic** — a temp file in the same directory is renamed into place, so a crash mid-write never corrupts `BLIP.md`.
5. A file that fails to parse is surfaced as an error (a "signal lost" blip in the app) and is **never overwritten**.

---

## Radar mapping (how fields become a blip)

- `deadline` → **distance from center** on a continuous, log-compressed time-to-due scale (dead-center = now; far-future compresses toward the rim). When absent, `horizon` picks a representative band (`today` inner · `week` middle · `someday` rim).
- `priority` → blip **diameter** (P1 largest).
- `category` → blip **color** (curated palette; stable hash for new categories).
- `status` → **styling**: `blocked` pulses, `shipped` dims, `archived` hidden from the active scope, parse-error = "signal lost".
- `operation` → groups projects into a radar **sector** you can zoom into.
- `radar_angle` → a **pinned bearing** (drag a blip to set it; clears to re-join the auto fan).
- `# Tasks` → a project with tasks becomes a **fleet** (a hollow ring with one ship-marker per open task); ships tint by each task's `(due …)` urgency. A project with no tasks is a single solid blip.
