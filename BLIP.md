---
name: RADAR
horizon: week
priority: 1
category: Product
status: active
next_action: "Merge the chore/v1-launch PR, then run RELEASING.md: npm publish radar-blip (needs npm login) then tag v1.0.0 + electron-builder --publish (needs GH_TOKEN) then make the repo public"
operation: TerraByte
created: 2026-06-11
last_session: 2026-06-19T05:13:47.539Z
---

# Tasks
<!-- RADAR-owned checklist. Edited by the app and `radar-blip task ...`. -->
- [x] Review the stacked PRs: close-the-loop #11, settings-themes #12, ship-v1 cleanup
- [x] Free the RADAR repo name: rename or delete the private TerraByte-Dev/RADAR prototype
- [ ] Publish radar-blip to npm BEFORE the repo goes public (unclaimed name + the skills' npx -y fallback = squat risk; docs/RELEASING.md)
- [x] Merge the stack into PR #10, then PR #10 into main - main must be the real product before going public
- [ ] Make the repo public, then flip the About repo link
- [ ] Code-sign the installers (docs/RELEASING.md)
- [ ] Cut the v1.0.0 GitHub Release: electron-builder --publish always (needs GH_TOKEN); installers unsigned for now

# Session log
<!-- Append-only. `radar-blip handoff` adds a dated entry; prior entries are never rewritten. -->

## 2026-06-11 — Tate + Claude
- Ship-v1 cleanup shipped as draft PR #14 (Closes #13): legacy task stack deleted, RADAR rebrand finished, README/DESIGN/CHANGELOG rewritten, radar-blip publish-ready
- Adopted this repo onto its own radar (this file); full review stack pushed as PRs #10-#14
- Adversarial review caught a rename blocker: a private TerraByte-Dev/RADAR prototype repo already holds the name (sequencing in docs/RELEASING.md)

## 2026-06-11 — Tate + Claude
- Pre-public hardening shipped as draft PR #16 (Closes #15): 6-lens adversarial audit, all 39 confirmed findings fixed - link/scheme allowlists, IPC path guards, engine fence-aware round-trip + updateBlip concurrency, content-hash watcher echo, error boundary, sandbox:true (212 tests green)
- Launch sequencing is now load-bearing: npm publish BEFORE going public (unclaimed radar-blip + the skills' npx -y fallback = squatter code execution); private TerraByte-Dev/RADAR prototype blocks the rename

## 2026-06-19 — tatew
- v1.0.0 launch prep (branch chore/v1-launch): relinked the moved workspace so 212 tests + typecheck are green again; added scripts/doctor.mjs self-heal guard + GitHub Actions CI (ubuntu+windows); bumped app+engine to 1.0.0 and dated the CHANGELOG
- Built and smoke-tested the FIRST desktop installer: dist/RADAR Setup 1.0.0.exe (unsigned) + win-unpacked/RADAR.exe boots clean; polished the radar (fleet +N overflow badge, functional show-completed toggle)
- Closed the stale PRs #11/#12/#14/#16 and tracking issues #13/#15 (content already in main via e596122)

# Notes
<!-- Human-only. Tooling never rewrites this section. -->
