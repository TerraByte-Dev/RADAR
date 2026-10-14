// R8 (renderer spec 8, 8.1, 6.8, 13): first run completes against an empty registry, and Cancel on
// the diff step leaves settings.json byte-identical; a v2 project's page holds no control that
// writes; the 40-project world's broken and missing files on Pick up, their pages and Settings;
// Settings shows, hides and stops tracking. With $RADAR_SHOTS_DIR set, each screen this stage
// adds is shot at the spec's sizes in both themes.
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, makeWorld, type App } from './harness'

const out = process.env.RADAR_SHOTS_DIR
const SIZES: [number, number][] = [
  [900, 640],
  [1280, 800],
  [1600, 900]
]

async function shot(a: App, name: string, sizes: [number, number][] = SIZES): Promise<void> {
  if (!out) return
  for (const theme of ['dark', 'light'] as const) {
    const isLight = await a.page.evaluate(() => document.documentElement.dataset.theme === 'light')
    if (isLight !== (theme === 'light')) await a.page.keyboard.press('t')
    for (const [w, h] of sizes) {
      await a.size(w, h)
      await a.page.mouse.move(0, h - 1)
      await a.page.screenshot({ path: join(out, `${name}${theme === 'light' ? '-light' : ''}-${w}x${h}.png`) })
    }
  }
  const isLight = await a.page.evaluate(() => document.documentElement.dataset.theme === 'light')
  if (isLight) await a.page.keyboard.press('t')
  await a.size(1280, 800)
}

/** The folder picker answers `dir`, as if the owner had picked it. */
const pickFolder = (a: App, dir: string) =>
  a.app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as unknown as typeof dialog.showOpenDialog
  }, dir)

/** Routes that would leave the world answer here, and record that they were called. */
async function stubOutside(a: App): Promise<void> {
  await a.app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { calls: string[] }
    g.calls = []
    for (const [name, data] of [
      ['system.openInEditor', { opened: 'folder' }],
      ['system.reveal', {}],
      ['setup.path', { change: null, applied: true }]
    ] as const) {
      ipcMain.removeHandler(name)
      ipcMain.handle(name, (_e, req) => (g.calls.push(`${name} ${JSON.stringify(req ?? null)}`), { ok: true, data }))
    }
  })
}
const calls = (a: App) => a.app.evaluate(() => (globalThis as unknown as { calls: string[] }).calls)

