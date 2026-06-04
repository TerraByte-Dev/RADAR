# radar-blip

**Own your project state in a plain Markdown file your AI coding agent keeps current.**

`radar-blip` is the engine + CLI behind [RADAR](https://github.com/TerraByte-Dev/RADAR). Every
project folder carries a `BLIP.md` — a human-readable, git-friendly state file holding the
project's horizon, priority, status, next action, task checklist, and session log. Your AI
coding agent (Claude Code or Codex) writes it as you work via the `/blip` skill; the RADAR
desktop app plots every project as a blip on a radar. One shared engine performs every write —
atomically, preserving your prose and any unknown keys byte-for-byte.

## Install

```sh
npm i -g radar-blip      # global CLI
# …or run it without installing:
npx -y radar-blip <args>
```

## Install the /blip skill

```sh
radar-blip skills install            # Claude Code + Codex (both)
radar-blip skills install --claude   # just Claude Code  → ~/.claude/skills/blip/SKILL.md
radar-blip skills install --codex    # just Codex        → ~/.codex/prompts/blip.md
```

Then run `/blip` in any project from your coding agent to capture a handoff. Re-run with
`--force` to overwrite an existing install.

## Commands

```
radar-blip init     [--name N] [--horizon today|week|someday] [--priority 1-5] [--category C] [--status S] [--next "…"] [--force]
radar-blip show     [--json]
radar-blip set      [--horizon H] [--priority 1-5] [--category C] [--status S] [--next "…"] [--name N] [--tag T …]
radar-blip task     add "text" | done|undone|toggle|rm <n|text> | list
radar-blip handoff  --line "did X" --line "did Y" --next "next action" [--author A]
radar-blip skills install [--claude] [--codex] [--force]
```

Every command operates on `./BLIP.md` by default; target another folder with `--path "DIR"`.
With no `--author`, `handoff` stamps the session log with your OS username.

## The BLIP.md guarantee

`radar-blip` owns a known frontmatter subset (`name, horizon, priority, category, status,
next_action, created, last_session, tags`), the `# Tasks` checklist, and the append-only
`# Session log`. **`# Notes`, any other heading, and any unknown frontmatter key are
round-tripped verbatim.** Writes are atomic (temp file + rename), and a file that fails to
parse is never overwritten. Never hand-edit a `BLIP.md` — go through `radar-blip` (or the app,
or `/blip`); they share this one engine, so they can't disagree.

## Use as a library

```ts
import { Blip, readBlip, writeBlipAtomic, createBlip } from 'radar-blip';

const blip = await readBlip('BLIP.md');
blip.setHorizon('today').addTask('Ship it');
await writeBlipAtomic('BLIP.md', blip);
```

## License

MIT © TerraByte Solutions LLC
