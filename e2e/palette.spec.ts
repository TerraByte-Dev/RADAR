// R7 (renderer spec 9.2): the palette and the keys sheet on the placeholder data set. Ctrl K opens
// the jump box with two groups, Tab goes into the highlighted project's actions, typing finds
// projects then commands, Enter opens; `?` shows the keys sheet with every keymap row; Esc closes
// and gives focus back.
import { expect, test } from '@playwright/test'
import { KEYMAP } from '../src/renderer/src/lib/keymap'
import { launch, type App } from './harness'

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true, size: [1280, 800] })
  await a.page.locator('.cont').waitFor()
})
test.afterAll(async () => {
  await a?.close()
})

const pal = (a: App) => a.page.locator('.pal[aria-label="Command palette"]')
const heads = (a: App) => pal(a).locator('.gl')
const items = (a: App) => pal(a).locator('[role=option]')
const on = (a: App) => pal(a).locator('[role=option][aria-selected=true]')

test('Ctrl K: two groups, five projects in pick order and the first one\'s six actions; one filled button', async () => {
  await a.page.keyboard.press('Control+k')
  await expect(pal(a)).toBeVisible()
  await expect(pal(a).locator('input')).toBeFocused()
  await expect(heads(a)).toHaveText(['Jump to a project', 'Tidewatch'])
  await expect(items(a)).toHaveCount(11)
  await expect(items(a).nth(5)).toContainText('Open')
  await expect(items(a).nth(10)).toContainText('Pin or unpin as focus')
  await expect(on(a)).toContainText('Tidewatch')
  // the overlay takes the strip's fill (rule 5)
  await expect(a.page.locator('.btn.pri')).toHaveCount(0)
  expect(await pal(a).innerText()).not.toMatch(/\d+ (open|more|tasks|unlogged|left)|\+\d+|overdue/i)
})

test('the arrows move the highlight, and the actions follow the highlighted project', async () => {
  await a.page.keyboard.press('ArrowDown')
  await expect(on(a)).toContainText('Homelab board')
  await expect(heads(a).nth(1)).toHaveText('Homelab board')
  // Tab goes into its actions, and back
  await a.page.keyboard.press('Tab')
  await expect(on(a)).toContainText('Open')
  await expect(pal(a).locator('input')).toBeFocused()
  await a.page.keyboard.press('Tab')
  await expect(on(a)).toContainText('Homelab board')
})

test('typing finds projects by name first, then commands; Enter runs the highlighted one', async () => {
  await pal(a).locator('input').fill('glid')
  await expect(heads(a).first()).toHaveText('Jump to a project')
  await expect(on(a)).toContainText('Cloud Glide')
  await pal(a).locator('input').fill('scope')
  await expect(heads(a).last()).toHaveText('Commands')
  await expect(items(a).last()).toContainText('Scope')
  await pal(a).locator('input').fill('light or')
  await expect(items(a)).toHaveText([/Light or dark/])
  await pal(a).locator('input').fill('glide')
  await a.page.keyboard.press('Enter')
  await expect(pal(a)).toHaveCount(0)
  await expect(a.page.locator('.detail h1')).toHaveText('Cloud Glide')
  await a.page.keyboard.press('Escape')
})

test('Esc closes and gives focus back; / opens it on projects alone', async () => {
  await a.page.locator('.top .cmd').click()
  await expect(pal(a)).toBeVisible()
  await a.page.keyboard.press('Escape')
  await expect(pal(a)).toHaveCount(0)
  await expect(a.page.locator('.top .cmd')).toBeFocused()
  await a.page.keyboard.press('/')
  await expect(heads(a)).toHaveText(['Jump to a project'])
  await expect(pal(a).locator('input')).toHaveAttribute('placeholder', 'Jump to a project')
  await a.page.keyboard.press('Escape')
})

test('? shows every keymap row; from the palette too; the field narrows it', async () => {
  const sheet = a.page.locator('.pal[aria-label="Keys"]')
  await a.page.keyboard.press('?')
  await expect(sheet).toBeVisible()
  const rows = await sheet.locator('dt').count()
  expect(rows).toBe(KEYMAP.length)
  await expect(sheet.locator('h2')).toHaveText(['Anywhere', 'A project', 'Project page', 'Scope'])
  await sheet.locator('input').fill('focus')
  await expect(sheet.locator('dt')).toHaveText(['Pin or unpin as focus'])
  await a.page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await a.page.keyboard.press('Control+k')
  await a.page.keyboard.press('?')
  await expect(sheet).toBeVisible()
  await expect(pal(a)).toHaveCount(0)
  await a.page.keyboard.press('Escape')
})

