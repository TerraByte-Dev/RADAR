// R5 (renderer spec 6.5, 6.6, 8, 13): the project page on the placeholder data set. Open from
// Pick up; the keys act on the page's project; an edit shows its answer and offers Undo, and
// Ctrl Z undoes it; the Now line refuses a bad value under the field and writes nothing; the
// queue shows five rows then the expander, with no position numbers, on a 95-task project; a
// 1,200-character legacy title is clamped with Show all; a refused write is a toast.
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

const NEXT = 'Stall and spin: lose lift, drop a wing, recover'
const page = (a: App) => a.page.locator('.detail')
const queue = (a: App) => a.page.locator('.detail .q li[id^="task-"]')
const toast = (a: App) => a.page.locator('.toast')

/** Opens Cloud Glide from Pick up: its row selected, then Enter. */
async function openGlide(a: App): Promise<void> {
  await a.page.keyboard.press('1')
  await a.page.locator('.row', { hasText: 'Cloud Glide' }).first().click()
  await a.page.keyboard.press('Enter')
  await expect(page(a).locator('h1')).toHaveText('Cloud Glide')
}

/** Cloud Glide as main holds it now. */
const record = (a: App) =>
  a.page.evaluate(async () => {
    const list = await window.radar.invoke('projects.list')
    const r = list.ok ? list.data.projects.find((p) => p.doc?.name === 'Cloud Glide') : undefined
    if (!r) throw new Error('no Cloud Glide')
    return r
  })

test('Enter opens the page: crumb, name, Now, the next step whole, five queue rows, and the page keys in the status bar', async () => {
  await openGlide(a)
  await expect(page(a).locator('.crumb')).toHaveText(/^Pick up\s*\/\s*games \/ cloud-glide$/)
  await expect(page(a).locator('.nextcard h2')).toHaveText(NEXT)
  await expect(page(a).locator('.nextcard .btn.pri')).toHaveText(/^Mark done/)
  await expect(a.page.locator('.btn.pri').filter({ visible: true })).toHaveCount(1)
  await expect(queue(a)).toHaveCount(5)
  await expect(page(a).locator('.q li.rest')).toContainText('Show the rest of the queue')
  await expect(a.page.locator('.foot')).toContainText('move')
  await expect(a.page.locator('.foot')).toContainText('detail')
  await expect(a.page.locator('.foot')).toContainText('mark done')
  await expect(a.page.locator('.foot')).toContainText('previous / next project')
  // the rail names every project; this one is current
  await expect(page(a).locator('.side [aria-current=page]')).toContainText('Cloud Glide')
  // Esc goes back to Pick up
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.cont')).toBeVisible()
})

test('X marks the next step done with Undo in the toast, and Ctrl Z brings it back', async () => {
  await openGlide(a)
  await a.page.keyboard.press('x')
  await expect(toast(a)).toContainText(`Done: ${NEXT}`)
  await expect(toast(a).locator('.btn')).toHaveText(/^Undo\s*Ctrl\s*Z$/)
  await expect(page(a).locator('.nextcard h2')).not.toHaveText(NEXT)
  await a.page.keyboard.press('Control+z')
  await expect(toast(a)).toHaveText('Undone.')
  await expect(page(a).locator('.nextcard h2')).toHaveText(NEXT)
})

test('N moves the next step down one, and the toast Undo puts it back', async () => {
  await a.page.keyboard.press('n')
  await expect(toast(a)).toContainText('Moved down one. It will come back around.')
  await expect(page(a).locator('.nextcard h2')).toHaveText(/^Thermal robustness/)
  await toast(a).locator('.btn').click()
  await expect(page(a).locator('.nextcard h2')).toHaveText(NEXT)
})

test('F pins the project as focus and unpins it; the pill and the toggle follow', async () => {
  await a.page.keyboard.press('f')
  await expect(toast(a)).toContainText('Pinned as focus.')
  await expect(page(a).locator('.title .pin')).toHaveText(/^\s*Focus$/)
  await expect(page(a).locator('[role=switch]')).toHaveAttribute('aria-checked', 'true')
  await a.page.keyboard.press('f')
  await expect(page(a).locator('.title .pin')).toHaveText(/Pin as focus/)
})

