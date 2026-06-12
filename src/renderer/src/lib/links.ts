/**
 * `links:` normalization for the detail panel. The schema (docs/BLIP-SCHEMA.md) allows
 * a plain URL string OR a `{label: url}` map per entry; agent/hand-written files may
 * also use an explicit `{label, url}` object. Anything else is skipped, never rendered.
 */

export interface LinkEntry {
  label: string
  url: string
}

/** One raw `links:` entry → {label, url}, or null when unrenderable. */
export function normalizeLink(raw: unknown): LinkEntry | null {
  if (typeof raw === 'string') {
    const url = raw.trim()
    return url ? { label: url, url } : null
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    // Explicit {label, url} shape.
    if (typeof o.label === 'string' && typeof o.url === 'string' && o.url.trim()) {
      return { label: o.label.trim() || o.url.trim(), url: o.url.trim() }
    }
    // Single-key {label: url} map — the schema's object form.
    const entries = Object.entries(o)
    if (entries.length === 1 && typeof entries[0]![1] === 'string') {
      const [label, url] = entries[0]! as [string, string]
      return url.trim() ? { label: label.trim() || url.trim(), url: url.trim() } : null
    }
  }
  return null
}

/** Every renderable entry of a raw `links:` list (non-arrays → empty). */
export function normalizeLinks(raw: unknown): LinkEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeLink).filter((l): l is LinkEntry => l !== null)
}

/**
 * Clickability allowlist — links come from agent/repo-written files, so only http(s)
 * and mailto open externally (main re-validates); anything else renders inert.
 */
export function isClickableLink(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
