import { userInfo } from 'node:os';

/**
 * The default session-log author when no explicit `--author` is given: the
 * current OS user. Falls back to `'unknown'` if the platform can't report a
 * username (e.g. some CI sandboxes). An explicit author always wins over this.
 */
export function detectAuthor(): string {
  try {
    const name = userInfo().username?.trim();
    return name || 'unknown';
  } catch {
    return 'unknown';
  }
}
