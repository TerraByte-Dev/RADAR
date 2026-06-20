# Security Policy

RADAR is a **local-first desktop app**: no servers, no accounts, no telemetry. Your data is
plain `BLIP.md` files in your own repos. The only network call is the optional update check
(`electron-updater` against GitHub Releases).

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub's private vulnerability reporting:
**Security tab → Report a vulnerability** on this repository. Don't open a public issue for
security problems. You'll get a response as soon as practical — this is a one-person project,
so "practical" usually means days, not hours.

## Threat model — what's in scope

- **Untrusted `BLIP.md` content.** The app scans folders and parses any `BLIP.md` it finds —
  including in repos you cloned from strangers. That content is treated as untrusted input:
  links are allowlisted (`http:`/`https:` only), nothing in a blip is ever executed, and
  file-open/reveal actions are constrained. Bypasses of any of that are squarely in scope.
- **Renderer/IPC escape.** `contextIsolation: true`, `nodeIntegration: false`, strict prod CSP.
  Anything that lets renderer-side content reach Node or disk outside the typed IPC surface.
- **Engine write safety.** `radar-blip` writes atomically and must never clobber `# Notes`,
  unknown frontmatter keys, or files that fail to parse.

Pre-1.0: only the latest release is supported with fixes.
