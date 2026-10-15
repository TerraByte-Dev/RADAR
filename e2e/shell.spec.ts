// R1 (renderer spec 13): the shell on the placeholder data set. `1 2 3 T D` work on the empty
// views, the tab bar carries no numeral, both faces come from the app bundle, theme and density
// persist, and the run never leaves its throwaway world.
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, launch, type App } from './harness'

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true, size: [1280, 800] })
})
test.afterAll(async () => {
  await a?.close()
})

const current = (a: App) => a.page.locator('.tabs [aria-current="page"]')
const h1 = (a: App) => a.page.locator('main h1')

test('the run uses its own profile and data folder', async () => {
  const userData = await a.app.evaluate(({ app }) => app.getPath('userData'))
  expect(userData.toLowerCase()).toBe(a.world.profile.toLowerCase())
  const list = await a.page.evaluate(() => window.radar.invoke('projects.list'))
  expect(list.ok && list.data.projects.length).toBeGreaterThan(20)
  for (const p of list.ok ? list.data.projects : []) expect(p.dir.toLowerCase().startsWith(a.world.projects.toLowerCase())).toBe(true)
})

test('the tab bar has three tabs and no numeral', async () => {
  await expect(a.page.locator('.tabs button')).toHaveText(['Pick up', 'Scope', 'Log'])
  expect(await a.page.locator('.tabs').innerText()).not.toMatch(/\d/)
})

test('1 2 3 move between the views, Ctrl , opens Settings and Esc goes back', async () => {
  await expect(current(a)).toHaveText('Pick up')
  await a.page.keyboard.press('2')
  await expect(current(a)).toHaveText('Scope')
  await expect(h1(a)).toHaveText('Scope')
  await a.page.keyboard.press('3')
  await expect(current(a)).toHaveText('Log')
  await expect(h1(a)).toHaveText('Log')
  await a.page.keyboard.press('Control+,')
  await expect(h1(a)).toHaveText('Settings')
  await expect(current(a)).toHaveCount(0)
  await a.page.keyboard.press('Escape')
  await expect(h1(a)).toHaveText('Log')
  await a.page.keyboard.press('1')
  await expect(current(a)).toHaveText('Pick up')
  await expect(h1(a)).toHaveText('Pick up')
})

test('T and D toggle the theme and the density, and both survive a reload', async () => {
  const theme = () => a.page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
  const oneLine = a.page.getByRole('radio', { name: /One line/ })
  const before = await theme()
  await a.page.keyboard.press('t')
  expect(await theme()).not.toBe(before)
  await expect(oneLine).toHaveAttribute('aria-checked', 'false')
  await a.page.keyboard.press('d')
  await expect(oneLine).toHaveAttribute('aria-checked', 'true')
  const after = await theme()
  await a.page.reload()
  await a.page.waitForSelector('main h1')
  expect(await theme()).toBe(after)
  await expect(a.page.getByRole('radio', { name: /One line/ })).toHaveAttribute('aria-checked', 'true')
  // and back, for the tests after this one
  await a.page.keyboard.press('t')
  await a.page.keyboard.press('d')
  expect(await theme()).toBe(before)
})

test('the keys do nothing while a text field has focus', async () => {
  await a.page.evaluate(() => {
    const i = document.createElement('input')
    i.id = 'probe'
    document.body.append(i)
    i.focus()
  })
  await a.page.keyboard.press('2')
  await expect(current(a)).toHaveText('Pick up')
  await a.page.evaluate(() => document.getElementById('probe')?.remove())
})

