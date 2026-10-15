// R4 (renderer spec 13): the Continue strip, Pick one for me, the digest and Resume on the
// placeholder data set. One filled button whether nothing is selected, a row is, or the popover
// is open; Pick walks pickOrder from [1] and never shows [0]; the strip stays 158px (152 under
// 1180) with an 80-character title and eight detail lines, and the title stays whole.
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, type App } from './harness'

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true, size: [1280, 800] })
  await a.page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(a.page.locator('.cont')).toBeVisible()
  // Resume opens an editor: here it answers as if it had opened the folder, so no window opens
  await a.app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('system.openInEditor')
    ipcMain.handle('system.openInEditor', () => ({ ok: true, data: { opened: 'folder' } }))
  })
})
test.afterAll(async () => {
  await a?.close()
})

const filled = (a: App) => a.page.locator('.btn.pri').filter({ visible: true })
const strip = (a: App) => a.page.locator('.cont')
const clip = (a: App) => a.app.evaluate(({ clipboard }) => clipboard.readText())
const toast = (a: App) => a.page.locator('.toast')

test('the strip shows the project last worked on, and Open is filled while an agent is in there', async () => {
  await expect(strip(a).locator('h2')).toHaveText('Tidewatch')
  await expect(strip(a)).toContainText('session live')
  await expect(strip(a).locator('.c2 .lab')).toHaveText('Next step · an agent is in here now')
  await expect(strip(a).locator('.btn')).toHaveText([/^Open/, /^Copy re-entry prompt/, /^Pick one for me/])
  await expect(filled(a)).toHaveCount(1)
  await expect(filled(a)).toHaveText(/^Open/)
  await expect(a.page.locator('.rule')).toHaveText('Order: last worked on, then your pins, then this week.')
  // its own row says so, once
  await expect(a.page.locator('.row.c0')).toHaveText(/Tidewatch\s*Continued above/)
})

test('exactly one filled button with nothing selected, a row selected, and the popover open', async () => {
  await expect(filled(a)).toHaveCount(1)
  await expect(strip(a).locator('.btn.pri')).toHaveCount(1)
  // nothing selected, the popover open: its Resume is the one
  await a.page.keyboard.press('p')
  await expect(a.page.locator('.pick')).toBeVisible()
  await expect(filled(a)).toHaveCount(1)
  await expect(a.page.locator('.pick .btn.pri')).toHaveText(/^Resume/)
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.pick')).toHaveCount(0)
  await a.page.locator('.row', { hasText: 'Homelab board' }).first().click()
  await expect(filled(a)).toHaveCount(1)
  await expect(a.page.locator('.row.sel .btn.pri')).toHaveCount(1)
  // the strip's first two buttons give their keys to the row; Pick one for me keeps P
  await expect(strip(a).locator('.btn').nth(0).locator('kbd')).toHaveCount(0)
  await expect(strip(a).locator('.btn').nth(1).locator('kbd')).toHaveCount(0)
  await expect(strip(a).locator('.btn').nth(2).locator('kbd')).toHaveText('P')
  await a.page.keyboard.press('p')
  await expect(a.page.locator('.pick')).toBeVisible()
  await expect(filled(a)).toHaveCount(1)
  await expect(a.page.locator('.pick .btn.pri')).toHaveText(/^Resume/)
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.pick')).toHaveCount(0)
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.row.sel')).toHaveCount(0)
  await expect(filled(a)).toHaveCount(1)
})

test('Pick walks pickOrder from the second project and never shows the Continue one', async () => {
  await a.page.keyboard.press('p')
  const seen: string[] = []
  for (let i = 0; i < 10 && (await a.page.locator('.pick').count()); i++) {
    seen.push(await a.page.locator('.pick h2').innerText())
    await a.page.keyboard.press('a')
  }
  // scripts/demo-data.mjs: Tidewatch > Homelab board > Harbor Lantern > Sketchpad > Cloud Glide
  expect(seen).toEqual(['Homelab board', 'Harbor Lantern', 'Sketchpad', 'Cloud Glide'])
  await expect(toast(a)).toHaveText('That is everything from this week.')
})

test('the reason names the place in the order and what the step costs to start', async () => {
  await a.page.keyboard.press('p')
  await expect(a.page.locator('.pick .why')).toHaveText('Why this one. It is your most recent focus pin after Tidewatch, and an agent can start its next step.')
  await a.page.keyboard.press('a')
  await expect(a.page.locator('.pick .why')).toHaveText('Why this one. It is your next focus pin, and its next step needs you.')
  await a.page.keyboard.press('a')
  await expect(a.page.locator('.pick .why')).toContainText('No focus pins left. It is the most recent project this week')
  await expect(a.page.locator('.pick .rule')).toContainText('One order: the project last worked on')
  await a.page.keyboard.press('Escape')
})

