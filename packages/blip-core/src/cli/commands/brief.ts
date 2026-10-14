import { buildBrief, type Brief } from '../../brief.js';
import { PROJECT_OPTIONS, projectDir, worktreeOf, type Command } from '../shared.js';

function render(b: Brief): string[] {
  const out = [`${b.name}${b.focus ? '  ★' : ''}  [${b.status}]${b.due ? `  due ${b.due}` : ''}`, b.dir, `rev ${b.rev}${b.owner ? `   owner ${b.owner}` : ''}`];
  out.push(`now   ${b.now ?? '(not set)'}`);
  const s = b.since;
  const work = [s.commits !== null ? `${s.commits} commit${s.commits === 1 ? '' : 's'}` : null, s.files !== null ? `${s.files} file${s.files === 1 ? '' : 's'} changed` : null, s.dirty ? 'uncommitted changes' : null, s.branch ? `on ${s.branch}` : null].filter(Boolean);
  out.push('', `Since ${s.at ?? 'the last 30 days'}: ${work.join(', ') || 'nothing to report'}`);
  for (const l of s.subjects) out.push(`  ${l}`);
  out.push('', `Tasks (${b.open} open)`);
  for (const t of b.tasks) {
    out.push(`${String(t.n).padStart(3)}. ${t.title}${t.due ? `  (due ${t.due})` : ''}`);
    for (const d of t.detail ?? []) out.push(`       ${d}`);
  }
  if (b.omitted) out.push(`     … ${b.omitted} more: radar-blip show`);
  if (b.log.length) out.push('', 'Log');
  for (const e of b.log) {
    out.push(`  ${e.heading}`);
    for (const l of e.bullets) out.push(`    - ${l}`);
  }
  if (b.problems.length) out.push('', ...b.problems.map((p) => `${p.severity === 'error' ? 'error' : 'warn '}  ${p.code}  ${p.message}`));
  out.push('', `Write the sync payload to: ${b.payloadPath}`);
  return out;
}

export const brief: Command = {
  usage: '[--path DIR] [--json]',
  summary: 'what an agent needs before a sync: the queue by number, the newest log, work since the last sync; --json is at most 8 KB',
  options: PROJECT_OPTIONS,
  async run(args) {
    const dir = projectDir(args);
    const worktree = worktreeOf(args, dir);
    const b = await buildBrief(dir, worktree === undefined ? {} : { worktree });
    return { data: b, lines: render(b) };
  },
};
