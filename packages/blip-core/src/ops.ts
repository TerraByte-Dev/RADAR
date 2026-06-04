import { Blip } from './blip.js';
import type { Horizon, Status } from './types.js';

export interface CreateBlipOptions {
  name: string;
  horizon?: Horizon;
  priority?: number;
  category?: string;
  status?: Status;
  next_action?: string;
}

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const SKELETON = [
  '',
  '# Tasks',
  '<!-- RADAR-owned checklist. Edited by the app and `radar-blip task ...`. -->',
  '',
  '# Session log',
  '<!-- Append-only. `radar-blip handoff` adds a dated entry; prior entries are never rewritten. -->',
  '',
  '# Notes',
  '<!-- Human-only. Tooling never rewrites this section. -->',
  '',
].join('\n');

/**
 * Build a fresh BLIP for a new project. Frontmatter is created through the engine
 * (so values are YAML-escaped safely) and the body has the three canonical sections.
 */
export function createBlip(opts: CreateBlipOptions): Blip {
  const blip = Blip.parse(SKELETON);
  blip.setField('name', opts.name);
  blip.setField('horizon', opts.horizon ?? 'someday');
  blip.setField('priority', opts.priority ?? 3);
  blip.setField('category', opts.category ?? '');
  blip.setField('status', opts.status ?? 'active');
  if (opts.next_action) blip.setField('next_action', opts.next_action);
  blip.setField('created', todayLocal());
  return blip;
}