test('Enter in the popover resumes its project and closes; focus goes back', async () => {
  await a.app.evaluate(({ clipboard }) => clipboard.writeText('SENTINEL'))
  await a.page.locator('.cont .pickbtn').click()
  await expect(a.page.locator('.pick h2')).toHaveText('Homelab board')
  await expect(a.page.locator('.pick')).toBeFocused()
  await a.page.keyboard.press('Enter')
  await expect(a.page.locator('.pick')).toHaveCount(0)
  await expect.poll(() => clip(a)).toContain('Pick up Homelab board in ')
  await expect(toast(a)).toHaveText('Re-entry prompt copied. Homelab board is open in its folder.')
  await expect(a.page.locator('.cont .pickbtn')).toBeFocused()
  // nothing moved: Pick wrote nothing
  await expect(strip(a).locator('h2')).toHaveText('Tidewatch')
})

test("C copies the Continue project's re-entry prompt and says so", async () => {
  await a.page.keyboard.press('c')
  await expect.poll(() => clip(a)).toContain('Pick up Tidewatch in ')
  expect(await clip(a)).toContain('Next step: Build the small widget on feat/widget-view')
  await expect(toast(a)).toHaveText('Re-entry prompt copied. Paste it into your agent.')
})

test('one-line density: the strip is the Continue row, 40px, and the list does not repeat it', async () => {
  await a.page.keyboard.press('d')
  const h = await strip(a).evaluate((el) => el.getBoundingClientRect().height)
  expect(Math.round(h)).toBe(40)
  await expect(strip(a).locator('.btn').filter({ visible: true })).toHaveText([/^Open/])
  await expect(a.page.locator('.row', { hasText: 'Tidewatch' })).toHaveCount(0)
  await a.page.keyboard.press('j')
  await expect(a.page.locator('.row.sel .nm')).toHaveText('Homelab board')
  await a.page.keyboard.press('Escape')
  await a.page.keyboard.press('d')
})

test('the digest lists what moved since the last visit, never the Continue project; under 1180 it is one line', async () => {
  const opened = await a.page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() - 3)
    const at = d.getTime()
    addEventListener('beforeunload', () => localStorage.setItem('radar.v3', JSON.stringify({ ...JSON.parse(localStorage.getItem('radar.v3') ?? '{}'), lastOpenedAt: at })))
    return at
  })
  await a.page.reload()
  await expect(a.page.locator('.rail .dig')).toBeVisible()
  const weekday = await a.page.evaluate((at) => new Date(at).toLocaleDateString('en-GB', { weekday: 'long' }), opened)
  await expect(a.page.locator('.rail .dig .dh')).toHaveText(`Since you were last here${weekday}`)
  const names = await a.page.locator('.rail .dig li b').allInnerTexts()
  expect(names.length).toBeGreaterThan(0)
  expect(names.length).toBeLessThanOrEqual(4)
  expect(names).toContain('Homelab board')
  expect(names).not.toContain('Tidewatch')
  await expect(a.page.locator('.since')).toBeHidden()
  await a.size(900, 640)
  await expect(a.page.locator('.rail')).toBeHidden()
  const since = a.page.locator('.since')
  await expect(since).toContainText(`Since ${weekday}: Homelab board`)
  await expect(since).toHaveAttribute('aria-expanded', 'false')
  await since.click()
  await expect(since).toHaveAttribute('aria-expanded', 'true')
  await expect(a.page.locator('.dig.inl li')).toHaveCount(names.length)
  await since.click()
  await a.size(1280, 660)
  await expect(a.page.locator('.since')).toBeVisible()
  await expect(a.page.locator('.rail .dig')).toBeHidden()
  await a.size(1280, 800)
})

const TITLE = 'Rebuild the small widget from the size list so each size reads in a short glance'
const DETAIL = Array.from({ length: 8 }, (_, i) => `Detail line ${i + 1}: check docs/widget-sizes.md size ${i + 1} on a real lock screen.`)

