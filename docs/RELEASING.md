# Releasing RADAR

RADAR ships as **two artifacts**:

1. **`radar-blip`** (npm) — the `BLIP.md` engine + CLI + the `/blip` skills. The distributable
   on-ramp: anyone can `npm i -g radar-blip` and feed their projects from Claude Code / Codex.
2. **RADAR desktop app** — the flagship radar, packaged as signed installers with auto-update.

Bump versions first: the app version in `package.json`, the engine version in
`packages/blip-core/package.json`. Tag the release commit (`vX.Y.Z`).

---

## 1. Publish `radar-blip` to npm

```bash
cd packages/blip-core
npm publish --access public         # requires `npm login` as the package owner
```

`prepublishOnly` ("npm test") rebuilds the engine (tsc + skill bundling) and runs its test
suite automatically on publish — `dist/` and `skills/` are git-ignored, so without the guard a
fresh-clone publish would silently ship an empty tarball.

The package's `files` are `dist` + `skills`, so the compiled engine, the `radar-blip` bin, and
both `/blip` skills ship in the tarball. End users then:

```bash
npm i -g radar-blip
radar-blip skills install           # drops /blip into ~/.claude and ~/.codex
```

Until it is published, the skills resolve the CLI via the `npx -y radar-blip` fallback, or a
local global link (`cd packages/blip-core && npm i -g .`).

> The package name `radar-blip` is reversible until the first publish — confirm availability
> (`npm view radar-blip`) before pushing.

---

## 2. Package + release the desktop app

`electron-builder` config lives in `electron-builder.yml` (Win NSIS · mac dmg · linux AppImage;
icons from `build/`). Auto-update is wired in `src/main/index.ts` (packaged builds only) and reads
the `publish:` block at runtime via `electron-updater`.

```bash
npm run package                     # build:core → electron-vite build → electron-builder (local installers in dist/)
```

To cut a release that auto-update can see, publish to the GitHub repo named in
`electron-builder.yml` → `publish` (`owner/repo`):

```bash
# GH_TOKEN must have repo scope on the publish target
GH_TOKEN=… npx electron-builder --publish always       # add -w / -m / -l to target a platform
```

This uploads the installers + the `latest*.yml` update manifests to a GitHub Release;
`autoUpdater.checkForUpdatesAndNotify()` then finds them on the next launch.

### Launch sequencing — do these **in order**

> ⚠ **Why npm comes before going public:** both `/blip` skills tell agents to fall back to
> `npx -y radar-blip`, which downloads **and executes** whatever package holds that name on the
> npm registry — and `radar-blip` is currently **unclaimed**. If this repo goes public (skills
> included) before the package is published, a squatter can claim the name and get arbitrary
> code auto-executed on every agent machine that runs the skill. Publishing first closes that
> window; the only cost is the package's repository/homepage links 404ing for the few minutes
> the repo stays private.

1. ~~**Free the RADAR repo name.**~~ ✅ Done 2026-06-12 — the old prototype was renamed to
   `TerraByte-Dev/RADAR-prototype` (still private; delete it via the GitHub UI or a token with
   `delete_repo` scope when convenient).
2. ~~**Rename `TerraByte-Dev/ToDoPlus` → `RADAR`.**~~ ✅ Done 2026-06-12 — the repo, the local git
   remote, `About.tsx`, and the GitHub description all say RADAR. (`electron-builder.yml` →
   `publish.repo` already matched.) The repo is **still private**.
3. **`npm publish` `radar-blip`** (see above; `prepublishOnly` guards the build). Confirm the name
   is still available right before publishing: `npm view radar-blip`.
4. **Merge the PR stack so `main` is the real product.** Going public with the pre-pivot ToDoPlus
   `main` — and no `LICENSE` on `main` — is a blocker.
5. **Make the repo public.** The package's repository/homepage links now resolve.
6. **Set the GitHub social preview** (Settings → General → Social preview → upload
   `docs/assets/og-image.png`). This is the card shown when the repo is shared on social/chat — it
   can't be set via the API, so it's a manual upload.
7. **Flip `About.tsx`'s repo link** to the renamed public repo.
8. **Code-sign the installers.** Windows (Authenticode) and macOS (Developer ID + notarization)
   certificates are required for installs that don't warn, and for macOS auto-update to work at
   all. CI injects them via the standard electron-builder env vars (`CSC_LINK`/
   `CSC_KEY_PASSWORD`, `APPLE_*`).

---

## Checklist

- [ ] Bump app + engine versions; move the `CHANGELOG.md` **[Unreleased]** section under the
      new version heading.
- [ ] `npm run typecheck && npm test && npm run build` green.
- [ ] `npm publish` the engine (if it changed).
- [ ] `electron-builder --publish always` with signing creds + `GH_TOKEN`.
- [ ] Verify the GitHub Release has installers + `latest.yml` / `latest-mac.yml` / `latest-linux.yml`.
- [ ] Smoke-test auto-update from the previous version.
