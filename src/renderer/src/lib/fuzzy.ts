// The palette's match (renderer spec 9.2): how well `query` finds `text`, from 0 (not at all) to 1.
// A run of the query's characters in order, ignoring case; whole substrings beat scattered letters,
// and a match at the start of the text or of a word beats one inside a word.
export function fuzzy(text: string, query: string): number {
  const t = text.toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const at = t.indexOf(q)
  if (at === 0) return 1
  if (at > 0) return /[\s\-_./:]/.test(t[at - 1] as string) ? 0.9 : 0.8
  let last = -1
  let gaps = 0
  for (const c of q) {
    const j = t.indexOf(c, last + 1)
    if (j < 0) return 0
    if (last >= 0 && j > last + 1) gaps++
    last = j
  }
  return 0.6 / (1 + gaps)
}
