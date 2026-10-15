// R2 (renderer spec 13): the board store on the placeholder data set. The header names the
// project last worked on and the status bar says when activity was read.
import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { launch, worldEnv, makeWorld, type App } from './harness'

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true, size: [1280, 800] })
})
test.afterAll(async () => {
  await a?.close()
})

test('every demo project read its activity without an error', async () => {
  // A git that cannot read its config (a HOME past Windows' path limit) fails quietly into file times.
  const errors = await a.page.evaluate(async () => {
    const res = await window.radar.invoke('projects.list')
    return res.ok ? res.data.projects.filter((r) => r.activity?.error).map((r) => `${r.id}: ${r.activity?.error}`) : [res.error.message]
  })
  expect(errors).toEqual([])
})

test('the Pick up header names the project last worked on', async () => {
  await expect(a.page.locator('main .head p')).toHaveText(/^\w+ \d{1,2} \w+\. Last worked on: Tidewatch\.$/)
})

test('the status bar says when activity was read', async () => {
  await expect(a.page.locator('.foot .mono')).toHaveText(/^activity read \d\d:\d\d$/)
})

test('without git, the status bar warns at every width, in place of the read time', async () => {
  const world = makeWorld({ demo: true })
  const exe = process.platform === 'win32' ? 'git.exe' : 'git'
  const PATH = worldEnv(world)
    .PATH.split(delimiter)
    .filter((d) => !existsSync(join(d, exe)))
    .join(delimiter)
  const b = await launch({ world, env: { PATH }, size: [900, 640] })
  try {
    // at 900 the warning keeps its first words and its details; from 1180 it is whole
    await expect(b.page.locator('.foot .mono')).toHaveText('git was not found · details', { useInnerText: true })
    await b.size(1280, 800)
    await expect(b.page.locator('.foot .mono')).toHaveText('git was not found · recency is from file times · details', { useInnerText: true })
    await b.size(900, 640)
    await expect(b.page.locator('.foot .mono')).toBeVisible()
    // details: Settings, at its Setup section, where git reads not found (R8)
    await b.page.locator('.foot .mono button', { hasText: 'details' }).click()
    await expect(b.page.locator('#set-setup .setrow', { hasText: 'git' })).toContainText('not found')
    await expect(b.page.locator('.settings nav .on')).toHaveText('Setup')
  } finally {
    await b.close()
  }
})
