import { describe, expect, it } from 'vitest'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_WINDOW, readWindowState, settle, writeWindowState } from './window-state'
import { tmp } from './testkit'

const screen = [{ x: 0, y: 0, width: 1920, height: 1040 }]

describe('window state (spec 8.7)', () => {
  it('round-trips bounds and the maximised flag, through a temp file that does not stay behind', () => {
    const dir = tmp()
    const file = join(dir, 'window.json')
    writeWindowState(file, { x: 100, y: 50, width: 1300, height: 900 }, true)
    expect(readWindowState(file, screen)).toEqual({ x: 100, y: 50, width: 1300, height: 900, maximized: true })
    expect(readdirSync(dir)).toEqual(['window.json'])
  })

  it('missing, corrupt or ill-typed files give the defaults', () => {
    const file = join(tmp(), 'window.json')
    expect(readWindowState(file, screen)).toEqual(DEFAULT_WINDOW)
    for (const bad of ['{not json', 'null', '[]', '{"width":"wide","height":800}', '{"width":1.5,"height":800}']) {
      writeFileSync(file, bad)
      expect(readWindowState(file, screen)).toEqual(DEFAULT_WINDOW)
    }
  })

  it('a one-pixel difference is display rounding and keeps the previous bounds; anything more is taken', () => {
    const prev = { x: 120, y: 90, width: 1010, height: 700 }
    expect(settle(prev, { x: 120, y: 90, width: 1011, height: 701 })).toBe(prev)
    const moved = { x: 160, y: 90, width: 1011, height: 701 }
    expect(settle(prev, moved)).toBe(moved)
  })

  it('a position on no display is dropped, and a size below the minimum is raised', () => {
    const file = join(tmp(), 'window.json')
    writeWindowState(file, { x: 5000, y: 5000, width: 300, height: 200 }, false)
    expect(readWindowState(file, screen)).toEqual({ width: 820, height: 560, maximized: false })
  })
})