test('first run completes against an empty registry; Cancel on the diff writes nothing', async () => {
  const w = makeWorld({ demo: true })
  // the demo's projects stay on disk; RADAR tracks none of them
  for (const f of readdirSync(w.data)) if (f.startsWith('registry')) rmSync(join(w.data, f), { force: true })
  // Claude Code is installed, with settings the owner wrote
  const claude = join(w.home, '.claude')
  mkdirSync(claude, { recursive: true })
  const settings = join(claude, 'settings.json')
  writeFileSync(settings, '{\n  "theme": "dark",\n  "permissions": { "allow": ["Bash(git status)"] }\n}\n')
  const before = readFileSync(settings)
  const a = await launch({ world: w, size: [1280, 800] })
  try {
    await a.page.emulateMedia({ reducedMotion: 'reduce' })
    await stubOutside(a)
    await pickFolder(a, w.projects)
    await expect(a.page.locator('.first h1')).toHaveText('Nothing on the scope yet.')
    // no status bar on first run, one filled button, the checklist from setup.status
    await expect(a.page.locator('.foot')).toHaveCount(0)
    await expect(a.page.locator('.btn.pri')).toHaveCount(1)
    await expect(a.page.locator('.chk li')).toHaveCount(5)
    await expect(a.page.locator('.chk li').nth(3)).toContainText('will add')
    await shot(a, 'first-run', [
      [1280, 800],
      [900, 640]
    ])

    // step 2: the diff, then Cancel
    await a.page.locator('.btn.pri', { hasText: 'Connect to Claude Code' }).click()
    await expect(a.page.locator('.first h1')).toHaveText('Here is exactly what RADAR will write.')
    await expect(a.page.locator('.diff .dh').first()).toContainText('settings.json')
    await expect(a.page.locator('.diff pre .add').first()).toBeVisible()
    await expect(a.page.locator('.diff .dh', { hasText: 'SKILL.md' })).toContainText('new file')
    await shot(a, 'first-run-diff', [
      [1280, 800],
      [900, 640]
    ])
    await a.page.locator('.btn', { hasText: 'Cancel' }).click()
    await expect(a.page.locator('.first h1')).toHaveText('Nothing on the scope yet.')
    expect(readFileSync(settings).equals(before)).toBe(true)
    expect(existsSync(join(claude, 'skills', 'blip', 'SKILL.md'))).toBe(false)

    // ↵ is the filled button: the diff again; Write these changes; the folder picker; the found list
    await a.page.keyboard.press('Enter')
    await expect(a.page.locator('.diff').first()).toBeVisible()
    await a.page.locator('.btn.pri', { hasText: 'Write these changes' }).click()
    await expect(a.page.locator('.first h1')).toContainText('Found ')
    expect(readFileSync(settings, 'utf8')).toContain('radar-blip')
    expect(readFileSync(settings, 'utf8')).toContain('"theme": "dark"')
    expect(existsSync(join(claude, 'skills', 'blip', 'SKILL.md'))).toBe(true)
    expect(await calls(a)).toContain('setup.path {"apply":true}')
    const n = await a.page.locator('.found [role=checkbox][aria-checked=true]').count()
    expect(n).toBe(6)
    await expect(a.page.locator('.found .fh')).toContainText('All ticked')
    await expect(a.page.locator('.found .ff')).toContainText('more · show all')
    await expect(a.page.locator('.first .fine')).toContainText('Claude Code is connected.')
    await shot(a, 'first-run-found', [
      [1280, 800],
      [900, 640]
    ])
    // untick one; it stays off the board
    await a.page.locator('.found [role=checkbox]').first().click()
    await expect(a.page.locator('.found .fh')).toContainText('Some unticked')
    await a.page.locator('.btn.pri', { hasText: 'Put them on the board' }).click()

    // the board: Pick up with its strip, and the status bar back
    await expect(a.page.locator('.cont')).toBeVisible()
    await expect(a.page.locator('.foot')).toBeVisible()
    // the board can show its first projects before discover.track has answered for all of them
    await expect
      .poll(() =>
        a.page.evaluate(async () => {
          const r = await window.radar.invoke('projects.list')
          return r.ok ? r.data.projects.length : -1
        })
      )
      .toBeGreaterThan(20)
  } finally {
    await a.close()
  }
})

test('a v2 project page holds no control that writes; Copy the command is its one filled button', async () => {
  const a = await launch({ demo: true, size: [1280, 800] })
  try {
    await a.page.emulateMedia({ reducedMotion: 'reduce' })
    await stubOutside(a)
    // every route that writes a project is recorded and refused
    await a.app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { calls: string[] }
      for (const name of ['project.edit', 'project.undo', 'project.setHidden', 'project.create', 'project.untrack']) {
        ipcMain.removeHandler(name)
        ipcMain.handle(name, (_e, req) => (g.calls.push(`${name} ${JSON.stringify(req ?? null)}`), { ok: false, error: { code: 'E_TEST', message: 'refused' } }))
      }
    })
    await a.page.locator('.row', { hasText: 'Trail maps' }).first().click()
    await a.page.keyboard.press('Enter')
    await expect(a.page.locator('.detail h1')).toHaveText('Trail maps')
    await expect(a.page.locator('.detail .banner')).toContainText('This project is still in the v2 format.')
    await expect(a.page.locator('.btn.pri')).toHaveCount(1)
    await expect(a.page.locator('.btn.pri')).toHaveText('Copy the command')
    await expect(a.page.locator('.detail [role=checkbox], .detail [role=switch], .detail select')).toHaveCount(0)
    await shot(a, 'state-v2-page')

    // press every control on the page but the crumb and the rail (which only move to another page)
    const controls = a.page.locator('.detail .body button:not(.crumb button), .detail .body [role=button], .detail .right button, .detail .right [role=button]')
    const count = await controls.count()
    expect(count).toBeGreaterThan(4)
    for (let i = 0; i < count; i++) {
      const c = controls.nth(i)
      if (!(await c.isVisible())) continue
      await c.click()
      await a.page.keyboard.press('Escape')
      if (!(await a.page.locator('.detail h1', { hasText: 'Trail maps' }).count())) {
        await a.page.locator('.row', { hasText: 'Trail maps' }).first().click()
        await a.page.keyboard.press('Enter')
      }
    }
    const writes = (await calls(a)).filter((c) => c.startsWith('project.'))
    expect(writes).toEqual([])
    expect(await a.app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/radar-blip|Pick up Trail maps/)
  } finally {
    await a.close()
  }
})

