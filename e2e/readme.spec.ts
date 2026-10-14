// The README's screenshots (renderer spec 13, R9), from the built app on the placeholder data set:
// Pick up, the project page, the Scope and the Log in dark, and Pick up in light, at 1280x800, into
// docs/screenshots. Skipped unless RADAR_README_SHOTS is set.
import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, mockupBearings, ROOT } from './harness'

test.skip(!process.env.RADAR_README_SHOTS, 'set RADAR_README_SHOTS to write docs/screenshots')

test('README screenshots', async () => {
  const out = join(ROOT, 'docs', 'screenshots')
  mkdirSync(out, { recursive: true })
  const a = await launch({ demo: true })
  try {
    const { page } = a
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mockupBearings(page)
    // last here three days ago, so Pick up has its digest, as the mockup does
    await page.evaluate(() => {
      const d = new Date()
      d.setDate(d.getDate() - 3)
      d.setHours(12, 0, 0, 0)
      addEventListener('beforeunload', () =>
        localStorage.setItem('radar.v3', JSON.stringify({ ...JSON.parse(localStorage.getItem('radar.v3') ?? '{}'), lastOpenedAt: d.getTime() }))
      )
    })
    await page.reload()
    await page.locator('.cont').waitFor()
    if (await page.evaluate(() => document.documentElement.dataset.theme === 'light')) await page.keyboard.press('t')
    await a.size(1280, 800)
    const shot = async (name: string): Promise<void> => {
      await page.mouse.move(0, 799)
      await page.screenshot({ path: join(out, `${name}.png`) })
    }

    await shot('pick-up')
    // the project page: Cloud Glide with its first queue row open, nothing selected
    await page.locator('.row', { hasText: 'Cloud Glide' }).first().click()
    await page.keyboard.press('Enter')
    await page.locator('.detail .q li[id^="task-"]').first().waitFor()
    await page.keyboard.press('Space')
    await page.locator('.detail .q li.open.sel').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.detail .q li.sel').waitFor({ state: 'detached' })
    await page.evaluate(() => scrollTo(0, 0))
    await shot('project-page')
    await page.keyboard.press('Escape')
    // the Scope with Cloud Glide selected
    await page.keyboard.press('2')
    await page.locator('.sl button', { hasText: 'Cloud Glide' }).click()
    await shot('scope')
    await page.keyboard.press('Escape')
    // the Log: every project's entries, newest first
    await page.keyboard.press('3')
    await page.locator('.logpage .ent').first().waitFor()
    await page.evaluate(() => scrollTo(0, 0))
    await shot('log')
    await page.keyboard.press('1')
    if (await page.locator('.row.sel').count()) await page.keyboard.press('Escape')
    await page.keyboard.press('t')
    await page.evaluate(() => scrollTo(0, 0))
    await shot('pick-up-light')
  } finally {
    await a.close()
  }
})