test('the Now line refuses a value past 140 characters under the field, and writes nothing', async () => {
  const before = (await record(a)).rev
  await page(a).locator('.nowline').click()
  const field = page(a).locator('.nowline textarea')
  await field.fill('x'.repeat(130))
  await expect(page(a).locator('.nowline .cnt')).toHaveText('130/140')
  await field.fill(`The wings work ${'and the tail works '.repeat(8)}`)
  await field.press('Enter')
  await expect(page(a).locator('.nowline .viol li')).toContainText(/chars \(max 140\)/)
  expect((await record(a)).rev).toBe(before)
  // Esc closes the editor and stays on the page
  await field.press('Escape')
  await expect(page(a).locator('.nowline textarea')).toHaveCount(0)
  await expect(page(a).locator('h1')).toHaveText('Cloud Glide')
})

test('J selects a queue row, Space opens its detail, and Alt Down moves it', async () => {
  await a.page.keyboard.press('j')
  await expect(queue(a).first()).toHaveAttribute('aria-current', 'true')
  await expect(queue(a).first()).toBeFocused()
  await a.page.keyboard.press('Space')
  await expect(queue(a).first().locator('.dd')).toContainText('Clamp climb rate')
  await a.page.keyboard.press('Alt+ArrowDown')
  await expect(toast(a)).toContainText('Moved: Thermal robustness')
  await expect(queue(a).nth(1)).toContainText('Thermal robustness')
  await a.page.keyboard.press('Control+z')
  await expect(queue(a).first()).toContainText('Thermal robustness')
})

test('Esc with a queue row selected lets the row go and stays; a second Esc goes back', async () => {
  await a.page.keyboard.press('j')
  await expect(page(a).locator('.q li.sel')).toHaveCount(1)
  await a.page.keyboard.press('Escape')
  await expect(page(a).locator('h1')).toHaveText('Cloud Glide')
  await expect(page(a).locator('.q li.sel')).toHaveCount(0)
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.cont')).toBeVisible()
  await openGlide(a)
})

/** A drag of queue row `from` dropped on row `to`, as the HTML drag events the row listens to. */
async function drag(a: App, from: number, to: number): Promise<void> {
  const dataTransfer = await a.page.evaluateHandle(() => new DataTransfer())
  await queue(a).nth(from).dispatchEvent('dragstart', { dataTransfer })
  await queue(a).nth(to).dispatchEvent('dragover', { dataTransfer })
  await queue(a).nth(to).dispatchEvent('drop', { dataTransfer })
  await queue(a).nth(from).dispatchEvent('dragend', { dataTransfer })
}

test('a row dragged onto the row below it lands after it, and one dragged up lands before its target', async () => {
  const first = await queue(a).nth(0).locator('.t').innerText()
  const second = await queue(a).nth(1).locator('.t').innerText()
  await drag(a, 0, 1)
  await expect(toast(a)).toContainText(`Moved: ${first}`)
  await expect(queue(a).nth(0).locator('.t')).toHaveText(second)
  await expect(queue(a).nth(1).locator('.t')).toHaveText(first)
  await drag(a, 1, 0)
  await expect(queue(a).nth(0).locator('.t')).toHaveText(first)
  await expect(queue(a).nth(1).locator('.t')).toHaveText(second)
})

test('the task editor: a title refused shows under Title, and Enter in Title saves', async () => {
  const row = queue(a).nth(2)
  const was = await row.locator('.t').innerText()
  await row.click()
  await row.getByRole('button', { name: 'Edit' }).click()
  const title = row.locator('input[aria-label="Title"]')
  await title.fill('# Wings')
  await title.press('Enter')
  await expect(title.locator('xpath=..').locator('.viol li')).toContainText('starts with "- ", "[" or "#"')
  await expect(row.locator('textarea[aria-label="Detail"]').locator('xpath=..').locator('.viol')).toHaveCount(0)
  await title.fill(`${was} again`)
  await title.press('Enter')
  await expect(toast(a)).toContainText(`Changed: ${was} again`)
  await expect(row.locator('input[aria-label="Title"]')).toHaveCount(0)
  await a.page.keyboard.press('Control+z')
  await expect(queue(a).nth(2).locator('.t')).toHaveText(was)
  await a.page.keyboard.press('Escape')
})