test('the 40-project world: a broken file on Pick up and its page; Settings shows, hides and stops tracking', async () => {
  const a = await launch({ world: makeWorld({ demo: true, extra: true }), size: [1280, 800] })
  const p: Page = a.page
  try {
    await p.emulateMedia({ reducedMotion: 'reduce' })
    await stubOutside(a)
    const row = p.locator('.row', { hasText: 'print-shop-api' }).first()
    await expect(row).toContainText('folder name')
    await expect(row).toContainText('read-only')
    await expect(row).toContainText('RADAR cannot read this BLIP.md')
    await expect(row).toContainText('Line 7:')
    // the missing file is in Settings only
    await expect(p.locator('.row', { hasText: 'Wedding site' })).toHaveCount(0)
    await row.click()
    // a read-only row does not expand
    await expect(p.locator('.row.sel .then')).toHaveCount(0)
    await p.keyboard.press('Enter')
    await expect(p.locator('.detail .banner')).toContainText('This BLIP.md could not be read. Line 7:')
    await expect(p.locator('.detail .nextcard')).toHaveCount(0)
    await expect(p.locator('.detail [aria-label=Queue]')).toHaveCount(0)
    await shot(a, 'state-repair-page')
    await p.locator('.detail .banner .btn', { hasText: 'Open in editor' }).click()
    expect((await calls(a)).some((c) => c.startsWith('system.openInEditor'))).toBe(true)
    await p.keyboard.press('Escape')

    // two projects hidden from the board, then Settings
    await p.evaluate(async () => {
      const list = await window.radar.invoke('projects.list')
      if (!list.ok) throw new Error('list')
      for (const r of list.data.projects) if (r.doc && ['Old portfolio', 'Tax helper'].includes(r.doc.name)) await window.radar.invoke('project.setHidden', { id: r.id, hidden: true })
    })
    await p.reload()
    await expect(p.locator('.cont')).toBeVisible()
    await p.keyboard.press('Control+,')
    const projects = p.locator('#set-projects')
    await expect(projects.locator('.setrow')).toHaveCount(3)
    await expect(projects.locator('.setrow', { hasText: 'Old portfolio' })).toContainText('hidden')
    await expect(projects.locator('.setrow', { hasText: 'wedding-site' })).toContainText('BLIP.md is not at')
    await expect(p.locator('.settings .btn.pri')).toHaveCount(0)
    await expect(p.locator('#set-setup .setrow')).toHaveCount(4)
    await expect(p.locator('#set-about')).toContainText('engine')
    await shot(a, 'settings')

    await projects.locator('.setrow', { hasText: 'Tax helper' }).locator('.btn', { hasText: 'Show on the board' }).click()
    await expect(p.locator('.toast')).toContainText('Tax helper is back on the board.')
    await projects.locator('.setrow', { hasText: 'wedding-site' }).locator('.btn', { hasText: 'Stop tracking' }).click()
    await expect(projects.locator('.setrow')).toHaveCount(1)
    await p.keyboard.press('1')
    await expect(p.locator('.row', { hasText: 'Tax helper' })).toHaveCount(1)
    await expect(p.locator('.row', { hasText: 'Old portfolio' })).toHaveCount(0)

    // Pick up of this world, the broken file's row in view
    await expect(p.locator('.toast')).toHaveCount(0, { timeout: 10_000 })
    await p.locator('.row', { hasText: 'print-shop-api' }).first().scrollIntoViewIfNeeded()
    await shot(a, 'state-pickup-40')
    await p.evaluate(() => scrollTo(0, 0))

    // Settings' appearance controls drive the same state as T and D
    await p.keyboard.press('Control+,')
    await p.locator('#set-appearance [role=radio]', { hasText: 'Light' }).click()
    await expect(p.locator('html')).toHaveAttribute('data-theme', 'light')
    await p.locator('#set-appearance [role=radio]', { hasText: 'Dark' }).click()
    await expect(p.locator('html')).not.toHaveAttribute('data-theme', 'light')
    // Run setup again opens the diff and Cancel goes back to Settings
    await p.locator('.btn', { hasText: 'Run setup again' }).click()
    await expect(p.locator('.first h1')).toHaveText('Here is exactly what RADAR will write.')
    await p.locator('.btn', { hasText: /^(Cancel|Back)$/ }).click()
    await expect(p.locator('.settings h1')).toHaveText('Settings')
  } finally {
    await a.close()
  }
})

