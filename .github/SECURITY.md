# Security Policy

RADAR is a **local-first desktop app** and CLI: no servers, no accounts, no telemetry. Your data
is plain `BLIP.md` files in your own folders plus the engine's data folder. The only network
traffic is the app's update check and download (`electron-updater` against GitHub Releases).

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub's private vulnerability reporting:
**Security tab → Report a vulnerability** on this repository. Don't open a public issue for
security problems. You'll get a response as soon as practical — this is a one-person project,
so "practical" usually means days, not hours.

## Threat model — what's in scope

- **Untrusted `BLIP.md` content.** RADAR parses the `BLIP.md` of every project you track,
  including ones in repositories you cloned from strangers. That content is untrusted: only
  `http:`, `https:` and `mailto:` links are handed to the OS, nothing in a file is ever run, and
  reveal and open-in-editor act only on a tracked project's own folder (an editor inside the
  project is never launched). Bypasses of any of that are in scope.
- **Renderer/IPC escape.** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  a strict CSP, navigation blocked, and one typed route table (`src/shared/ipc.ts`) as the only
  way from the page to the main process. Anything that reaches Node or disk outside it.
- **Engine write safety.** `radar-blip` writes under a per-project lock, atomically and all or
  nothing, and copies every byte it does not manage. A write that clobbers user content, or a
  file that cannot be parsed being overwritten, is in scope.
- **Hooks and git.** Every git call the engine makes (the Claude Code hooks, the activity
  reader, `migrate`) goes through one runner with repository config that could execute code
  switched off (`core.fsmonitor`, `core.hooksPath`, the pager, clean/smudge filters, inherited
  `GIT_*` variables). A tracked repository that gets code run through them is in scope.

Only the latest release gets fixes.
