import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { makeIgnored } from './watch'

describe('makeIgnored (watcher skip rules mirror the scanner)', () => {
  const root = resolve(tmpdir(), 'radar-watch-root')
  const ignored = makeIgnored([root])

  it('ignores the scanner skip list and dot-dirs anywhere below a root', () => {
    expect(ignored(join(root, 'node_modules'))).toBe(true)
    expect(ignored(join(root, 'app', 'node_modules', 'pkg', 'BLIP.md'))).toBe(true)
    expect(ignored(join(root, 'proj', '.git', 'BLIP.md'))).toBe(true)
    expect(ignored(join(root, 'proj', 'coverage'))).toBe(true)
    expect(ignored(join(root, '.hidden', 'BLIP.md'))).toBe(true)
  })

  it('keeps plain project paths — BLIP.md itself never matches a skip rule', () => {
    expect(ignored(join(root, 'alpha', 'BLIP.md'))).toBe(false)
    expect(ignored(join(root, 'alpha'))).toBe(false)
    expect(ignored(root)).toBe(false) // the root itself is never ignored
  })

  it('judges only the path below the root — a root living in a dotted folder still works', () => {
    const dotted = resolve(tmpdir(), '.projects', 'ws')
    const ig = makeIgnored([dotted])
    expect(ig(join(dotted, 'alpha', 'BLIP.md'))).toBe(false)
    expect(ig(join(dotted, '.git', 'x'))).toBe(true)
  })

  it('lets a nested root rescue a path its outer root would skip (scanner parity)', () => {
    const outer = resolve(tmpdir(), 'radar-ws')
    const nested = join(outer, '.dotted', 'proj')
    const ig = makeIgnored([outer, nested])
    expect(ig(join(nested, 'BLIP.md'))).toBe(false) // nested root accepts it
    expect(ig(join(outer, '.dotted', 'other', 'BLIP.md'))).toBe(true) // only the outer root covers this
  })

  it('does not ignore paths outside every root', () => {
    expect(ignored(resolve(tmpdir(), 'elsewhere', 'node_modules'))).toBe(false)
  })
})