test('the strip stays 158px (152 under 1180) with an 80-character title and eight detail lines, and the title stays whole', async () => {
  expect(TITLE).toHaveLength(80)
  const res = await a.page.evaluate(
    async ([title, detail]) => {
      const list = await window.radar.invoke('projects.list')
      const r = list.ok ? list.data.projects.find((p) => p.doc?.name === 'Tidewatch') : null
      if (!r?.doc?.next) return 'no Tidewatch'
      const out = await window.radar.invoke('project.edit', { id: r.id, ops: [{ op: 'task.edit', task: { title: r.doc.next.title }, title, detail }] })
      return out.ok ? 'ok' : out.error.message
    },
    [TITLE, DETAIL] as const
  )
  expect(res).toBe('ok')
  // an edit's answer goes to the caller, not out as an event: the board reads the list again
  await a.page.reload()
  await expect(strip(a).locator('h3')).toHaveText(TITLE)
  for (const [w, h, height] of [
    [1280, 800, 158],
    [900, 640, 152],
    [1600, 900, 158]
  ] as const) {
    await a.size(w, h)
    const m = await strip(a).evaluate((el) => {
      const box = el.getBoundingClientRect()
      const t = (el.querySelector('h3') as HTMLElement).getBoundingClientRect()
      return { height: box.height, titleInside: t.top >= box.top && t.bottom <= box.bottom - 1 }
    })
    if (process.env.RADAR_SHOTS_DIR) await strip(a).screenshot({ path: join(process.env.RADAR_SHOTS_DIR, `strip-80-${w}x${h}.png`) })
    expect(Math.round(m.height), `${w}x${h}`).toBe(height)
    expect(m.titleInside, `${w}x${h}`).toBe(true)
  }
  await a.size(1280, 800)
})

/** Edits one project through the engine and reloads the board; `touch` also writes a file in its folder, as work. */
async function editProject(a: App, name: string, ops: unknown[], touch = false): Promise<void> {
  const r = await a.page.evaluate(async (name) => {
    const list = await window.radar.invoke('projects.list')
    return list.ok ? (list.data.projects.find((p) => p.doc?.name === name) ?? null) : null
  }, name)
  expect(r, name).not.toBeNull()
  if (touch) writeFileSync(join(r!.dir, 'notes.md'), 'work\n')
  const res = await a.page.evaluate(
    async ([id, ops]) => {
      const out = await window.radar.invoke('project.edit', { id, ops: ops as never })
      if (!out.ok) return out.error.message
      await window.radar.invoke('activity.refresh', { ids: [id] })
      return 'ok'
    },
    [r!.id, ops] as const
  )
  expect(res).toBe('ok')
  await a.page.reload()
}

test('nothing in the way: the last project worked on, with no agent in it, has Resume filled', async () => {
  // Homelab board's activity is its file times, so a file written now makes it the project last worked on
  await editProject(a, 'Homelab board', [{ op: 'set', field: 'now', value: 'The rack page reads every node now. The backup timeline is next.' }], true)
  await expect(strip(a).locator('h2')).toHaveText('Homelab board')
  await expect(filled(a)).toHaveCount(1)
  await expect(strip(a).locator('.btn')).toHaveText([/^Resume/, /^Copy re-entry prompt/, /^Pick one for me/])
  await expect(strip(a).locator('.btn.pri')).toHaveText(/^Resume/)
  if (process.env.RADAR_SHOTS_DIR) await strip(a).screenshot({ path: join(process.env.RADAR_SHOTS_DIR, 'strip-resume-1280x800.png') })
})

test('waiting: the strip still shows it, with the waiting chip, and Pick one for me takes the fill', async () => {
  await editProject(a, 'Homelab board', [{ op: 'set', field: 'status', value: 'blocked' }])
  await expect(strip(a).locator('h2')).toHaveText('Homelab board')
  await expect(strip(a).locator('.chip')).toHaveText('waiting')
  await expect(filled(a)).toHaveCount(1)
  await expect(strip(a).locator('.btn')).toHaveText([/^Open/, /^Copy re-entry prompt/, /^Pick one for me/])
  await expect(strip(a).locator('.btn.pri')).toHaveText(/^Pick one for me/)
  if (process.env.RADAR_SHOTS_DIR) await strip(a).screenshot({ path: join(process.env.RADAR_SHOTS_DIR, 'strip-waiting-1280x800.png') })
  // a waiting project is never dealt: Pick starts on the first pin that is not waiting
  await a.page.keyboard.press('p')
  await expect(a.page.locator('.pick h2')).toHaveText('Tidewatch')
  await a.page.keyboard.press('Escape')
})
