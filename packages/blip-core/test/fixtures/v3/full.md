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
  - ftp://files.example.com/not-shown
created: 2026-03-02
owner_note: "kept: exactly as written"
---

# Tasks

- [ ] Design the conflict screen so sync can be switched on
  Sync is merged behind the `sync_v2` flag.
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
