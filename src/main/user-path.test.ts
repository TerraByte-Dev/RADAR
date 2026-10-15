import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp } from './testkit'
import { posixPath, psString, windowsPath } from './user-path'

// No test here reads or writes the real registry or PATH.
describe.runIf(process.platform === 'win32')('windows Path: the PowerShell read', () => {
  it('is lossless for a value outside the console codepage', async () => {
    const value = 'C:\\Users\\José\\bin;C:\\Tools\\Ünïcode;C:\\日本;%USERPROFILE%\\x'
    expect(await psString('$v = $env:RADAR_TEST_VALUE', { RADAR_TEST_VALUE: value })).toBe(value)
  })
})

describe('windowsPath', () => {
  it('keeps the value it replaces in <data>/path.radar-bak, byte for byte, and writes once', async () => {
    const before = 'C:\\Users\\José\\bin;%USERPROFILE%\\x;'
    const store = { value: before, writes: [] as string[] }
    const editor = windowsPath({ read: async () => store.value, write: async (v) => void store.writes.push((store.value = v)) })
    const data = tmp()
    const bin = join(data, 'bin')
    expect(await editor.plan(bin)).toBe(`put ${bin} first on your user Path (HKCU\\Environment)`)
    expect(await editor.apply(bin)).toBe(true)
    expect(store.value).toBe(`${bin};${before}`)
    expect(readFileSync(join(data, 'path.radar-bak'), 'utf8')).toBe(before)
    expect(await editor.plan(bin)).toBeNull()
    await editor.apply(bin)
    expect(store.writes).toHaveLength(1)
  })
})

describe('posixPath', () => {
  // A home without a drive letter, so the ':'-separated PATH also works on Windows.
  const setup = (): { home: string; local: string; link: string; bin: string; editor: ReturnType<typeof posixPath> } => {
    const home = tmp().replace(/^[A-Za-z]:/, '')
    const local = join(home, '.local', 'bin')
    mkdirSync(local, { recursive: true })
    const bin = join(tmp().replace(/^[A-Za-z]:/, ''), 'bin')
    return { home, local, link: join(local, 'radar-blip'), bin, editor: posixPath(home, `/usr/bin:${local}`) }
  }

  it('gives the line to add by hand when ~/.local/bin is not on PATH', async () => {
    const { home, bin } = setup()
    const editor = posixPath(home, '/usr/bin')
    expect(await editor.plan(bin)).toBe(`add this line to your shell profile: export PATH="${bin}:$PATH"`)
    expect(await editor.apply(bin)).toBe(false)
  })

  it('says it replaces a radar-blip already in ~/.local/bin, and keeps that file beside the new link', async () => {
    const { local, link, bin, editor } = setup()
    writeFileSync(link, 'old v2 install')
    expect(await editor.plan(bin)).toBe(`replace ${link} with a link to ${join(bin, 'radar-blip')} (the old one is kept as radar-blip.bak-<time>)`)
    try {
      expect(await editor.apply(bin)).toBe(true)
    } catch (err) {
      // Windows without Developer Mode cannot make a symlink; the existing file must still be there.
      if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err
      expect(readdirSync(local).some((f) => f === 'radar-blip' || f.startsWith('radar-blip.bak-'))).toBe(true)
      return
    }
    const kept = readdirSync(local).filter((f) => f.startsWith('radar-blip.bak-'))
    expect(kept).toHaveLength(1)
    expect(readFileSync(join(local, kept[0]), 'utf8')).toBe('old v2 install')
    expect(await editor.plan(bin)).toBeNull()
  })
})
