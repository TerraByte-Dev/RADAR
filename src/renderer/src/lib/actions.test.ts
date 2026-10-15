import { beforeAll, describe, expect, it, vi } from 'vitest'
import { has, onKeyDown, register, subscribe } from './actions'

beforeAll(() => vi.stubGlobal('HTMLElement', class {}))

const press = (key: string, o: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, target: null, preventDefault() {}, ...o }) as unknown as KeyboardEvent

describe('the key dispatcher', () => {
  it('a held toggle acts once: auto-repeat is ignored, except for moving through a list or the scope', () => {
    const theme = vi.fn()
    const move = vi.fn()
    const off = register({ 'theme.toggle': theme, 'list.move': move })
    onKeyDown(press('t'))
    onKeyDown(press('t', { repeat: true }))
    onKeyDown(press('t', { repeat: true }))
    expect(theme).toHaveBeenCalledTimes(1)
    onKeyDown(press('j'))
    onKeyDown(press('j', { repeat: true }))
    expect(move).toHaveBeenCalledTimes(2)
    off()
  })

  it('Shift with a letter is not the letter: Shift+T does not toggle the theme', () => {
    const theme = vi.fn()
    const off = register({ 'theme.toggle': theme })
    onKeyDown(press('T', { shiftKey: true }))
    expect(theme).not.toHaveBeenCalled()
    off()
  })

  it('Enter and Space on a focused button act on the button, not the keymap', () => {
    const open = vi.fn()
    const off = register({ 'project.open': open })
    const button = Object.assign(new HTMLElement(), { tagName: 'BUTTON', isContentEditable: false, matches: () => true })
    const div = Object.assign(new HTMLElement(), { tagName: 'DIV', isContentEditable: false, matches: () => false })
    let prevented = false
    onKeyDown(press('Enter', { target: button, preventDefault: () => (prevented = true) }))
    expect(open).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
    onKeyDown(press('Enter', { target: div }))
    expect(open).toHaveBeenCalledTimes(1)
    off()
  })

  it('a key a control already handled does not reach the keymap', () => {
    const theme = vi.fn()
    const off = register({ 'theme.toggle': theme })
    onKeyDown(press('t', { defaultPrevented: true }))
    expect(theme).not.toHaveBeenCalled()
    off()
  })

  it('has() says whether anything on screen does an action, and subscribers hear when that changes', () => {
    const heard = vi.fn()
    const unsub = subscribe(heard)
    expect(has('palette.open')).toBe(false)
    const off = register({ 'palette.open': () => {} })
    expect(has('palette.open')).toBe(true)
    off()
    expect(has('palette.open')).toBe(false)
    expect(heard).toHaveBeenCalledTimes(2)
    unsub()
  })
})
