import { describe, expect, it } from 'vitest'
import { KEYMAP, binding, bindingFor, combo, type KeyId } from './keymap'

const ev = (key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) => ({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift })
const all = (): boolean => true

describe('the keymap', () => {
  it('has one row per id, and no combo twice within a scope', () => {
    expect(new Set(KEYMAP.map((b) => b.id)).size).toBe(KEYMAP.length)
    for (const scope of new Set(KEYMAP.map((b) => b.scope))) {
      const combos = KEYMAP.filter((b) => b.scope === scope).flatMap((b) => b.keys)
      expect(new Set(combos).size, scope).toBe(combos.length)
    }
  })

  it('a combo bound Anywhere is bound nowhere else', () => {
    const anywhere = new Set(KEYMAP.filter((b) => b.scope === 'Anywhere').flatMap((b) => b.keys))
    for (const b of KEYMAP.filter((b) => b.scope !== 'Anywhere')) for (const k of b.keys) expect(anywhere.has(k), `${b.id} ${k}`).toBe(false)
  })

  it('spells key events the way the table does', () => {
    expect(combo(ev('k', { ctrl: true }))).toBe('Ctrl+K')
    expect(combo(ev('k', { meta: true }))).toBe('Ctrl+K')
    expect(combo(ev(',', { ctrl: true }))).toBe('Ctrl+,')
    expect(combo(ev('t'))).toBe('T')
    expect(combo(ev('?'))).toBe('?')
    expect(combo(ev('?', { shift: true }))).toBe('?')
    expect(combo(ev('T', { shift: true }))).toBe('Shift+T')
    expect(combo(ev('Z', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+Z')
    expect(combo(ev(' '))).toBe('Space')
    expect(combo(ev('Escape'))).toBe('Escape')
    expect(combo(ev('ArrowDown'))).toBe('ArrowDown')
  })

  it.each([
    ['1', 'view.pickup'],
    ['2', 'view.scope'],
    ['3', 'view.log'],
    ['T', 'theme.toggle'],
    ['D', 'density.toggle'],
    ['Ctrl+,', 'view.settings'],
    ['Ctrl+K', 'palette.open'],
    ['Escape', 'nav.back'],
    ['J', 'list.move'],
    ['Enter', 'project.open']
  ] as [string, KeyId][])('%s is %s', (c, id) => {
    expect(bindingFor(c, all)?.id).toBe(id)
  })

  it('a key does nothing when no view on screen does its action, and the view decides between scopes', () => {
    expect(bindingFor('X', () => false)).toBeNull()
    expect(bindingFor('ArrowUp', (id) => id === 'scope.move')?.id).toBe('scope.move')
    expect(bindingFor('ArrowUp', (id) => id === 'list.move')?.id).toBe('list.move')
  })

  it('inside a text field only Esc and Ctrl chords reach the keymap', () => {
    expect(bindingFor('2', all, true)).toBeNull()
    expect(bindingFor('T', all, true)).toBeNull()
    expect(bindingFor('Escape', all, true)?.id).toBe('nav.back')
    expect(bindingFor('Ctrl+K', all, true)?.id).toBe('palette.open')
  })

  it('draws 1 2 3 as keys, not as tab numerals', () => {
    expect(['view.pickup', 'view.scope', 'view.log'].map((id) => binding(id as KeyId).caps)).toEqual(['1', '2', '3'])
  })
})
