import type { Priority } from '@shared/types'

/** Shared priority → dot background class. One source of truth for every view. */
export const PRIORITY_DOT: Record<Priority, string> = {
  P1: 'bg-p1',
  P2: 'bg-p2',
  P3: 'bg-p3',
  P4: 'bg-p4',
  none: 'bg-faint'
}

/**
 * Curated project colors — calm, slightly desaturated hues that glow on the black
 * canvas without competing with the phosphor accent (`#00FF88`) or the reserved
 * overdue red (`#FF3030`). Ordered around the color wheel so adjacent swatches in
 * the picker — and sequential auto-assignments — stay visually distinct.
 */
export const PROJECT_COLORS = [
  '#e06c6c', // red
  '#e8895c', // coral
  '#e0a458', // amber
  '#d9c24f', // gold
  '#aecb5f', // lime
  '#9bd07a', // sage
  '#5fc88a', // green
  '#5bc8a8', // teal
  '#5fccc4', // aqua
  '#7bb0e0', // sky
  '#5b9ae0', // blue
  '#6c8cff', // periwinkle
  '#a78bfa', // violet
  '#c08be0', // purple
  '#d68bd0', // orchid
  '#e07a8b' // rose
] as const

/**
 * Pick the color for a new project: the palette entry used by the fewest existing
 * projects (ties broken by wheel order). New projects therefore stay distinct until
 * the whole palette is in play, then reuse the least-crowded hue — instead of the
 * old random pick, which collided long before the colors ran out. Colors outside
 * the palette (e.g. a hand-set hex) don't count against any swatch.
 */
export function nextProjectColor(usedColors: Iterable<string>): string {
  const counts = new Map<string, number>(PROJECT_COLORS.map((c) => [c, 0]))
  for (const c of usedColors) {
    const n = counts.get(c)
    if (n !== undefined) counts.set(c, n + 1)
  }
  let best: string = PROJECT_COLORS[0]
  let bestN = Infinity
  for (const c of PROJECT_COLORS) {
    const n = counts.get(c) ?? 0
    if (n < bestN) {
      bestN = n
      best = c
    }
  }
  return best
}