/** The folder picker is closed without a folder. */
const cancelPicker = (a: App) =>
  a.app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as unknown as typeof dialog.showOpenDialog
  })

test('first run: the view keys wait, the diff marks what it removes and keeps Write in view, Esc goes back, and a cancelled picker after Write leaves the diff', async () => {
  const w = makeWorld({ demo: true })
  for (const f of readdirSync(w.data)) if (f.startsWith('registry')) rmSync(join(w.data, f), { force: true })
  const claude = join(w.home, '.claude')
  mkdirSync(claude, { recursive: true })
  const settings = join(claude, 'settings.json')
  writeFileSync(settings, '{\n  "theme": "dark",\n  "permissions": { "allow": ["Bash(git status)"] }\n}\n')
  const a = await launch({ world: w, size: [1280, 800] })
  const p = a.page
  try {
    await p.emulateMedia({ reducedMotion: 'reduce' })
    await stubOutside(a)
    const h1 = p.locator('.first h1')
    await expect(h1).toHaveText('Nothing on the scope yet.')
    // the view keys and Ctrl+, wait until something is tracked; the top bar keeps Pick up
    for (const key of ['3', '2', 'Control+,']) {
      await p.keyboard.press(key)
      await expect(h1).toHaveText('Nothing on the scope yet.')
      await expect(p.locator('.top .tabs [aria-current=page]')).toHaveText('Pick up')
    }

    // the diff: the removed line reads before what replaces it, styled apart from a kept line
    await p.keyboard.press('Enter')
    await expect(h1).toHaveText('Here is exactly what RADAR will write.')
    const del = p.locator('.diff pre .del').first()
    await expect(del).toContainText('"permissions"')
    const style = (l: typeof del) => l.evaluate((e) => `${getComputedStyle(e).color} ${getComputedStyle(e).backgroundColor} ${getComputedStyle(e).textDecorationLine}`)
    expect(await style(del)).not.toBe(await style(p.locator('.diff pre .ctx').first()))
    const lines = await p.locator('.diff').first().locator('pre span').allTextContents()
    const firstDel = lines.findIndex((l) => l.startsWith('-'))
    expect(firstDel).toBeLessThan(lines.findIndex((l) => l.startsWith('+  "permissions"')))
    // the one filled button is in the window without scrolling
    const box = await p.locator('.btn.pri', { hasText: 'Write these changes' }).boundingBox()
    expect(box && box.y + box.height).toBeLessThanOrEqual(800)
    // Esc is Cancel
    await p.keyboard.press('Escape')
    await expect(h1).toHaveText('Nothing on the scope yet.')

    // Write, then the picker closed without a folder: the diff is gone and the write is said
    await cancelPicker(a)
    await p.keyboard.press('Enter')
    await p.locator('.btn.pri', { hasText: 'Write these changes' }).click()
    await expect(p.locator('.toast')).toContainText('Setup is written.')
    await expect(h1).toHaveText('Nothing on the scope yet.')
    expect(readFileSync(settings, 'utf8')).toContain('radar-blip')
    expect((await calls(a)).filter((c) => c.startsWith('setup.path'))).toHaveLength(1)

    // the found step: both buttons on one row at 1280, and Esc goes back
    await pickFolder(a, w.projects)
    await p.keyboard.press('Enter')
    // setup.path answers here without changing PATH, so only that line is left to write
    await expect(h1).toHaveText('Here is exactly what RADAR will write.')
    await expect(p.locator('.diff .dh', { hasText: 'settings.json' })).toHaveCount(0)
    await p.locator('.btn', { hasText: 'Skip the hooks' }).click()
    await expect(h1).toContainText('Found ')
    const put = await p.locator('.btn', { hasText: 'Put them on the board' }).boundingBox()
    const another = await p.locator('.btn', { hasText: 'Pick another folder' }).boundingBox()
    expect(put?.y).toBe(another?.y)
    await p.keyboard.press('Escape')
    await expect(h1).toHaveText('Nothing on the scope yet.')
  } finally {
    await a.close()
  }
})

