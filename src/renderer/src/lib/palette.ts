import type { Priority } from '@shared/types'

/** Shared priority → dot background class. One source of truth for every view. */
export const PRIORITY_DOT: Record<Priority, string> = {
  P1: 'bg-p1',
  P2: 'bg-p2',
  P3: 'bg-p3',
  P4: 'bg-p4',
  none: 'bg-faint'
}

/** Curated project colors — calm, slightly desaturated to fit the dark theme. */
export const PROJECT_COLORS = [
  '#6c8cff', // periwinkle
  '#5bc8a8', // teal
  '#e0a458', // amber
  '#e07a8b', // rose
  '#a78bfa', // violet
  '#7bb0e0', // sky
  '#9bd07a', // sage
  '#d68bd0' // orchid
] as const

export function randomProjectColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]
}
