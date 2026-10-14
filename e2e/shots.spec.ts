// Screenshots of each view at the spec's three window sizes, dark and light, into $RADAR_SHOTS_DIR
// (skipped when it is not set). Each stage compares these with radar-design/final/shots.
import { test } from '@playwright/test'
import { join } from 'node:path'
import { launch, makeWorld, mockupBearings, type App } from './harness'

const out = process.env.RADAR_SHOTS_DIR
test.skip(!out, 'set RADAR_SHOTS_DIR to write screenshots')

const SIZES: [number, number][] = [
  [900, 640],
  [1280, 800],
  [1600, 900]
]
const VIEWS = [
  ['home', '1'],
  ['scope', '2'],
  ['log', '3'],
  ['settings', 'Control+,']
] as const

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true })
  // no transitions, so a shot never catches one half way
  await a.page.emulateMedia({ reducedMotion: 'reduce' })
  // the blips where the mockup has them
  await mockupBearings(a.page)
  // last here three days before the demo's today, as the mockup's Saturday digest. The app writes
  // lastOpenedAt as the page unloads, so this is written after it, on the same unload.
  await a.page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() - 3)
    d.setHours(12, 0, 0, 0)
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
  test(`views in ${theme}`, async () => {
    const isLight = await a.page.evaluate(() => document.documentElement.dataset.theme === 'light')
    if (isLight !== (theme === 'light')) await a.page.keyboard.press('t')
    for (const [w, h] of SIZES) {
      await a.size(w, h)
      for (const [name, key] of VIEWS) {
        await a.page.keyboard.press(key)
        // each view as it opens: nothing selected and the page at its top, whatever the last size left
        if (name === 'home' && (await a.page.locator('.row.sel').count())) await a.page.keyboard.press('Escape')
        await a.page.evaluate(() => scrollTo(0, 0))
        // the Scope as radar-design/final/shots/scope-*: Cloud Glide selected
        if (name === 'scope') await a.page.locator('.sl button', { hasText: 'Cloud Glide' }).click()
        await a.page.mouse.move(0, h - 1)
        const file = `${name}${theme === 'light' ? '-light' : ''}-${w}x${h}.png`
        await a.page.screenshot({ path: join(out as string, file) })
        if (name === 'scope') await a.page.keyboard.press('Escape')
      }
      // Pick one for me, as radar-design/final/shots/home-pick-*
      await a.page.keyboard.press('1')
      await a.page.keyboard.press('p')
      await a.page.locator('.pick').waitFor()
      await a.page.mouse.move(0, h - 1)
      await a.page.screenshot({ path: join(out as string, `home-pick${theme === 'light' ? '-light' : ''}-${w}x${h}.png`) })
      await a.page.keyboard.press('Escape')
      // the palette and the keys sheet over Pick up, as radar-design/final/shots/palette-* and keys-*
      for (const [name, key] of [
        ['palette', 'Control+k'],
        ['keys', '?']
      ] as const) {
        await a.page.keyboard.press(key)
        await a.page.locator('.pal').waitFor()
        await a.page.mouse.move(0, h - 1)
        await a.page.screenshot({ path: join(out as string, `${name}${theme === 'light' ? '-light' : ''}-${w}x${h}.png`) })
        await a.page.keyboard.press('Escape')
      }
      // under 1180 the digest is the since line, opened in place, as home-since-900x640
      if (w < 1180) {
        await a.page.locator('.since').click()
        await a.page.mouse.move(0, h - 1)
        await a.page.screenshot({ path: join(out as string, `home-since${theme === 'light' ? '-light' : ''}-${w}x${h}.png`) })
        await a.page.locator('.since').click()
      }
      // Pick up in one-line density, as radar-design/final/shots/home-dense-*
      await a.page.keyboard.press('1')
      await a.page.keyboard.press('d')
      await a.page.mouse.move(0, h - 1)
      await a.page.screenshot({ path: join(out as string, `home-dense${theme === 'light' ? '-light' : ''}-${w}x${h}.png`) })
      await a.page.keyboard.press('d')
      // a selected row, as radar-design/final/shots/home-selected-*
      await a.page.locator('.row', { hasText: 'Homelab board' }).first().click()
      await a.page.mouse.move(0, h - 1)
      await a.page.screenshot({ path: join(out as string, `home-selected${theme === 'light' ? '-light' : ''}-${w}x${h}.png`) })
      await a.page.keyboard.press('Escape')
      // the project page, as radar-design/final/shots/detail-*: Cloud Glide with its first queue row
      // open and nothing selected (Space opens it, Esc lets the selection go)
      await a.page.locator('.row', { hasText: 'Cloud Glide' }).first().click()
      await a.page.keyboard.press('Enter')
      await a.page.locator('.detail .q li[id^="task-"]').first().waitFor()
      await a.page.keyboard.press('Space')
      await a.page.locator('.detail .q li.open.sel').waitFor()
      await a.page.keyboard.press('Escape')
      await a.page.locator('.detail .q li.sel').waitFor({ state: 'detached' })
      await a.page.evaluate(() => scrollTo(0, 0))
      await a.page.mouse.move(0, h - 1)
      await a.page.screenshot({ path: join(out as string, `detail${theme === 'light' ? '-light' : ''}-${w}x${h}.png`) })
      if (w === 1280) {
        const flow = await a.page.addStyleTag({ content: '.foot{position:static!important}' })
        await a.page.screenshot({ path: join(out as string, `detail-full${theme === 'light' ? '-light' : ''}-1280.png`), fullPage: true })
        await flow.evaluate((el) => (el as HTMLElement).remove())
      }
      await a.page.keyboard.press('Space')
      await a.page.keyboard.press('Escape')
      await a.page.keyboard.press('Escape')
    }
    // a short window: the since line above the strip, the rail without the digest, as home-short-1280x660
    await a.size(1280, 660)
    await a.page.mouse.move(0, 659)
    await a.page.screenshot({ path: join(out as string, `home-short${theme === 'light' ? '-light' : ''}-1280x660.png`) })
    // the whole Pick up page, as home-full-1280
    await a.size(1280, 800)
    const flow = await a.page.addStyleTag({ content: '.foot{position:static!important}.home{padding-bottom:0!important}' })
    await a.page.screenshot({ path: join(out as string, `home-full${theme === 'light' ? '-light' : ''}-1280.png`), fullPage: true })
    await flow.evaluate((el) => (el as HTMLElement).remove())
  })
}

// The 40-project overflow set on the Scope, as radar-design/final/shots/scope-40-*. The demo's 40
// is the mockup's 24 plus its own synthetic 16, so only the 24 sit where the mockup has them.
test('the Scope with 40 projects', async () => {
  const b = await launch({ world: makeWorld({ demo: true, extra: true }) })
  try {
    await b.page.emulateMedia({ reducedMotion: 'reduce' })
    await mockupBearings(b.page)
    for (const [theme, sizes] of [
      ['dark', SIZES.slice(1)],
      ['light', [[1280, 800]]]
    ] as const) {
      const isLight = await b.page.evaluate(() => document.documentElement.dataset.theme === 'light')
      if (isLight !== (theme === 'light')) await b.page.keyboard.press('t')
      for (const [w, h] of sizes) {
        await b.size(w, h)
        await b.page.keyboard.press('2')
        await b.page.locator('.sl button', { hasText: 'Cloud Glide' }).click()
        await b.page.mouse.move(0, h - 1)
        await b.page.screenshot({ path: join(out as string, `scope-40${theme === 'light' ? '-light' : ''}-${w}x${h}.png`) })
        await b.page.keyboard.press('Escape')
      }
    }
  } finally {
    await b.close()
  }
})