test('both faces load, and only from the app bundle', async () => {
  const fonts = await a.page.evaluate(async () => {
    await document.fonts.ready
    return {
      vt: (await document.fonts.load('29px VT323')).length,
      plex: await Promise.all(['400', '500', '600'].map(async (w) => (await document.fonts.load(`${w} 13px "IBM Plex Mono"`, 'a→')).length)),
      // every @font-face source, resolved against its stylesheet
      urls: [...document.styleSheets].flatMap((sheet) =>
        [...sheet.cssRules]
          .filter((r): r is CSSFontFaceRule => r instanceof CSSFontFaceRule)
          .flatMap((r) => [...r.style.getPropertyValue('src').matchAll(/url\("?([^")]+)"?\)/g)].map((m) => new URL(m[1], sheet.href ?? location.href).href))
      ),
      wordmark: getComputedStyle(document.querySelector('.brand') as Element).fontFamily
    }
  })
  expect(fonts.vt).toBe(1)
  // each weight: the latin face and the arrows face
  expect(fonts.plex).toEqual([2, 2, 2])
  expect(fonts.wordmark).toMatch(/^"?VT323/)
  // seven faces: files in out/renderer/assets, or (the small arrows cuts) inlined into the bundle
  expect(fonts.urls).toHaveLength(7)
  for (const u of fonts.urls) expect(u).toMatch(/^(file:\/\/\/.*\/out\/renderer\/assets\/.+\.woff2|data:font\/woff2;base64,)/)
})

test('T recolours the native window controls with the theme tokens --bg and --fg-3', async () => {
  const tokens = readFileSync(join(ROOT, 'src/renderer/src/styles/tokens.css'), 'utf8')
  const [darkCss, lightCss] = tokens.split(/:root\[data-theme='light'\]/)
  const pair = (css: string) => ({ color: /--bg:\s*(#\w+)/.exec(css)?.[1], symbolColor: /--fg-3:\s*(#\w+)/.exec(css)?.[1] })
  // record what reaches the window, without changing what it does
  await a.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const calls: unknown[] = []
    ;(globalThis as { overlay?: unknown[] }).overlay = calls
    const set = win.setTitleBarOverlay.bind(win)
    win.setTitleBarOverlay = (o) => {
      calls.push(o)
      set(o)
    }
  })
  const last = () => a.app.evaluate(() => (globalThis as { overlay?: unknown[] }).overlay?.at(-1))
  const theme = () => a.page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
  for (let i = 0; i < 2; i++) {
    await a.page.keyboard.press('t')
    const want = pair((await theme()) === 'light' ? lightCss : darkCss)
    expect(want.color).toMatch(/^#/)
    await expect.poll(last).toEqual(want)
  }
})

test('holding D or T acts once, not once per auto-repeat', async () => {
  const oneLine = a.page.getByRole('radio', { name: 'One line', exact: true })
  const theme = () => a.page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
  const before = await theme()
  for (const k of ['d', 't']) {
    // a second keyboard.down before the up is an auto-repeat (repeat: true)
    for (let i = 0; i < 4; i++) await a.page.keyboard.down(k)
    await a.page.keyboard.up(k)
  }
  await expect(oneLine).toHaveAttribute('aria-checked', 'true')
  expect(await theme()).not.toBe(before)
  await a.page.keyboard.press('d')
  await a.page.keyboard.press('t')
  await expect(oneLine).toHaveAttribute('aria-checked', 'false')
})

test('the density control is one tab stop named without its keycap, and the arrows move and select', async () => {
  const comfy = a.page.getByRole('radio', { name: 'Comfortable', exact: true })
  const oneLine = a.page.getByRole('radio', { name: 'One line', exact: true })
  await expect(oneLine).toHaveAttribute('aria-keyshortcuts', 'D')
  await expect(comfy).toHaveAttribute('aria-checked', 'true')
  await expect(oneLine).toHaveAttribute('tabindex', '-1')
  await comfy.focus()
  await a.page.keyboard.press('ArrowRight')
  await expect(oneLine).toHaveAttribute('aria-checked', 'true')
  await expect(oneLine).toBeFocused()
  await expect(comfy).toHaveAttribute('tabindex', '-1')
  await a.page.keyboard.press('ArrowLeft')
  await expect(comfy).toHaveAttribute('aria-checked', 'true')
  await expect(comfy).toBeFocused()
  await comfy.blur()
})

test('the status bar shows only keys that act: Ctrl K and / once the palette exists (R7)', async () => {
  const foot = a.page.locator('.foot')
  await expect(foot).toHaveText(/D\s*density/)
  await expect(foot).toContainText('commands')
  await a.page.keyboard.press('3')
  await expect(foot).toContainText('filter')
  await a.page.keyboard.press('1')
})

test('the view headers: one-line density tightens Pick up, and under 1180 every header takes the narrow padding', async () => {
  const pad = (sel = '.head') => a.page.locator(sel).evaluate((e) => getComputedStyle(e).padding)
  expect(await pad()).toBe('18px 0px 12px')
  await a.page.keyboard.press('d')
  expect(await pad()).toBe('10px 0px 7px')
  await a.size(900, 640)
  try {
    expect(await pad()).toBe('10px 0px 7px')
    await a.page.keyboard.press('d')
    expect(await pad()).toBe('12px 2px 9px')
    await a.page.keyboard.press('3')
    await expect(h1(a)).toHaveText('Log')
    expect(await pad()).toBe('12px 2px 9px')
    await a.page.keyboard.press('Control+,')
    await expect(h1(a)).toHaveText('Settings')
    expect(await pad()).toBe('12px 2px 9px')
    await a.page.keyboard.press('1')
  } finally {
    await a.size(1280, 800)
  }
})
