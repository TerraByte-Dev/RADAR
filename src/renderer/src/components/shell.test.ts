import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusBar } from './StatusBar'
import { TopBar } from './TopBar'
import { ToastRegions } from './Toast'
import type { Toast } from '../store/shell'
import { Button, Segmented } from './atoms'
import { register } from '../lib/actions'
import { KEYMAP, type KeyId } from '../lib/keymap'

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const noop = (): void => {}

let offs: (() => void)[] = []
const live = (...ids: KeyId[]): void => void offs.push(register(Object.fromEntries(ids.map((id) => [id, noop]))))
afterEach(() => {
  offs.forEach((off) => off())
  offs = []
})

describe('TopBar', () => {
  it('has three tabs and not one numeral in the tab bar', () => {
    const html = renderToStaticMarkup(createElement(TopBar))
    const tabs = /<nav class="tabs"[^>]*>(.*?)<\/nav>/.exec(html)?.[1] ?? ''
    expect(text(tabs)).toBe('Pick up Scope Log')
    expect(tabs).not.toMatch(/\d/)
    expect(html).toContain('aria-current="page"')
  })
})

describe('StatusBar', () => {
  it('names the project Enter opens, and keeps five hints under 1180 on Pick up', () => {
    live(...KEYMAP.map((b) => b.id))
    const html = renderToStaticMarkup(createElement(StatusBar, { view: 'pickup', target: 'Tidewatch', status: 'activity read 14:32' }))
    expect(text(html)).toBe('J K move ↵ open Tidewatch P pick one for me C copy re-entry prompt D density Ctrl K commands activity read 14:32')
    expect(html.match(/class="opt"/g)).toHaveLength(1)
  })

  it('leaves out the hints that have no project to act on', () => {
    live(...KEYMAP.map((b) => b.id))
    expect(text(renderToStaticMarkup(createElement(StatusBar, { view: 'pickup', target: null })))).toBe('P pick one for me D density Ctrl K commands')
    expect(text(renderToStaticMarkup(createElement(StatusBar, { view: 'scope', target: null })))).toBe('Esc back')
  })

  it('draws a hint only while something on screen does its action (the R1 shell: D, T, 1 2 3, Esc)', () => {
    live('view.pickup', 'view.scope', 'view.log', 'view.settings', 'theme.toggle', 'density.toggle', 'nav.back')
    const bar = (view: 'pickup' | 'log' | 'settings'): string => text(renderToStaticMarkup(createElement(StatusBar, { view, target: null })))
    expect(bar('pickup')).toBe('D density')
    expect(bar('log')).toBe('Esc back')
    expect(bar('settings')).toBe('Esc back')
  })
})

describe('Button', () => {
  const html = (props: Parameters<typeof Button>[0]): string => renderToStaticMarkup(createElement(Button, props))

  it('is a type=button; only the primary one is filled', () => {
    expect(html({ variant: 'primary', children: 'Open' })).toMatch(/^<button type="button" class="btn pri[ "]/)
    expect(html({ children: 'Cancel' })).toMatch(/^<button type="button" class="btn(?![^"]*\bpri\b)/)
  })

  it('draws a keycap only when it has one, and Enter as ↵', () => {
    expect(html({ variant: 'primary', caps: 'Enter', children: 'Open' })).toContain('<kbd>↵</kbd>')
    expect(html({ children: 'Cancel' })).not.toContain('<kbd>')
  })
})

describe('Segmented', () => {
  const seg = (value: 'a' | 'b'): string =>
    renderToStaticMarkup(createElement(Segmented<'a' | 'b'>, { label: 'Density', value, onChange: noop, options: [{ value: 'a', label: 'Comfortable' }, { value: 'b', label: 'One line', caps: 'D' }] }))

  it('is one tab stop: the checked radio, the others reached with the arrows', () => {
    const radios = [...seg('b').matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0])
    expect(radios.map((r) => /tabindex="(-?\d)"/i.exec(r)?.[1])).toEqual(['-1', '0'])
  })

  it('names the option without its keycap, and gives the key as aria-keyshortcuts', () => {
    const html = seg('a')
    expect(html).toContain('aria-keyshortcuts="D"')
    expect(html).toMatch(/<span aria-hidden="true" class="flex"><kbd>D<\/kbd><\/span>/)
  })
})

describe('Toast (section 11)', () => {
  const html = (toast: Toast): string => renderToStaticMarkup(createElement(ToastRegions, { toast }))

  it('a status toast is in the status region, an error in its own alert region beside it, never inside it', () => {
    const ok = html({ text: 'Re-entry prompt copied.' })
    expect(ok).toMatch(/<div role="status"><div class="toast"><span>Re-entry prompt copied\.<\/span><\/div><\/div><div role="alert"><\/div>/)
    const err = html({ lead: 'Could not write.', text: 'The file changed on disk.' })
    expect(err).toMatch(/<div role="status"><\/div><div role="alert"><div class="toast">/)
  })
})
