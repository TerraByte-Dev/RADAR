# Releasing RADAR

RADAR ships as two artifacts from this one repository:

1. **`radar-blip` on npm** — the `BLIP.md` engine, the CLI and the `/blip` skill files
   (`packages/blip-core`).
2. **The desktop app on GitHub Releases** — `RADAR-Setup-<version>.exe` plus `latest.yml`, which
   the installed app's update check reads. The app carries its own copy of the CLI.

Bump the app's version in `package.json` every release. Bump `packages/blip-core/package.json`
only when the engine changed; an app-only release leaves the published engine where it is. Both
are 3.0.0 for this release.

The steps below are in the order they must happen. Each one names why it is where it is.

**Merge to `main` last.** `main` is what visitors see. A README on `main` that describes the new
version, while the latest release and npm still serve the old one, sends people to the wrong
installer and the wrong CLI. So everything is built, published and tagged from the release
branch (the branch whose PR, or stack of PRs, holds the whole release, approved but not merged),
and the merge into `main` is step 6.

---

## 1. Before anything is published

On the release branch:

```bash
git switch <release branch> && git pull --ff-only
git status --short                     # must print nothing
npm ci
npm run typecheck
npm test
npm run e2e
npm run package -- --dir --publish never   # the unpacked app in dist/win-unpacked; open it once
```

In `CHANGELOG.md`, change `## [3.0.0] — unreleased` to today's date, commit that on the release
branch, and push it:

```bash
git push origin HEAD
gh pr checks --watch                   # CI on the release PR must pass before step 2
```

The commit that CI passed is the one that is published, tagged and later merged.

## 2. Publish `radar-blip` to npm — before the app tag

Why first: the moment the app release exists, every installed 2.0.1 / 2.0.2 finds it through its
update check. The README and the CHANGELOG tell people to `npm rm -g radar-blip` and then
`npm i -g radar-blip`, and `radar-blip doctor` fails while a 2.x CLI is on PATH. That
`npm i -g` must already install 3.0.0.

```bash
cd packages/blip-core
npm whoami                             # the package owner
npm run build                          # empties dist/ first, so nothing from a deleted source ships
npm pack --dry-run                     # read the list: every dist/ file has a source in src/
npm publish --access public --otp <6-digit code from your authenticator>
cd ../..
npm view radar-blip version            # 3.0.0
```

A version published to npm can never be changed, so read the `npm pack` list before publishing.
`prepublishOnly` (`npm test`) builds again (the build always starts from an empty `dist/`) and
runs the engine's tests before anything is uploaded. `dist/` and the bundled skills are
git-ignored, so `git status` in step 1 cannot show a stale file there. If the one-time code
expires during the tests, run the publish again with a fresh one.

## 3. Tag the release — before electron-builder runs

Why: given no tag, electron-builder creates `v3.0.0` itself, pointing at whatever the remote
default branch is at that moment (here, the old `main`), and without a message.

```bash
git tag -a v3.0.0 -m "RADAR 3.0.0"     # on the release branch's pushed tip
git push origin v3.0.0
```

## 4. Build and publish the installer

`npm run package` builds the engine, the app and the bundled CLI (`resources/cli/`) before
electron-builder runs, so use it rather than calling electron-builder directly. The token needs
`repo` scope on `TerraByte-Dev/RADAR`. In PowerShell:

```powershell
$env:GH_TOKEN = gh auth token
npm run package -- --publish always
Remove-Item Env:GH_TOKEN
```

`electron-builder.yml` sets `publish.releaseType: release`, so this creates a published release,
not a draft (electron-updater cannot see a draft: an update in a draft reaches nobody and looks
exactly like "no update available"). The installer is not code-signed: no certificate is
configured, and electron-builder says so in its output.

## 5. After it is published

```bash
gh release view v3.0.0 --json isDraft,isPrerelease,assets --jq '{isDraft,isPrerelease,assets:[.assets[].name]}'
```

- [ ] `isDraft` and `isPrerelease` are both `false`.
- [ ] The assets are `RADAR-Setup-3.0.0.exe`, `RADAR-Setup-3.0.0.exe.blockmap` and `latest.yml`.
- [ ] Put the CHANGELOG's 3.0.0 section in the release notes:
      `gh release edit v3.0.0 --notes-file <file holding that section>`.
- [ ] `npx -y radar-blip@3.0.0 --version` prints `3.0.0`.
- [ ] On a machine (or Windows user) with 2.0.2 installed: Settings → check for updates finds
      3.0.0, installs it, and the app opens on first run.
- [ ] Repo **Settings → General → Social preview**: upload `docs/assets/social-preview.png`
      (GitHub has no API for it).

## 6. Merge into `main`

Now that npm and the release serve 3.0.0, merge the release PR (for a stack, bottom PR first)
with a **merge commit**, never squash or rebase: either of those makes new commits, and `main`
would not contain the commit the tag points at.

```bash
git fetch origin
git merge-base --is-ancestor v3.0.0 origin/main && echo "main holds the tag"
gh run list --branch main --limit 1    # CI on main passes
```

## 7. Upgrade your own install

Follow [the CHANGELOG's upgrade steps](../CHANGELOG.md#upgrading-from-2x), the RADAR 2 Inbox
step included. After setup, `radar-blip doctor` shows every line `ok` except `projects`, which
stays a warning listing the files still in the v2 format until each is migrated (or left in it on
purpose).

---

## Checklist

- [ ] Versions bumped (`package.json`, and `packages/blip-core/package.json` if the engine
      changed); `package-lock.json` matches; CHANGELOG section dated, committed on the release
      branch and pushed.
- [ ] Typecheck, unit tests and e2e green locally; CI green on the release PR.
- [ ] `npm pack --dry-run` list read; `npm publish` of `radar-blip` (2FA) **before** the tag.
- [ ] Annotated tag pushed **before** electron-builder.
- [ ] `npm run package -- --publish always` with `GH_TOKEN`.
- [ ] Release is not a draft; installer, blockmap and `latest.yml` attached; notes in.
- [ ] Update from the previous version tested.
- [ ] Merged into `main` with merge commits **after** the release; `main` holds the tag; CI green.
- [ ] Own install upgraded, Inbox included.