test('a broken or v2 file: the keys do only what the page draws, and a board with nothing on it offers no pick', async () => {
  const a = await launch({ world: makeWorld({ demo: true, extra: true }), size: [1280, 800] })
  const p: Page = a.page
  const clip = () => a.app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await p.emulateMedia({ reducedMotion: 'reduce' })
    await stubOutside(a)
    await a.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))

    // the broken file, selected on Pick up: C hands nothing to an agent
    await p.locator('.row', { hasText: 'print-shop-api' }).first().click()
    await p.keyboard.press('c')
    await p.keyboard.press('Enter')
    const banner = p.locator('.detail .banner')
    await expect(banner).toContainText('This BLIP.md could not be read. Line 7:')
    await expect(banner).not.toContainText('read-only until it is fixed')
    await expect(banner).not.toContainText(':)')
    await expect(p.locator('.detail .right')).not.toContainText('Catch-up prompt')
    await expect(p.locator('.detail .right')).not.toContainText('log entries')
    for (const key of ['c', 'r', 'l']) await p.keyboard.press(key)
    expect(await clip()).toBe('sentinel')
    expect((await calls(a)).some((c) => c.startsWith('system.openInEditor'))).toBe(false)
    await p.keyboard.press('Escape')

    // a v2 page draws no Resume, so R does nothing; C copies, as its button does
    await p.locator('.row', { hasText: 'Trail maps' }).first().click()
    await p.keyboard.press('Enter')
    await expect(p.locator('.detail h1')).toHaveText('Trail maps')
    await expect(p.locator('.detail .btn', { hasText: 'Resume' })).toHaveCount(0)
    await p.keyboard.press('r')
    expect((await calls(a)).some((c) => c.startsWith('system.openInEditor'))).toBe(false)
    await p.keyboard.press('c')
    expect(await clip()).toContain('Pick up Trail maps')
    await p.keyboard.press('Escape')

    // Settings: the section list follows the page as it scrolls
    await a.size(1280, 640)
    await p.keyboard.press('Control+,')
    await p.locator('.settings nav button', { hasText: 'Setup' }).click()
    await expect(p.locator('.settings nav .on')).toHaveText('Setup')
    await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    await expect(p.locator('.settings nav .on')).toHaveText('About')
    await p.evaluate(() => scrollTo(0, 0))
    await expect(p.locator('.settings nav .on')).toHaveText('Projects')
    await a.size(1280, 800)

    // every project hidden: nothing to pick, so no P hint and P does nothing
    await p.evaluate(async () => {
      const list = await window.radar.invoke('projects.list')
      if (!list.ok) throw new Error('list')
      for (const r of list.data.projects) if (r.state !== 'missing') await window.radar.invoke('project.setHidden', { id: r.id, hidden: true })
    })
    await p.reload()
    await expect(p.locator('.nothing')).toContainText('Nothing on the board. Hidden and missing projects are in Settings.')
    await expect(p.locator('.foot')).not.toContainText('pick one for me')
    await p.keyboard.press('p')
    await expect(p.locator('.toast')).toHaveCount(0)
    await expect(p.locator('.pop.pick')).toHaveCount(0)
  } finally {
    await a.close()
  }
})
