// R4 review (renderer spec 6.4): Pick one for me stays on screen. It opens inside the window when
// the list is scrolled and at the spec's short sizes, with the since list open; the page behind
// its scrim does not scroll; Show all leaves it closed. Also: the Continue project's own row,
// selected, leaves the strip its fill and keys, and lines up with the other rows under 1180.
import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, type App } from './harness'

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true, size: [1280, 800] })
  await a.page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(a.page.locator('.cont')).toBeVisible()
})
test.afterAll(async () => {
  await a?.close()
})

const filled = (a: App) => a.page.locator('.btn.pri').filter({ visible: true })

/** The popover's box, its buttons' bottom and the window's height. */
const box = (a: App) =>
  a.page.locator('.pick').evaluate((el) => {
    const b = el.getBoundingClientRect()
    const btns = (el.querySelector('.btns') as HTMLElement).getBoundingClientRect()
    return { top: b.top, bottom: b.bottom, btns: btns.bottom, h: innerHeight }
  })

/** Deals every card and checks each sits inside the window, buttons included. */
async function dealAll(a: App, label: string): Promise<number> {
  await a.page.keyboard.press('p')
  let n = 0
  for (; n < 10 && (await a.page.locator('.pick').count()); n++) {
    const m = await box(a)
    expect(m.top, `${label} card ${n} top`).toBeGreaterThanOrEqual(0)
    expect(m.bottom, `${label} card ${n} bottom`).toBeLessThanOrEqual(m.h)
    // the buttons are inside the window, or one scroll of the popover away
    const reach = await a.page.locator('.pick .btns').evaluate((el) => {
      el.scrollIntoView({ block: 'nearest' })
      return el.getBoundingClientRect().bottom <= innerHeight
    })
    expect(reach, `${label} card ${n} buttons`).toBe(true)
    await a.page.keyboard.press('a')
  }
  return n
}

test('the popover opens inside the window when the list is scrolled down', async () => {
  await a.page.mouse.move(640, 500)
  await a.page.mouse.wheel(0, 900)
  await expect.poll(() => a.page.evaluate(() => scrollY)).toBeGreaterThan(300)
  await a.page.keyboard.press('p')
  const m = await box(a)
  expect(m.top).toBeGreaterThanOrEqual(0)
  expect(m.bottom).toBeLessThanOrEqual(m.h)
  // still under its Pick button
  const pick = await a.page.locator('.cont .pickbtn').evaluate((el) => el.getBoundingClientRect().bottom)
  expect(Math.round(m.top - pick)).toBe(10)
  await a.page.keyboard.press('Escape')
})

test('the wheel over the scrim does not scroll the page, and the popover stays under its button', async () => {
  await a.page.evaluate(() => scrollTo(0, 0))
  await a.size(1280, 660)
  await a.page.keyboard.press('p')
  const before = await box(a)
  const y0 = await a.page.evaluate(() => scrollY)
  await a.page.mouse.move(100, 500)
  await a.page.mouse.wheel(0, 600)
  await a.page.waitForTimeout(200)
  expect(await a.page.evaluate(() => scrollY)).toBe(y0)
  expect((await box(a)).top).toBe(before.top)
  await a.page.keyboard.press('Escape')
  await a.size(1280, 800)
})

test('every card is inside the window at 1280x660, 900x640 and 820x560, with and without the since list open', async () => {
  await a.page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() - 3)
    const at = d.getTime()
    addEventListener('beforeunload', () => localStorage.setItem('radar.v3', JSON.stringify({ ...JSON.parse(localStorage.getItem('radar.v3') ?? '{}'), lastOpenedAt: at })))
  })
  await a.page.reload()
  await expect(a.page.locator('.cont')).toBeVisible()
  for (const [w, h] of [
    [1280, 660],
    [900, 640],
    [820, 560]
  ] as const) {
    await a.size(w, h)
    await expect(a.page.locator('.since')).toBeVisible()
    expect(await dealAll(a, `${w}x${h}`)).toBe(4)
    await a.page.locator('.since').click()
    await expect(a.page.locator('.since')).toHaveAttribute('aria-expanded', 'true')
    expect(await dealAll(a, `${w}x${h} since open`)).toBe(4)
    await a.page.locator('.since').click()
    if (process.env.RADAR_SHOTS_DIR) {
      await a.page.keyboard.press('p')
      await a.page.screenshot({ path: join(process.env.RADAR_SHOTS_DIR, `pick-${w}x${h}.png`) })
      await a.page.keyboard.press('Escape')
    }
  }
  await a.size(1280, 800)
})

test("the Continue project's own row, selected, keeps the strip's fill and its keys", async () => {
  await a.page.evaluate(() => scrollTo(0, 0))
  await a.page.keyboard.press('j')
  await expect(a.page.locator('.row.sel')).toHaveClass(/\bc0\b/)
  await expect(filled(a)).toHaveCount(1)
  await expect(a.page.locator('.cont .btn.pri')).toHaveText(/^Open/)
  await expect(a.page.locator('.cont .btn').nth(0).locator('kbd')).toHaveText('↵')
  await expect(a.page.locator('.cont .btn').nth(1).locator('kbd')).toHaveText('C')
  // the next row takes them
  await a.page.keyboard.press('j')
  await expect(a.page.locator('.cont .btn.pri')).toHaveCount(0)
  await expect(a.page.locator('.cont .btn').nth(0).locator('kbd')).toHaveCount(0)
  await a.page.keyboard.press('Escape')
})

test("under 1180 the continued row's name lines up with the other rows'", async () => {
  await a.size(900, 640)
  const xs = await a.page.locator('.main .row .nm').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
  expect(new Set(xs).size, xs.join(',')).toBe(1)
  await a.size(1280, 800)
})

test('Show all on a legacy long title goes to the project page and leaves the popover closed', async () => {
  const dir = await a.page.evaluate(async () => {
    const list = await window.radar.invoke('projects.list')
    return list.ok ? (list.data.projects.find((p) => p.doc?.name === 'Homelab board')?.dir ?? null) : null
  })
  expect(dir).not.toBeNull()
  const file = join(dir!, 'BLIP.md')
  const src = readFileSync(file, 'utf8')
  const first = src.match(/^- \[ \] (.+)$/m)
  expect(first, 'an open task in Homelab board').not.toBeNull()
  const long = 'Write the backup timeline panel for the rack page so every node shows what ran, what failed overnight, and what runs next'
  expect(long.length).toBeGreaterThan(80)
  writeFileSync(file, src.replace(first![0], `- [ ] ${long}`))
  await a.page.reload()
  await expect(a.page.locator('.cont')).toBeVisible()
  await a.page.keyboard.press('p')
  await expect(a.page.locator('.pick h2')).toHaveText('Homelab board')
  await a.page.locator('.pick .long button').click()
  await expect(a.page.locator('.pick')).toHaveCount(0)
  expect(await a.page.evaluate(() => location.hash + document.querySelector('main')?.textContent)).toContain('Homelab board')
  // one Esc goes back to Pick up, and the popover does not come back with it
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.cont')).toBeVisible()
  await expect(a.page.locator('.pick')).toHaveCount(0)
  await a.page.keyboard.press('1')
  await expect(a.page.locator('.pick')).toHaveCount(0)
})