test('A adds a task at the end of the queue', async () => {
  await a.page.keyboard.press('a')
  const field = page(a).locator('.q li.add input[aria-label="New task"]')
  await expect(field).toBeFocused()
  await field.fill('Paint the wing numbers')
  await field.press('Enter')
  await expect(toast(a)).toContainText('Added: Paint the wing numbers')
  await page(a).getByRole('button', { name: 'Show the rest of the queue' }).click()
  await expect(queue(a).last()).toContainText('Paint the wing numbers')
})

test('[ and ] move to the previous and next project; Esc still goes back to Pick up', async () => {
  await a.page.keyboard.press(']')
  await expect(page(a).locator('h1')).toHaveText('Inkwell')
  await a.page.keyboard.press('[')
  await expect(page(a).locator('h1')).toHaveText('Cloud Glide')
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.cont')).toBeVisible()
})

test('a write refused while an agent is writing: the toast says so and offers Try again', async () => {
  await a.app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('project.edit')
    ipcMain.handle('project.edit', () => ({ ok: false, error: { code: 'E_BUSY', message: 'BLIP.md kept changing while it was being written' } }))
  })
  await openGlide(a)
  await a.page.keyboard.press('x')
  await expect(toast(a)).toContainText('An agent is writing to this file. Nothing was changed. Try again in a moment.')
  await expect(toast(a).locator('.btn')).toHaveText('Try again')
  await expect(page(a).locator('.nextcard h2')).toHaveText(NEXT)
})

test('a 95-task project: five rows, then the rest in place; no position numbers; 95 only in the File fact', async () => {
  // a new world, with main's own project.edit
  await a.close()
  a = await launch({ demo: true, size: [1280, 800] })
  await a.page.emulateMedia({ reducedMotion: 'reduce' })
  const r = await record(a)
  const add = Array.from({ length: 95 - (r.doc?.tasks.open.length ?? 0) }, (_, i) => ({ op: 'task.add', title: `Stress the wing in wind speed ${i + 1}` }))
  const res = await a.page.evaluate(async ([id, ops]) => {
    const out = await window.radar.invoke('project.edit', { id, ops: ops as never })
    return out.ok ? out.data.record.doc?.tasks.open.length : out.error.message
  }, [r.id, add] as const)
  expect(res).toBe(95)
  await a.page.reload()
  await openGlide(a)
  await expect(queue(a)).toHaveCount(5)
  const body = () => page(a).innerText()
  expect((await body()).match(/\b9[45]\b/g)).toEqual(['95'])
  await expect(page(a).locator('.facts')).toContainText('95 open, 0 done')
  await page(a).getByRole('button', { name: 'Show the rest of the queue' }).click()
  await expect(queue(a)).toHaveCount(94)
  for (const t of await queue(a).locator('.t').allInnerTexts()) expect(t).not.toMatch(/^\d/)
  expect(await body()).not.toMatch(/\+\d+|overdue|\d+ (more|left|tasks)/i)
})

test('a 1,200-character legacy title: three lines and Show all, then whole', async () => {
  const LONG = `Rewrite the changelog page ${'and check every entry links to its release '.repeat(30)}`.slice(0, 1200).trimEnd()
  const r = await record(a)
  const file = join(r.dir, 'BLIP.md')
  writeFileSync(file, readFileSync(file, 'utf8').replace('# Tasks\n\n', `# Tasks\n\n- [ ] ${LONG}\n`))
  const h2 = page(a).locator('.nextcard h2')
  await expect(h2).toHaveText(LONG, { timeout: 15_000 })
  await expect(h2).toHaveClass(/clamp/)
  const lines = await h2.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
  expect(lines).toBe(3)
  await page(a).locator('.nextcard .more button').click()
  await expect(h2).not.toHaveClass(/clamp/)
  await expect(page(a).locator('.nextcard .more button')).toHaveText('Show less')
})
