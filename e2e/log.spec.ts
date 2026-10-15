// R7 (renderer spec 6.7): the Log on the placeholder data set. Every entry newest first under day
// headings, the author only where it changes, no live session on an entry, the filter on `/`, the
// Show list, J K and Enter, and nothing that writes.
import { expect, test } from '@playwright/test'
import { appendFileSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { launch, makeWorld, type App } from './harness'

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true, size: [1280, 800] })
  await a.page.locator('.cont').waitFor()
  await a.page.keyboard.press('3')
  await a.page.locator('.ent').first().waitFor()
})
test.afterAll(async () => {
  await a?.close()
})

const ents = (a: App) => a.page.locator('.logpage .ent')

test('today first, newest first, as the mockup', async () => {
  await expect(a.page.locator('.day').first()).toContainText('Today')
  await expect(ents(a).nth(0).locator('.pj')).toHaveText('Tidewatch')
  // the demo writes today's entries no later than an hour before the run, so the times follow the clock
  const times = await a.page.locator('section').first().locator('.tm').allInnerTexts()
  expect(times.length).toBe(2)
  expect([...times].sort().reverse()).toEqual(times)
  // the author on the first entry, and again only where it changes
  await expect(ents(a).nth(0).locator('.au')).toHaveText(/\+ Claude/)
  await expect(ents(a).nth(1).locator('.au')).toHaveCount(0)
  // one heading per day, each day once
  const days = await a.page.locator('.day b').allInnerTexts()
  expect(days.length).toBeGreaterThan(3)
  const subs = await a.page.locator('.day span').allInnerTexts()
  expect(new Set(subs).size).toBe(subs.length)
})

test('no live session on an entry; it is on the project in the Show list', async () => {
  await expect(ents(a).locator('.livec')).toHaveCount(0)
  await expect(a.page.locator('.logside nav button', { hasText: 'Tidewatch' }).locator('.livec')).toHaveText('live')
})

test('no write control and no count of undone work', async () => {
  await expect(a.page.locator('.logpage .btn')).toHaveCount(0)
  expect(await a.page.locator('.logpage').innerText()).not.toMatch(/\d+ (open|more|tasks|unlogged|left)|\+\d+|overdue/i)
})

test('/ focuses the filter; it narrows the entries, Esc empties it', async () => {
  await a.page.keyboard.press('/')
  const input = a.page.locator('.logside input')
  await expect(input).toBeFocused()
  await input.fill('glider')
  await expect(ents(a)).toHaveCount(await ents(a).filter({ hasText: /glider/i }).count())
  await expect(ents(a).first()).toContainText('Cloud Glide')
  await a.page.keyboard.press('Escape')
  await expect(input).toHaveValue('')
  await a.page.keyboard.press('Escape')
  await expect(input).not.toBeFocused()
  await expect(a.page.locator('main h1')).toHaveText('Log')
})

test('Show narrows to one project, Every project shows them all again', async () => {
  const all = await ents(a).count()
  await a.page.locator('.logside nav button', { hasText: 'Homelab board' }).click()
  await expect(ents(a).locator('.pj')).toHaveText(Array(await ents(a).count()).fill('Homelab board'))
  await a.page.locator('.logside nav button', { hasText: 'Every project' }).click()
  await expect(ents(a)).toHaveCount(all)
})

test('J moves through the entries, Enter opens its project, Esc lets the selection go', async () => {
  await a.page.keyboard.press('j')
  await a.page.keyboard.press('j')
  await expect(a.page.locator('.ent.sel .pj')).toHaveText('Tidewatch')
  await expect(a.page.locator('.foot')).toContainText('open')
  await a.page.keyboard.press('j')
  await expect(a.page.locator('.ent.sel .pj')).toHaveText('Homelab board')
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.ent.sel')).toHaveCount(0)
  await a.page.keyboard.press('j')
  await a.page.keyboard.press('Enter')
  await expect(a.page.locator('.detail h1')).toHaveText('Tidewatch')
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('main h1')).toHaveText('Log')
})

test('Show lists every visible project; the sticky column stays above the status bar at 820x560', async () => {
  const n = await a.page.evaluate(async () => {
    const res = await window.radar.invoke('projects.list')
    return res.ok ? res.data.projects.filter((r) => !r.hidden && r.state !== 'missing').length : -1
  })
  await expect(a.page.locator('.logside nav button')).toHaveCount(n + 1)
  // at the page's top and scrolled, at the minimum window and the mockup's size
  for (const [w, h] of [[820, 560], [1280, 800]] as const) {
    await a.size(w, h)
    for (const y of [0, 400]) {
      await a.page.evaluate((y) => scrollTo(0, y), y)
      const m = await a.page.evaluate(() => ({
        side: document.querySelector('.logside')!.getBoundingClientRect().bottom,
        foot: document.querySelector('.foot')!.getBoundingClientRect().top
      }))
      expect(m.side, `${w}x${h} at ${y}`).toBeLessThanOrEqual(m.foot)
    }
  }
  await a.size(820, 560)
  const last = a.page.locator('.logside nav button').last()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  await a.size(1280, 800)
})

test('the entries are listbox > group > option, with no control inside an option', async () => {
  const m = await a.page.locator('.logpage [role=listbox]').evaluate((el) => ({
    kids: [...el.children].filter((c) => !['group', 'option'].includes(c.getAttribute('role') ?? '') && !c.matches('.none, .more')).length,
    nested: el.querySelectorAll('[role=option] button, [role=option] a, [role=option] input').length
  }))
  expect(m).toEqual({ kids: 0, nested: 0 })
})

test('70 entries: 60 drawn, the rest as the end scrolls into view, 60 again when the filter changes', async () => {
  const w = makeWorld({ demo: true })
  const file = readdirSync(w.projects, { recursive: true, encoding: 'utf8' })
    .map((f) => join(w.projects, f))
    .find((f) => f.endsWith('BLIP.md') && readFileSync(f, 'utf8').includes('blip: 3'))!
  const lines: string[] = []
  for (let i = 0; i < 70; i++) {
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    lines.push(`## ${d} 09:00 — Pager test`, `- Paged entry ${i}.`, '')
  }
  appendFileSync(file,['', ...lines].join('\n'))
  const b = await launch({ world: w, size: [1280, 800] })
  try {
    await b.page.locator('.cont').waitFor()
    await b.page.keyboard.press('3')
    const ents = b.page.locator('.logpage .ent')
    await expect(ents).toHaveCount(60)
    const total = await b.page.evaluate(async () => {
      const res = await window.radar.invoke('projects.list')
      return res.ok ? res.data.projects.filter((r) => !r.hidden && r.state !== 'missing').reduce((n, r) => n + (r.doc?.log.length ?? 0), 0) : -1
    })
    expect(total).toBeGreaterThan(70)
    await b.page.locator('.day.more').scrollIntoViewIfNeeded()
    await expect(ents).toHaveCount(Math.min(120, total))
    // back at the top, a new filter draws the first 60 again
    await b.page.evaluate(() => scrollTo(0, 0))
    await b.page.locator('.logside input').fill('e')
    await expect(ents).toHaveCount(60)
  } finally {
    await b.close()
  }
})
