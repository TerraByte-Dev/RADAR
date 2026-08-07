import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * Boundary parity needs real directories on disk — `classify()` decides by looking for marker
 * files, and so does the watcher. Without this the watcher walked into every blip it had already
 * found, which is what made a single BLIP.md write cost a readdirp storm.
 */
describe('makeIgnored (project/ghost boundaries mirror classify)', () => {
  const root = mkdtempSync(join(tmpdir(), 'radar-boundary-'))
  const mk = (...segs: string[]): string => {
    const dir = join(root, ...segs)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  const file = (dir: string, name: string): void => writeFileSync(join(dir, name), '')

  const project = mk('alpha')
  file(project, 'BLIP.md')
  mk('alpha', 'src', 'renderer')

  const ghost = mk('beta')
  file(ghost, 'CLAUDE.md')
  mk('beta', 'lib')

  const plain = mk('gamma')
  mk('gamma', 'delta')

  const ignored = makeIgnored([root])
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it("watches a project directory and its own BLIP.md", () => {
    expect(ignored(project)).toBe(false)
    expect(ignored(join(project, 'BLIP.md'))).toBe(false)
  })

  it('does not descend into a project — its subfolders belong to that blip', () => {
    expect(ignored(join(project, 'src'))).toBe(true)
    expect(ignored(join(project, 'src', 'renderer'))).toBe(true)
    expect(ignored(join(project, 'src', 'BLIP.md'))).toBe(true)
  })

  it('treats a ghost (marker file, no BLIP.md) as a boundary too, but still watches its BLIP.md', () => {
    expect(ignored(ghost)).toBe(false)
    expect(ignored(join(ghost, 'BLIP.md'))).toBe(false) // where Adopt writes it
    expect(ignored(join(ghost, 'lib'))).toBe(true)
  })

  it('still descends through plain folders that are neither project nor ghost', () => {
    expect(ignored(plain)).toBe(false)
    expect(ignored(join(plain, 'delta'))).toBe(false)
    expect(ignored(join(plain, 'delta', 'BLIP.md'))).toBe(false)
  })

  // Most of a real config's roots are a single project folder, not a container of them.
  it('prunes a root that is itself a project, while still watching that root’s own BLIP.md', () => {
    const solo = mk('solo')
    file(solo, 'BLIP.md')
    mk('solo', 'src', 'components')
    const ig = makeIgnored([solo])
    expect(ig(join(solo, 'BLIP.md'))).toBe(false)
    expect(ig(join(solo, 'src'))).toBe(true)
    expect(ig(join(solo, 'src', 'components'))).toBe(true)
  })
})
