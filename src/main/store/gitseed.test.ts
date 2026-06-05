import { describe, expect, it } from 'vitest'
import { parseGitSeed, readGitSeed } from './gitseed'

describe('parseGitSeed', () => {
  it('parses a well-formed log line into recency + subject', () => {
    const out = '2026-05-30T10:00:00-06:00\nabc1234\nTate\nfeat(radar): seed adopt from git\n'
    expect(parseGitSeed(out)).toEqual({
      lastCommitISO: '2026-05-30T10:00:00-06:00',
      lastCommitDate: '2026-05-30',
      shortSha: 'abc1234',
      author: 'Tate',
      subject: 'feat(radar): seed adopt from git'
    })
  })

  it('returns null for empty / malformed stdout (no commits, not a date)', () => {
    expect(parseGitSeed('')).toBeNull()
    expect(parseGitSeed('not-a-date\nabc1234\nTate\nsubject')).toBeNull()
  })

  it('falls back gracefully when author / subject are missing', () => {
    const seed = parseGitSeed('2026-01-02T00:00:00Z\ndeadbee\n\n')!
    expect(seed.author).toBe('unknown')
    expect(seed.subject).toBe('(no commit message)')
  })
})

describe('readGitSeed', () => {
  it('returns null instead of throwing when git fails (non-repo / no git on PATH)', async () => {
    const boom = async (): Promise<string> => {
      throw new Error('not a git repository')
    }
    await expect(readGitSeed('/anywhere', boom)).resolves.toBeNull()
  })

  it('resolves the latest commit through an injected runner', async () => {
    const run = async (): Promise<string> => '2026-04-01T08:30:00Z\nfeedface\nAda\nchore: bump deps\n'
    const seed = await readGitSeed('/repo', run)
    expect(seed?.shortSha).toBe('feedface')
    expect(seed?.lastCommitDate).toBe('2026-04-01')
  })
})
