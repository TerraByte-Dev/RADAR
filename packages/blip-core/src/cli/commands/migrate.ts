import { BlipError } from '../../core/schema.js';
import { migrateProject, type ProjectMigration } from '../../io.js';
import { blipPath } from '../../paths.js';
import { migratePreflight } from '../../doctor.js';
import { systemGit } from '../../git.js';
import { listProjects } from '../../registry.js';
import { PROJECT_OPTIONS, projectDir, registryWarning, type Command } from '../shared.js';

/** git's trimmed output through the engine's hardened runner; null when git is missing or the call fails. */
async function git(dir: string, args: string[]): Promise<string | null> {
  const runner = systemGit();
  if (!runner) return null;
  try {
    return (await runner.run(dir, args, 5000)).trim();
  } catch {
    return null;
  }
}

/** Where the file stands with git, for the owner deciding how to migrate it: a tracked file is committed on its own afterwards. */
async function gitState(dir: string): Promise<string> {
  if ((await git(dir, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return 'not in a repo';
  if ((await git(dir, ['ls-files', '--error-unmatch', 'BLIP.md'])) !== null) return `tracked on ${(await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? 'an unknown branch'}`;
  return (await git(dir, ['check-ignore', '-q', 'BLIP.md'])) !== null ? 'ignored' : 'not tracked';
}

/** What fixes the failed checks: the 2.x CLI comes off PATH with npm, the skill and hooks come from setup. */
function preflightHint(ids: string[]): string {
  const steps = [
    ids.includes('cli') ? 'remove the 2.x radar-blip with "npm rm -g radar-blip"' : '',
    ids.some((id) => id !== 'cli') ? 'run "radar-blip setup"' : '',
  ].filter(Boolean);
  return `${steps.join(', ')}, then try again`;
}

const clip = (s: string, n: number): string => (Array.from(s).length > n ? `${Array.from(s).slice(0, n).join('')}…` : s);
const num = (n: number): string => n.toLocaleString('en-US');

function render(m: ProjectMigration, gitLine: string, dryRun: boolean): string[] {
  const path = blipPath(m.dir);
  if (m.skipped === 'already-v3') return [`${path}   already v3`];
  if (m.skipped === 'unwritable') return [`${path}   CANNOT BE MIGRATED: the file cannot be rewritten safely — see "radar-blip lint"`];
  if (m.skipped === 'newer-schema') return [`${path}   written by a newer radar-blip: left alone`];

  const out = [`${path}   v2 → v3   ${num(m.bytes.before)} → ${dryRun ? '~' : ''}${num(m.bytes.after)} bytes   git: ${gitLine}`];
  const row = (label: string, text: string): void => {
    out.push(`  ${label.padEnd(8)} ${text}`);
  };
  if (m.keys.length) row('keys', m.keys.join(' · '));
  if (m.dropped.length) row('dropped', m.dropped.map((d) => `${d.key}=${clip(d.value, 40)}`).join(' · '));
  if (m.kept.length) row('kept', m.kept.map((k) => `${k.key}=${clip(k.value, 40)}`).join(' · '));
  row('next', `next_action: ${m.nextAction}`);
  const t = m.tasks;
  const why = [
    t.leftLongWhy.collision ? `${t.leftLongWhy.collision} title collision` : '',
    t.leftLongWhy.noBreak ? `${t.leftLongWhy.noBreak} no space to cut at` : '',
    t.leftLongWhy.fence ? `${t.leftLongWhy.fence} would open a code fence` : '',
  ].filter(Boolean);
  row('tasks', `${t.open} open: ${t.split} split · ${t.cut} cut · ${t.leftLong} left long${why.length ? ` (${why.join(', ')})` : ''} · ${t.short} already short`);
  if (t.movedToDone) row('', `${t.movedToDone} ticked in the queue → ## Done`);
  const order = m.log.order === 'reversed' ? 'date order was ascending → reversed' : m.log.order === 'sorted' ? 'sorted by date, newest first' : 'already newest first';
  row('log', `${m.log.entries} entr${m.log.entries === 1 ? 'y' : 'ies'}: ${order}`);
  if (m.removed.length) row('removed', m.removed.join(' · '));
  for (const f of m.foreign) row('foreign', `checklist found inside preserved section "${f.heading}" (${f.items} items) — not imported`);
  if (m.secretLines.length) {
    const where = `line${m.secretLines.length === 1 ? '' : 's'} ${m.secretLines.join(', ')} match${m.secretLines.length === 1 ? 'es' : ''} a token pattern`;
    row('secrets', m.secretSkipped ? `${where} — this file ${dryRun ? 'will be' : 'was'} SKIPPED without --allow-secret-shaped` : `${where} — migrated anyway (--allow-secret-shaped)`);
  }
  const still = Object.entries(m.still).map(([code, n]) => (n > 1 ? `${n} × ${code}` : code));
  if (still.length) row('still', still.join(' · '));
  for (const e of m.examples) {
    row('example', `"${clip(e.original, 60)}"`);
    out.push(`           → title  "${e.title}"`, `             detail "${clip(e.detail, 60)}" (${Array.from(e.detail).length} chars)`);
  }
  if (m.backup) row('backup', m.backup);
  return out;
}

export const migrate: Command = {
  usage: '[--all] [--dry-run] [--allow-secret-shaped] [--path DIR] [--json]',
  summary: 'rewrite a v2 BLIP.md as v3, once (a backup is taken first); --dry-run shows what would change',
  options: { ...PROJECT_OPTIONS, all: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'allow-secret-shaped': { type: 'boolean' } },
  async run(args) {
    const dryRun = args.values['dry-run'] === true;
    const all = args.values.all === true;
    const { projects: registered, warning } = await listProjects();
    const dirs = all ? registered.map((p) => p.dir) : [projectDir(args)];

    if (!dryRun) {
      const failures = migratePreflight();
      if (failures.length) {
        throw new BlipError('E_PREFLIGHT', 'this machine is not ready to migrate; no file was changed', {
          hint: preflightHint(failures.map((c) => c.id)),
          violations: failures.map((c) => ({ code: 'E_PREFLIGHT', path: '', message: c.message })),
        });
      }
    }

    const files: (ProjectMigration & { git: string })[] = [];
    const missing: string[] = [];
    const failed: { dir: string; code: string; message: string }[] = [];
    const lines: string[] = [];
    for (const dir of dirs) {
      let m: ProjectMigration;
      try {
        m = await migrateProject(dir, { dryRun, allowSecretShaped: args.values['allow-secret-shaped'] === true });
      } catch (err) {
        // One file is its own error. Across many, the rest still run and what was done to each is still printed.
        if (!all) throw err;
        if (err instanceof BlipError && err.code === 'E_NO_PROJECT') {
          missing.push(dir);
          lines.push(`${blipPath(dir)}   (missing)`, '');
          continue;
        }
        const code = err instanceof BlipError ? err.code : 'E_INTERNAL';
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ dir, code, message });
        lines.push(`${blipPath(dir)}   NOT MIGRATED — ${code}: ${message}`, '');
        continue;
      }
      const file = { ...m, git: m.skipped ? '' : await gitState(dir) };
      files.push(file);
      lines.push(...render(m, file.git, dryRun), '');
    }

    const totals = {
      registered: registered.length,
      files: files.length,
      [dryRun ? 'wouldChange' : 'changed']: files.filter((f) => f.changed && !f.secretSkipped).length,
      alreadyV3: files.filter((f) => f.skipped === 'already-v3').length,
      unwritable: files.filter((f) => f.skipped === 'unwritable' || f.skipped === 'newer-schema').length,
      skippedForSecrets: files.filter((f) => f.secretSkipped).length,
      missing: missing.length,
      failed: failed.length,
    };
    lines.push(
      `${dryRun ? 'would change' : 'changed'}: ${totals[dryRun ? 'wouldChange' : 'changed']} · already v3: ${totals.alreadyV3} · cannot be migrated: ${totals.unwritable} · skipped for secrets: ${totals.skippedForSecrets}${missing.length ? ` · missing: ${missing.length}` : ''}${failed.length ? ` · failed: ${failed.length}` : ''}`,
      ...registryWarning(warning),
      `registered: ${registered.length} project${registered.length === 1 ? '' : 's'}`,
    );
    if (dryRun) lines.push('dry run — nothing was written');
    const held = failed.length > 0 || (!dryRun && totals.unwritable + totals.skippedForSecrets > 0);
    return { data: { files, totals, missing, failed, warning }, lines, exit: held ? 3 : 0 };
  },
};