test('a typed command or action is highlighted with no project matching, and Enter runs it', async () => {
  const theme = () => a.page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
  const before = await theme()
  await a.page.keyboard.press('Control+k')
  await pal(a).locator('input').fill('light or')
  await expect(on(a)).toHaveText(/Light or dark/)
  await a.page.keyboard.press('Enter')
  await expect(pal(a)).toHaveCount(0)
  expect(await theme()).not.toBe(before)
  await a.page.keyboard.press('t')
  await a.page.keyboard.press('Control+k')
  await pal(a).locator('input').fill('settings')
  await a.page.keyboard.press('Enter')
  await expect(pal(a)).toHaveCount(0)
  await expect(a.page.locator('main h1')).toHaveText('Settings')
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('main h1')).not.toHaveText('Settings')
})

test('Tab back from an action lands on a row that is drawn', async () => {
  await a.page.keyboard.press('Control+k')
  await pal(a).locator('input').fill('resume')
  await expect(on(a)).toHaveCount(1)
  await a.page.keyboard.press('ArrowDown')
  await a.page.keyboard.press('Tab')
  await expect(on(a)).toHaveCount(1)
  const id = await pal(a).locator('input').getAttribute('aria-activedescendant')
  expect(id).toBeTruthy()
  await expect(a.page.locator(`#${id}`)).toHaveCount(1)
  await a.page.keyboard.press('Escape')
})

test('Enter on the open project\'s own row closes the palette', async () => {
  await a.page.keyboard.press('Control+k')
  await a.page.keyboard.press('Enter')
  await expect(a.page.locator('.detail h1')).toHaveText('Tidewatch')
  await a.page.keyboard.press('Control+k')
  await expect(on(a)).toContainText('Tidewatch')
  await a.page.keyboard.press('Enter')
  await expect(pal(a)).toHaveCount(0)
  await expect(a.page.locator('.detail h1')).toHaveText('Tidewatch')
  await a.page.keyboard.press('Escape')
})

test('the overlays are modal: a click inside keeps focus in the field, and no key reaches the view behind', async () => {
  const cls = () => a.page.evaluate(() => document.querySelector('main .view')?.className)
  const before = await cls()
  await a.page.keyboard.press('Control+k')
  await pal(a).locator('.pfoot').click()
  await expect(pal(a).locator('input')).toBeFocused()
  await pal(a).locator('.gl').first().click()
  await expect(pal(a).locator('input')).toBeFocused()
  await a.page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await a.page.keyboard.press('d')
  expect(await cls()).toBe(before)
  await expect(pal(a)).toHaveCount(1)
  await a.page.keyboard.press('Escape')
  await expect(pal(a)).toHaveCount(0)
  const sheet = a.page.locator('.pal[aria-label="Keys"]')
  await a.page.keyboard.press('?')
  await sheet.locator('.pfoot').click()
  await expect(sheet.locator('input')).toBeFocused()
  await a.page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('the palette and the listbox are listbox > group > option', async () => {
  await a.page.keyboard.press('Control+k')
  const bad = await pal(a).evaluate((el) =>
    [...el.querySelectorAll('[role=option]')].filter((o) => {
      const p = o.parentElement
      return !(p?.getAttribute('role') === 'group' || p?.getAttribute('role') === 'listbox' || p?.getAttribute('role') === 'presentation')
    }).length
  )
  expect(bad).toBe(0)
  await a.page.keyboard.press('Escape')
})

test('the keys sheet fits the 820x560 minimum: its body scrolls and the footer stays in view', async () => {
  await a.size(820, 560)
  const sheet = a.page.locator('.pal[aria-label="Keys"]')
  await a.page.keyboard.press('?')
  await expect(sheet).toBeVisible()
  const m = await sheet.evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, h: innerHeight }))
  expect(m.bottom).toBeLessThanOrEqual(m.h)
  await expect(sheet.locator('.pfoot')).toBeInViewport({ ratio: 1 })
  await sheet.locator('dt').last().scrollIntoViewIfNeeded()
  await expect(sheet.locator('dt').last()).toBeInViewport()
  await a.page.keyboard.press('Escape')
  await a.size(1280, 800)
})

// with an empty query the actions are the highlighted project's (9.2); a query no project matches finds the opener's
test('a query over the Log finds the actions of the selected entry\'s project', async () => {
  await a.page.keyboard.press('3')
  await a.page.locator('.ent').first().waitFor()
  for (let i = 0; i < 4; i++) await a.page.keyboard.press('j')
  const name = await a.page.locator('.ent.sel .pj').innerText()
  await a.page.keyboard.press('Control+k')
  await pal(a).locator('input').fill('resume')
  await expect(heads(a).first()).toHaveText(name)
  await a.page.keyboard.press('Escape')
  await a.page.keyboard.press('Escape')
  await a.page.keyboard.press('1')
})

test('H hides the project the keys act on, with Undo', async () => {
  const rows = a.page.locator('.row')
  await rows.first().waitFor()
  const n = await rows.count()
  await a.page.keyboard.press('h')
  await expect(a.page.locator('.toast')).toContainText('hidden from the board')
  await expect(rows).toHaveCount(n - 1)
  await a.page.locator('.toast button', { hasText: 'Undo' }).click()
  await expect(rows).toHaveCount(n)
})
