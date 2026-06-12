/**
 * Settings search filter. AND-over-tokens, case-insensitive substring match: every whitespace-split term
 * in `query` must appear somewhere in `haystack`. An empty query matches everything. Pure + unit-tested;
 * the one source of truth shared by the Settings rail, Sections, and SettingRows.
 */
export function matchText(haystack: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const h = haystack.toLowerCase()
  return terms.every((t) => h.includes(t))
}
