import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readPrefs, writePrefs } from '../lib/prefs'
import { createShell, initialTheme } from './shell'

function memory(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memory())
})

describe('prefs', () => {
  it('read back what was written, and only the known keys and values', () => {
    writePrefs({ theme: 'light' })
    writePrefs({ density: 'one-line' })
    expect(readPrefs()).toEqual({ theme: 'light', density: 'one-line' })
    localStorage.setItem('radar.v3', JSON.stringify({ theme: 'blue', density: 'one-line', projects: [1] }))
    expect(readPrefs()).toEqual({ density: 'one-line' })
  })

  it('fall back to nothing on a corrupt entry or a storage that throws', () => {
    localStorage.setItem('radar.v3', '{not json')
    expect(readPrefs()).toEqual({})
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readPrefs(broken)).toEqual({})
    expect(() => writePrefs({ theme: 'dark' }, broken)).not.toThrow()
  })
})

describe('the shell store', () => {
  it('starts on Pick up, comfortable, in the system theme until one is chosen', () => {
    const s = createShell().getState()
    expect(s.route).toEqual({ view: 'pickup' })
    expect(s.density).toBe('comfortable')
    expect(initialTheme({}, true)).toBe('light')
    expect(initialTheme({}, false)).toBe('dark')
    expect(initialTheme({ theme: 'dark' }, true)).toBe('dark')
  })

  it('T and D persist; the next start reads them', () => {
    const a = createShell()
    a.getState().setTheme('dark')
    a.getState().toggleTheme()
    a.getState().toggleDensity()
    expect(a.getState()).toMatchObject({ theme: 'light', density: 'one-line' })
    expect(createShell().getState()).toMatchObject({ theme: 'light', density: 'one-line' })
  })

  it('Esc closes the overlay, then clears the selection, then goes back; back holds at most 20', () => {
    const s = createShell()
    const { go, goBack } = s.getState()
    go({ view: 'scope' })
    go({ view: 'scope' })
    go({ view: 'log' })
    expect(s.getState().back).toEqual([{ view: 'pickup' }, { view: 'scope' }])
    s.setState({ overlay: 'keys', selectedId: 'abc' })
    goBack()
    expect(s.getState()).toMatchObject({ overlay: null, selectedId: 'abc', route: { view: 'log' } })
    goBack()
    expect(s.getState()).toMatchObject({ selectedId: null, route: { view: 'log' } })
    goBack()
    expect(s.getState().route).toEqual({ view: 'scope' })
    for (let i = 0; i < 30; i++) go(i % 2 ? { view: 'log' } : { view: 'settings' })
    expect(s.getState().back).toHaveLength(20)
  })

  it('Esc on the project page goes back to the list and keeps its selection', () => {
    const s = createShell()
    s.setState({ selectedId: 'abc' })
    s.getState().go({ view: 'project', id: 'abc' })
    s.getState().goBack()
    expect(s.getState()).toMatchObject({ selectedId: 'abc', route: { view: 'pickup' } })
  })

  it('a change of route closes the overlay, so one Esc goes back and the popover does not return with the view', () => {
    const s = createShell()
    s.setState({ overlay: 'pick' })
    s.getState().go({ view: 'pickup' })
    expect(s.getState().overlay).toBe('pick')
    s.getState().go({ view: 'project', id: 'abc' })
    expect(s.getState().overlay).toBeNull()
    s.getState().goBack()
    expect(s.getState()).toMatchObject({ overlay: null, route: { view: 'pickup' } })
  })

  it('starts from the lastOpenedAt kept from the last run', () => {
    expect(createShell({}).getState().lastOpenedAt).toBeNull()
    expect(createShell({ lastOpenedAt: 1234 }).getState().lastOpenedAt).toBe(1234)
  })

  it('a toast shows one at a time and goes after six seconds', () => {
    vi.useFakeTimers()
    try {
      const s = createShell()
      s.getState().say({ text: 'first' })
      vi.advanceTimersByTime(3_000)
      s.getState().say({ text: 'second' })
      vi.advanceTimersByTime(3_500)
      expect(s.getState().toast).toEqual({ text: 'second' })
      vi.advanceTimersByTime(2_600)
      expect(s.getState().toast).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
