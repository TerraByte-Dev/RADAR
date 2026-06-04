// Bundle the repo-root /blip skills into this package so `radar-blip skills
// install` can drop them into a user's ~/.claude and ~/.codex from the published
// tarball. npm only packs files inside the package dir, hence the copy.
// The repo-root skills/ stay the single source of truth; packages/blip-core/skills/
// is generated (git-ignored).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // packages/blip-core/scripts
const pkgRoot = join(here, '..'); //                    packages/blip-core
const repoRoot = join(pkgRoot, '..', '..'); //          repo root

const files = [
  'skills/claude/blip/SKILL.md',
  'skills/codex/blip.md',
];

for (const rel of files) {
  const dest = join(pkgRoot, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(repoRoot, rel), dest);
}

console.log(`copy-skills: bundled ${files.length} skill file(s) into packages/blip-core/skills/`);
