import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertBlipPath, assertInitDir, isUnderRoot } from './guard'

describe('isUnderRoot', () => {
  const root = resolve(tmpdir(), 'radar-root')

  it('accepts paths strictly under the root', () => {
    expect(isUnderRoot(root, join(root, 'proj', 'BLIP.md'))).toBe(true)
  })

  it('rejects the root itself, siblings, and `..` escapes', () => {
    expect(isUnderRoot(root, root)).toBe(false)
    expect(isUnderRoot(root, resolve(root, '..', 'elsewhere', 'BLIP.md'))).toBe(false)
    // A sibling whose name merely shares the root as a string prefix.
    expect(isUnderRoot(root, `${root}-evil${join('/', 'BLIP.md')}`)).toBe(false)
  })
})

describe('assertBlipPath', () => {
  const root = resolve(tmpdir(), 'radar-root')
  const roots = [root]

  it('returns the resolved path for a BLIP.md under a configured root', () => {
    const ok = join(root, 'alpha', 'BLIP.md')
    expect(assertBlipPath(ok, roots)).toBe(resolve(ok))
    // Traversal segments that still land under the root are fine once resolved.
    expect(assertBlipPath(join(root, 'a', '..', 'b', 'BLIP.md'), roots)).toBe(
      resolve(root, 'b', 'BLIP.md')
    )
  })

  it('rejects any basename other than exactly BLIP.md (the file-corruption primitive)', () => {
    expect(() => assertBlipPath(join(root, 'proj', 'notes.txt'), roots)).toThrow(/non-BLIP\.md/)
    expect(() => assertBlipPath(join(root, 'proj', 'BLIP.md.bak'), roots)).toThrow(/non-BLIP\.md/)
    expect(() => assertBlipPath(join(root, 'proj', 'blip.md'), roots)).toThrow(/non-BLIP\.md/)
  })

  it('rejects a BLIP.md outside every configured root (incl. `..` traversal out of one)', () => {
    expect(() => assertBlipPath(resolve(tmpdir(), 'free', 'BLIP.md'), roots)).toThrow(
      /outside every configured root/
    )
    expect(() => assertBlipPath(join(root, '..', 'escape', 'BLIP.md'), roots)).toThrow(
      /outside every configured root/
    )
  })

  it('rejects everything when no roots are configured', () => {
    expect(() => assertBlipPath(join(root, 'BLIP.md'), [])).toThrow(/outside every configured root/)
  })
})

describe('assertInitDir', () => {
  it('accepts an existing directory and returns its resolved path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'radar-guard-'))
    try {
      await expect(assertInitDir(dir)).resolves.toBe(resolve(dir))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a missing path and a plain file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'radar-guard-'))
    try {
      await expect(assertInitDir(join(dir, 'nope'))).rejects.toThrow(/not an existing directory/)
      const file = join(dir, 'file.txt')
      await writeFile(file, 'x')
      await expect(assertInitDir(file)).rejects.toThrow(/not an existing directory/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
