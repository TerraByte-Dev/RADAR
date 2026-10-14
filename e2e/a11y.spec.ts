// R9 (renderer spec 11, 13): axe reports no violations on the six views in both themes, and on the
// overlays drawn over them. axe-core is evaluated into the page over the debugging protocol, so the
// app's CSP stays as it ships.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, makeWorld, mockupBearings, ROOT, type App } from './harness'

const AXE = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')

interface Violation {
  id: string
  help: string
  nodes: { target: string[]; failureSummary?: string }[]
}

/** Every violation on the page as axe reports it, one line per node, so a failure names the element. */
async function axe(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE)
  const found = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run(ctx: Document, opts: object): Promise<{ violations: Violation[] }> } }
    const r = await w.axe.run(document, { resultTypes: ['violations'] })
    return r.violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })) }))
  })
  return found.flatMap((v) => v.nodes.map((n) => `${v.id} (${v.help}) at ${n.target.join(' ')}: ${n.failureSummary ?? ''}`))
}

async function setTheme(a: App, theme: 'dark' | 'light'): Promise<void> {
  const isLight = await a.page.evaluate(() => document.documentElement.dataset.theme === 'light')
  if (isLight !== (theme === 'light')) await a.page.keyboard.press('t')
}

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true, size: [1280, 800] })
  await a.page.emulateMedia({ reducedMotion: 'reduce' })
  await mockupBearings(a.page)
  // last here three days ago, so Pick up has its digest and, under 1180, its since line
  await a.page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() - 3)
    addEventListener('beforeunload', () =>
      localStorage.setItem('radar.v3', JSON.stringify({ ...JSON.parse(localStorage.getItem('radar.v3') ?? '{}'), lastOpenedAt: d.getTime() }))
    )
  })
  await a.page.reload()
  await a.page.locator('.cont').waitFor()
})
test.afterAll(async () => {
  await a?.close()
})

for (const theme of ['dark', 'light'] as const) {
  test(`no violations on the views in ${theme}`, async () => {
    await setTheme(a, theme)
    const report: Record<string, string[]> = {}
    const check = async (name: string): Promise<void> => {
      report[name] = await axe(a.page)
      if (report[name].length) console.log(`${theme} ${name}:\n  ${report[name].join('\n  ')}`)
    }
    await a.page.keyboard.press('1')
    await check('pick up')
    await a.page.locator('.row', { hasText: 'Homelab board' }).first().click()
    await check('pick up, a row selected')
    await a.page.keyboard.press('Escape')
    await a.page.keyboard.press('p')
    await a.page.locator('.pick').waitFor()
    await check('pick one for me')
    await a.page.keyboard.press('Escape')
    await a.page.keyboard.press('Control+k')
    await a.page.locator('.pal').waitFor()
    await check('palette')
    await a.page.keyboard.press('Escape')
    await a.page.keyboard.press('?')
    await a.page.locator('.pal').waitFor()
    await check('keys sheet')
    await a.page.keyboard.press('Escape')
    await a.page.locator('.row', { hasText: 'Cloud Glide' }).first().click()
    await a.page.keyboard.press('Enter')
    await a.page.locator('.detail .q li[id^="task-"]').first().waitFor()
    await check('project page')
    await a.page.keyboard.press('Space')
    await a.page.locator('.detail .q li.open.sel').waitFor()
    await check('project page, a task open')
    await a.page.keyboard.press('Space')
    await a.page.keyboard.press('Escape')
    await a.page.keyboard.press('Escape')
    await a.page.keyboard.press('2')
    await a.page.locator('.sl button', { hasText: 'Cloud Glide' }).click()
    await check('scope')
    await a.page.keyboard.press('Escape')
    await a.page.keyboard.press('3')
    await check('log')
    await a.page.keyboard.press('Control+,')
    await check('settings')
    await a.size(900, 640)
    await a.page.keyboard.press('1')
    await check('pick up at 900')
    await a.page.locator('.since').click()
    await check('pick up at 900, since line open')
    await a.page.locator('.since').click()
    await a.size(1280, 800)
    await a.page.keyboard.press('1')
    expect(Object.entries(report).filter(([, v]) => v.length)).toEqual([])
  })
}

// Focus management (section 11): a view that replaces what held focus hands it to its heading,
// never to the page; overlays give it back to their opener.
test('focus is never left on the page as the views change', async () => {
  const where = () => a.page.evaluate(() => (document.activeElement === document.body ? 'body' : (document.activeElement?.tagName ?? 'none')))
  await a.page.keyboard.press('1')
  for (const key of ['2', '3', 'Control+,', '1']) {
    await a.page.keyboard.press(key)
    expect(await where(), key).not.toBe('body')
  }
  await a.page.locator('.row', { hasText: 'Cloud Glide' }).first().click()
  await a.page.keyboard.press('Enter')
  await a.page.locator('.detail h1').waitFor()
  expect(await where()).toBe('H1')
  await expect(a.page.locator('.detail h1')).toBeFocused()
  await a.page.keyboard.press('Escape')
  await a.page.locator('.cont').waitFor()
  expect(await where()).not.toBe('body')
  await a.page.keyboard.press('Escape')
  // a selection cleared, by Escape or by K from the first row, leaves focus in the view
  await a.page.locator('.row', { hasText: 'Homelab board' }).first().click()
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.row.sel')).toHaveCount(0)
  expect(await where(), 'Escape').not.toBe('body')
  await a.page.keyboard.press('d')
  await a.page.keyboard.press('j')
  await expect(a.page.locator('.row.sel')).toHaveCount(1)
  await a.page.keyboard.press('k')
  await expect(a.page.locator('.row.sel')).toHaveCount(0)
  expect(await where(), 'K from the first row').not.toBe('body')
  await a.page.keyboard.press('d')
  // an overlay hands focus back to what held it
  await a.page.locator('.top .cmd').focus()
  await a.page.keyboard.press('Control+k')
  await a.page.locator('.pal').waitFor()
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.top .cmd')).toBeFocused()
})

