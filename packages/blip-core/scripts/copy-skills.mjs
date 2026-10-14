// Bundle the repo-root /blip skills into this package so `radar-blip setup` can install them
// into a user's Claude Code and Codex folders from the published tarball. npm only packs
// files inside the package dir, hence the copy. The repo-root skills/ stay the single source
// of truth; packages/blip-core/skills/ is generated (git-ignored).
//
// Runs after `tsc`, and fails the build when a skill file does not carry the stamp for this
// engine's SKILL_FORMAT: setup and doctor compare that number, so a skill edited without
// bumping it (or the other way round) would never be installed or reported.
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPS } from '../dist/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url)); // packages/blip-core/scripts
const pkgRoot = join(here, '..'); //                    packages/blip-core
const repoRoot = join(pkgRoot, '..', '..'); //          repo root

const files = [
  'skills/claude/blip/SKILL.md',
  'skills/codex/blip.md',
];

const stamp = `<!-- radar-blip-skill v${CAPS.SKILL_FORMAT} -->`;
for (const rel of files) {
  const src = join(repoRoot, rel);
  if (!readFileSync(src, 'utf8').includes(stamp)) {
    console.error(`copy-skills: ${rel} does not carry ${stamp} (CAPS.SKILL_FORMAT is ${CAPS.SKILL_FORMAT})`);
    process.exit(1);
  }
  const dest = join(pkgRoot, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}

console.log(`copy-skills: bundled ${files.length} skill file(s) into packages/blip-core/skills/`);
