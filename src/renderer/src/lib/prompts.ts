// The two prompts (renderer spec 9.3): plain text built in the renderer, for the clipboard.
import type { ProjectRecord } from '@shared/model'
import { folderName } from './derive'

/** Everything an agent needs to pick the project up: where it stands and the next step, verbatim. Nothing from a file that cannot be parsed. */
export function reEntryPrompt(r: ProjectRecord): string {
  const doc = r.state === 'needs-repair' ? null : r.doc
  const next = doc?.next
  return [
    `Pick up ${doc?.name ?? folderName(r.dir)} in ${r.dir}.`,
    ...(doc?.now ? [`Where it stands: ${doc.now}`] : []),
    ...(next ? [`Next step: ${next.title}`, ...next.detail] : []),
    'Run `radar-blip brief` first for the full queue and recent log. When you stop, run /blip.'
  ].join('\n')
}

export const catchUpPrompt = (r: ProjectRecord): string =>
  `In ${r.dir}, the BLIP.md log is behind the work. Run \`radar-blip brief\`, read what changed since the last entry, then run /blip to log it. Do not change any code.`
