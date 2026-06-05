import { execFile } from 'node:child_process'

/**
 * Minimal git history read used to **seed real signal into a freshly adopted blip** — so a
 * never-touched repo lands on the radar with honest recency + a first timeline entry instead of
 * a blank "someday" dot. We deliberately do NOT infer `category` from the parent folder or git
 * remote org: for a portfolio that lives under one parent / one GitHub org those collapse to a
 * single value and would fake the radar's color + angle axes. Recency is honest; category is the
 * agent's call on its first `/blip`.
 */
export interface GitSeed {
  /** Committer date of the latest commit, strict ISO (drives true recency / neglected). */
  lastCommitISO: string
  /** `YYYY-MM-DD` prefix of the commit date (dates the seeded session-log entry). */
  lastCommitDate: string
  shortSha: string
  author: string
  subject: string
}

/** Injectable git runner (real impl shells out; tests pass a fake). Resolves stdout. */
export type RunGit = (dir: string, args: string[]) => Promise<string>

// Record-separated so a subject containing spaces/quotes survives intact.
const FORMAT = '%cI%n%h%n%an%n%s'

const defaultRunGit: RunGit = (dir, args) =>
  new Promise((resolve, reject) => {
    execFile('git', ['-C', dir, ...args], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })

/** Parse the `git log -1 --format=…` stdout into a GitSeed, or null if it isn't usable. */
export function parseGitSeed(stdout: string): GitSeed | null {
  const [iso, sha, author, ...rest] = stdout.split('\n')
  if (!iso || !sha) return null
  const date = iso.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const subject = rest.join('\n').trim()
  return {
    lastCommitISO: iso.trim(),
    lastCommitDate: date,
    shortSha: sha.trim(),
    author: (author ?? '').trim() || 'unknown',
    subject: subject || '(no commit message)'
  }
}

/**
 * Read the latest commit of the git repo at `dir`. Returns null — never throws — for a
 * non-repo, a repo with no commits, or when `git` isn't on PATH, so adoption always succeeds.
 */
export async function readGitSeed(dir: string, runGit: RunGit = defaultRunGit): Promise<GitSeed | null> {
  try {
    return parseGitSeed(await runGit(dir, ['log', '-1', `--format=${FORMAT}`]))
  } catch {
    return null
  }
}
