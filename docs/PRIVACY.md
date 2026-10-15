# Privacy

RADAR works on local files. It has no account, no server and no telemetry. This is the full list
of what the app and the `radar-blip` engine read, write and send.

## What it reads

- The `BLIP.md` of each project you track.
- Git metadata in those folders. Every git call goes through one runner
  (`packages/blip-core/src/git.ts`) that switches off repository settings able to run a program
  (fsmonitor, hooks, the pager, signature checks, clean/smudge filters), drops inherited `GIT_*`
  variables and runs with optional locks off, so git does not refresh the index. The engine
  runs read-only commands: `log`, `rev-list`, `rev-parse`, `status`, `ls-files`,
  `check-ignore`, `config` and `hash-object`. `hash-object` reads the **contents** of files
  with uncommitted changes, to tell whether they changed since the last look; the hash is kept
  and the contents are not.
- File modification times in tracked folders, for recency where there is no git.
- In the Stop hook, the transcript of the Claude Code session that is stopping, to see which
  files it edited and whether it committed. The app itself only reads transcript modification
  times, to show which sessions are live.

## What it writes

- `BLIP.md` in a tracked folder, only through the engine.
- Its data folder (`%APPDATA%\radar-blip` on Windows,
  `~/Library/Application Support/radar-blip` on macOS, `${XDG_DATA_HOME:-~/.local/share}/radar-blip`
  on Linux, or `RADAR_BLIP_HOME`): the project list, locks, per-project sync state, live-session
  markers, removed tasks, migration backups, and the `bin` folder holding the app's `radar-blip`
  shim.
- After you confirm setup: Claude Code's `settings.json` (with a backup), the skill and Codex
  prompt files, and your user PATH (on Windows the previous value is kept in
  `<data folder>\path.radar-bak`).
- The app's own window position and update log in its Electron profile folder.

## What it never writes

Your source files, your git repositories (no commits, no checkouts, no config), or your agent
transcripts. A `BLIP.md` from a repository you cloned is treated as untrusted input: only
`http`, `https` and `mailto` links open, and nothing in it is ever run.

## Network

The app checks GitHub Releases for a newer version at launch and when you press *Check for
updates*, and downloads it when there is one. Nothing else goes over the network, and the CLI
makes no network calls.

Security reports: [.github/SECURITY.md](../.github/SECURITY.md).