test('no violations on first run and on the read-only states, in both themes', async () => {
  const w = makeWorld({ demo: true })
  for (const f of readdirSync(w.data)) if (f.startsWith('registry')) rmSync(join(w.data, f), { force: true })
  // Claude Code is installed, so first run has a diff to show
  mkdirSync(join(w.home, '.claude'), { recursive: true })
  const b = await launch({ world: w, size: [1280, 800] })
  const report: Record<string, string[]> = {}
  try {
    await b.page.emulateMedia({ reducedMotion: 'reduce' })
    await b.page.locator('.first h1').waitFor()
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(b, theme)
      report[`first run in ${theme}`] = await axe(b.page)
      await b.page.locator('.btn.pri', { hasText: 'Connect to Claude Code' }).click()
      await b.page.locator('.diff').first().waitFor()
      report[`first run's diff in ${theme}`] = await axe(b.page)
      await b.page.locator('.btn', { hasText: 'Cancel' }).click()
    }
  } finally {
    await b.close()
  }
  const c = await launch({ world: makeWorld({ demo: true, extra: true }), size: [1280, 800] })
  try {
    await c.page.emulateMedia({ reducedMotion: 'reduce' })
    await c.page.locator('.cont').waitFor()
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(c, theme)
      await c.page.keyboard.press('1')
      report[`40 projects' pick up in ${theme}`] = await axe(c.page)
      await c.page.keyboard.press('Control+,')
      report[`40 projects' settings in ${theme}`] = await axe(c.page)
      await c.page.keyboard.press('1')
      // the file that cannot be parsed, and the v2 file: their pages
      for (const name of ['print-shop-api', 'Trail maps']) {
        await c.page.locator('.row', { hasText: name }).first().click()
        await c.page.keyboard.press('Enter')
        await c.page.locator('.detail .banner').waitFor()
        report[`${name}'s page in ${theme}`] = await axe(c.page)
        await c.page.keyboard.press('Escape')
        await c.page.keyboard.press('Escape')
      }
    }
  } finally {
    await c.close()
  }
  expect(Object.entries(report).filter(([, v]) => v.length)).toEqual([])
})

/** The window as drawn, from the main process: Playwright's own screenshot misreads a zoomed page. */
async function capture(a: App, file: string): Promise<void> {
  if (!process.env.RADAR_SHOTS_DIR) return
  const png = await a.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(process.env.RADAR_SHOTS_DIR, file), Buffer.from(png, 'base64'))
}

/**
 * What is wider than the window: the page itself, and any element drawn past its right edge
 * (cut off by the window or by an inner scroller, which the page's width does not show).
 */
const tooWide = (a: App): Promise<string[]> =>
  a.page.evaluate(() => {
    const out: string[] = []
    const over = document.documentElement.scrollWidth - innerWidth
    if (over > 0) out.push(`the page is ${over}px too wide`)
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || r.right <= innerWidth + 0.5) continue
      // an SVG's own shapes are bounded by the SVG, which is measured itself
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      out.push(`${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? '').trim().slice(0, 30)}" ends at ${Math.round(r.right)} of ${innerWidth}`)
    }
    return out
  })

// Zoom (section 11): at 200% the layout holds, falling to the under-1180 rules, with nothing wider
// than the window. 1920x1080 at 200% is 960x540 CSS pixels; 1280x800 at 200% is 640x400, under the
// 820 minimum, which only zooming reaches.
test('at 200% every view holds without sideways scrolling', async () => {
  const wide: string[] = []
  try {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 800]
    ] as const) {
      // sized at 100%, as the harness measures the page in CSS pixels
      await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
      await a.size(w, h)
      await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2))
      await expect.poll(() => a.page.evaluate(() => window.innerWidth)).toBe(w / 2)
      for (const [name, key, title] of [
        ['pick up', '1', 'Pick up'],
        ['scope', '2', 'Scope'],
        ['log', '3', 'Log'],
        ['settings', 'Control+,', 'Settings']
      ] as const) {
        await a.page.keyboard.press(key)
        // measured once the view is the one asked for
        await expect(a.page.locator('main h1')).toHaveText(title)
        for (const what of await tooWide(a)) wide.push(`${name} at ${w}x${h}: ${what}`)
        await capture(a, `zoom200-${name.replace(' ', '')}-${w}x${h}.png`)
      }
      await a.page.keyboard.press('1')
      await expect(a.page.locator('main h1')).toHaveText('Pick up')
      await a.page.locator('.row', { hasText: 'Cloud Glide' }).first().click()
      await a.page.keyboard.press('Enter')
      await expect(a.page.locator('.detail h1')).toHaveText(/Cloud Glide/)
      for (const what of await tooWide(a)) wide.push(`project page at ${w}x${h}: ${what}`)
      await capture(a, `zoom200-project-${w}x${h}.png`)
      await a.page.keyboard.press('Escape')
    }
  } finally {
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
    await a.size(1280, 800)
  }
  expect(wide).toEqual([])
})
