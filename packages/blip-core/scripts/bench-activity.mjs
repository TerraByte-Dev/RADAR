#!/usr/bin/env node
// Local benchmark for spec 7.5: activity for N synthetic projects (half git repositories,
// half plain folders), cold, at the board's concurrency. Prints the time; it is not a CI gate.
// Everything it creates lives under the OS temp folder and is deleted afterwards; the real
// data directory is never used. Run after a build: node scripts/bench-activity.mjs [N=40]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const n = Number(process.argv[2] ?? 40);
const root = mkdtempSync(join(tmpdir(), 'radar-bench-'));
process.env.RADAR_BLIP_HOME = join(root, 'data');
const { buildBoard } = await import('../dist/board.js');
const { registerProject, listProjects } = await import('../dist/registry.js');

const git = (cwd, when, ...args) =>
  execFileSync('git', ['-c', 'user.name=Bench', '-c', 'user.email=bench@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: when.toISOString(), GIT_COMMITTER_DATE: when.toISOString() },
  });

try {
  for (let i = 0; i < n; i++) {
    const dir = join(root, `p${i}`);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'BLIP.md'), `---\nblip: 3\nname: Bench ${i}\nnow: Measuring.\n---\n\n# Tasks\n\n- [ ] First task here\n\n# Session log\n`);
    for (let f = 0; f < 40; f++) writeFileSync(join(dir, 'src', `f${f}.txt`), String(f));
    if (i % 2 === 0) {
      git(dir, new Date(), 'init', '-q');
      git(dir, new Date(Date.now() - 20 * 86400_000), 'add', '-A');
      git(dir, new Date(Date.now() - 20 * 86400_000), 'commit', '-q', '-m', 'first');
      for (let c = 0; c < 10; c++) {
        writeFileSync(join(dir, 'src', `f${c}.txt`), `change ${c}`);
        git(dir, new Date(Date.now() - (10 - c) * 86400_000), 'commit', '-q', '-a', '-m', `change ${c}`);
      }
    }
    await registerProject(dir);
  }
  const { projects } = await listProjects();
  const t0 = performance.now();
  const records = await buildBoard(projects);
  const ms = Math.round(performance.now() - t0);
  const repos = records.filter((r) => r.activity?.source === 'git').length;
  console.log(`activity for ${records.length} projects (${repos} git) in ${ms} ms — spec 7.5 budget: about 4000 ms for 40`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
