import { buildBoard, type ProjectRecord } from '../../board.js';
import { listProjects } from '../../registry.js';
import { registryWarning, type Command } from '../shared.js';

const NAME_WIDTH = 24;
const NOW_WIDTH = 60;

const clip = (s: string, n: number): string => (Array.from(s).length <= n ? s : `${Array.from(s).slice(0, n - 1).join('')}…`);
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - Array.from(s).length));

/** "5m ago", "3h ago", "4d ago", "6w ago", "5mo ago", "2y ago". */
export function age(iso: string | null, now: Date): string {
  if (iso === null) return '—';
  const min = Math.max(0, (now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'just now';
  const [n, unit] =
    min < 60 ? [min, 'm'] : min < 60 * 24 ? [min / 60, 'h'] : min < 60 * 24 * 14 ? [min / 1440, 'd'] : min < 60 * 24 * 60 ? [min / 10080, 'w'] : min < 60 * 24 * 365 ? [min / 43200, 'mo'] : [min / 525600, 'y'];
  return `${Math.floor(n)}${unit} ago`;
}

function drift(r: ProjectRecord): string {
  const a = r.activity;
  if (!a?.unlogged) return '';
  if (a.drift.commits) return `+${a.drift.commits} commit${a.drift.commits === 1 ? '' : 's'}`;
  if (a.drift.files) return `+${a.drift.files} file${a.drift.files === 1 ? '' : 's'}`;
  return '+uncommitted';
}

function nowColumn(r: ProjectRecord): string {
  if (r.state === 'missing') return '(BLIP.md is missing)';
  if (r.state === 'needs-migrate') return '(v2 file: radar-blip migrate)';
  if (r.state === 'needs-repair') return '(cannot be written: radar-blip lint)';
  const doc = r.doc!;
  return doc.now ?? (doc.next ? `next: ${doc.next.title}` : '—');
}

/** Live sessions first, then focused projects, then the most recently touched. */
function compare(a: ProjectRecord, b: ProjectRecord): number {
  const t = (r: ProjectRecord): number => (r.activity?.lastTouchedAt ? Date.parse(r.activity.lastTouchedAt) : -Infinity);
  return Number(b.agent.live) - Number(a.agent.live) || Number(b.doc?.focus === true) - Number(a.doc?.focus === true) || t(b) - t(a);
}

export const status: Command = {
  usage: '[--all] [--json]',
  summary: 'the board: one row per tracked project with its Now line, last activity and unlogged work (--all adds hidden, archived and missing ones)',
  options: { json: { type: 'boolean' }, all: { type: 'boolean' } },
  async run(args) {
    const all = args.values.all === true;
    const now = new Date();
    const { projects, warning } = await listProjects();
    const records = (await buildBoard(projects, { now }))
      .filter((r) => all || (!r.hidden && r.state !== 'missing' && r.doc?.status !== 'archived'))
      .sort(compare);
    const lines = registryWarning(warning);
    if (!records.length) lines.push(projects.length ? 'Nothing on the board: radar-blip status --all lists hidden and archived projects.' : 'No projects are tracked yet: radar-blip track --find DIR');
    for (const r of records) {
      const name = clip(r.doc?.name ?? r.dir, NAME_WIDTH);
      const cols = [
        `${r.agent.live ? '●' : ' '}${r.doc?.focus ? '★' : ' '}`,
        pad(name, NAME_WIDTH),
        pad(clip(nowColumn(r), NOW_WIDTH), NOW_WIDTH),
        pad(age(r.activity?.lastTouchedAt ?? null, now), 9),
        pad(drift(r), 13),
        r.doc?.due ? `due ${r.doc.due}` : '',
      ];
      lines.push(cols.join(' ').trimEnd());
    }
    return { data: { projects: records, warning }, lines };
  },
};
