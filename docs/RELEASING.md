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
npm run build:core                  # tsc + bundle the /blip skills into the package
cd packages/blip-core
npm publish --access public         # requires `npm login` as the package owner
```

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

### Prerequisites for a trusted production release
- **Repo rename:** rename `TerraByte-Dev/ToDoPlus` → `RADAR` so `publish.repo` matches (and update
  the git remote). Until then, point `publish.repo` at the current repo name.
- **Code signing:** Windows (Authenticode) and macOS (Developer ID + notarization) certificates are
  required for installs that don't warn, and for macOS auto-update to work at all. CI injects them
  via the standard electron-builder env vars (`CSC_LINK`/`CSC_KEY_PASSWORD`, `APPLE_*`).

---

## Checklist

- [ ] Bump app + engine versions; update any changelog.
- [ ] `npm run typecheck && npm test && npm run build` green.
- [ ] `npm publish` the engine (if it changed).
- [ ] `electron-builder --publish always` with signing creds + `GH_TOKEN`.
- [ ] Verify the GitHub Release has installers + `latest.yml` / `latest-mac.yml` / `latest-linux.yml`.
- [ ] Smoke-test auto-update from the previous version.
