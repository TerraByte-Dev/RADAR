/**
 * Curated category colors — calm, slightly desaturated hues that glow on the black
 * canvas without competing with the phosphor accent (`#00FF88`) or the reserved
 * overdue red (`#FF3030`). Ordered around the color wheel so neighboring hues stay
 * visually distinct. `projectRadar.categoryColor` hashes a category name into this
 * wheel (the curated category names get fixed picks).
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
