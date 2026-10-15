// R3 (renderer spec 13): the Pick up list on the placeholder data set. No count of undone work
// and no overdue anywhere on the view, every row carries its whole next step (the Continue
// project's in the strip above its row), J and K select and expand a row, its actions act, and
// the one-line density keeps every chip on the title's first line.
import { expect, test } from '@playwright/test'
import { launch, type App } from './harness'

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true, size: [1280, 800] })
  await a.page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(a.page.locator('.row').first()).toBeVisible()
})
test.afterAll(async () => {
  await a?.close()
})

const rows = (a: App) => a.page.locator('.row')
const selected = (a: App) => a.page.locator('.row.sel')

/** The next steps as a row shows them: the owner's prefix is the `you` chip. */
async function nextSteps(a: App): Promise<Record<string, string>> {
  return a.page.evaluate(async () => {
    const [list, info] = await Promise.all([window.radar.invoke('projects.list'), window.radar.invoke('app.info')])
    if (!list.ok || !info.ok) throw new Error('route failed')
    const prefix = info.data.owner ? `${info.data.owner.toLowerCase()}:` : null
    const out: Record<string, string> = {}
    for (const r of list.data.projects) {
      const t = r.doc?.next?.title
      if (t) out[r.id] = prefix && t.toLowerCase().startsWith(prefix) ? t.slice(prefix.length).trimStart() : t
    }
    return out
  })
}

for (const [w, h, density] of [
  [900, 640, 'comfortable'],
  [1280, 800, 'comfortable'],
  [1600, 900, 'comfortable'],
  [1280, 800, 'one-line']
] as const) {
  test(`${w}x${h} ${density}: no count of undone work, no overdue, and every next step whole`, async () => {
    await a.size(w, h)
    const oneLine = a.page.getByRole('radio', { name: /One line/ })
    if ((await oneLine.getAttribute('aria-checked')) !== String(density === 'one-line')) await a.page.keyboard.press('d')
    await a.page.keyboard.press('j')
    const view = await a.page.locator('body').innerText()
    expect(view).not.toMatch(/\d+ (open|more|tasks|unlogged|left)/)
    expect(view).not.toMatch(/\+\d+/)
    expect(view).not.toMatch(/overdue/i)
    // every element's own text too, as innerText leaves out what CSS hides
    const texts = await a.page.locator('main *').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    for (const t of texts) {
      expect(t).not.toMatch(/\d+ (open|more|tasks|unlogged|left)/)
      expect(t).not.toMatch(/\+\d+/)
      expect(t).not.toMatch(/overdue/i)
    }
    const steps = await nextSteps(a)
    // the Continue project's own row says "Continued above": the strip carries its next step
    const shown = await rows(a).evaluateAll((els) =>
      els.map((e) => [(e as HTMLElement).dataset.id ?? '', (e.classList.contains('c0') ? (document.querySelector('.cont') as HTMLElement) : (e as HTMLElement)).innerText] as const)
    )
    expect(shown.length).toBeGreaterThan(15)
    let checked = 0
    for (const [id, text] of shown) {
      if (!steps[id]) continue
      expect(text.replace(/\s+/g, ' '), id).toContain(steps[id].replace(/\s+/g, ' '))
      checked++
    }
    expect(checked).toBeGreaterThan(15)
    await a.page.keyboard.press('Escape')
    if (density === 'one-line') await a.page.keyboard.press('d')
  })
}

test('one line: every row is one line unless its title wraps, and its chips stay on the first line', async () => {
  await a.size(1280, 800)
  await a.page.keyboard.press('d')
  const bad = await a.page.locator('.row').evaluateAll((els) =>
    els.flatMap((row) => {
      const t = row.querySelector('.nx .t') as HTMLElement | null
      if (!t) return []
      const tr = t.getBoundingClientRect()
      const rr = row.getBoundingClientRect()
      const out: string[] = []
      if (rr.height > tr.height + 2 + 1) out.push(`${(row as HTMLElement).dataset.id}: row ${rr.height} > title ${tr.height}`)
      for (const c of row.querySelectorAll('.nx .chip')) {
        const cr = c.getBoundingClientRect()
        if (cr.width && cr.top > tr.top + 14) out.push(`${(row as HTMLElement).dataset.id}: chip off line 1`)
      }
      return out
    })
  )
  expect(bad).toEqual([])
  await a.page.keyboard.press('d')
})

test('J and K select a row; it expands with its actions; K from the first row selects nothing', async () => {
  await a.size(1280, 800)
  await expect(selected(a)).toHaveCount(0)
  await a.page.keyboard.press('j')
  await expect(selected(a)).toHaveCount(1)
  const first = await rows(a).first().getAttribute('data-id')
  await expect(selected(a)).toHaveAttribute('data-id', first as string)
  await a.page.keyboard.press('ArrowDown')
  await expect(selected(a)).not.toHaveAttribute('data-id', first as string)
  const name = await selected(a).locator('.nm').innerText()
  await expect(a.page.locator('.foot')).toContainText(`open ${name}`)
  await expect(selected(a).locator('.acts .btn')).toHaveText([/^Open/, /^Resume/, /^Copy re-entry prompt/, /^Mark next step done/, /^Not now/])
  await expect(a.page.locator('.btn.pri')).toHaveCount(1)
  await a.page.keyboard.press('k')
  await a.page.keyboard.press('k')
  await expect(selected(a)).toHaveCount(0)
  await a.page.keyboard.press('j')
  await a.page.keyboard.press('Escape')
  await expect(selected(a)).toHaveCount(0)
})

test('a click selects; Enter opens the project page and Esc comes back to the same selection', async () => {
  const row = a.page.locator('.row[data-id]').nth(3)
  const id = (await row.getAttribute('data-id')) as string
  const name = await row.locator('.nm').innerText()
  await row.click()
  await expect(selected(a)).toHaveAttribute('data-id', id)
  await a.page.keyboard.press('Enter')
  await expect(a.page.locator('main h1')).toHaveText(name)
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('main h1')).toHaveText('Pick up')
  await expect(selected(a)).toHaveAttribute('data-id', id)
  await a.page.keyboard.press('Escape')
})

test('X marks the next step done and N moves it down one, through the engine', async () => {
  const row = a.page.locator('.row', { hasText: 'Build the backup timeline panel on the rack page' })
  await row.click()
  await a.page.keyboard.press('n')
  await expect(selected(a).locator('.nx .t').first()).toHaveText('Walk the restore drill checklist and tick it through')
  await a.page.keyboard.press('x')
  await expect(selected(a).locator('.nx .t').first()).toHaveText('Build the backup timeline panel on the rack page')
  const doc = await a.page.evaluate(async (id) => {
    const res = await window.radar.invoke('projects.list')
    return res.ok ? res.data.projects.find((r) => r.id === id)?.doc : null
  }, await selected(a).getAttribute('data-id'))
  expect(doc?.tasks.done.map((t) => t.title)).toContain('Robin: Walk the restore drill checklist and tick it through')
  await a.page.keyboard.press('Escape')
})

test('under 1180 the selected row keeps its five buttons on one line', async () => {
  await a.size(900, 640)
  await a.page.locator('.row', { hasText: 'Harbor Lantern' }).first().click()
  const tops = await selected(a).locator('.acts .btn').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
  expect(tops).toHaveLength(5)
  expect(new Set(tops).size).toBe(1)
  await a.page.keyboard.press('Escape')
  await a.size(1280, 800)
})

// The list's own column at each size matches the mockup's (radar-design/final/shots/home-*), so
// Now lines and next steps wrap where the mockup's do: the window's scrollbar takes none of it.
for (const [w, h, main, cols, dense] of [
  [900, 640, 872, [20, 160, 92], [20, 160, 92]],
  [1280, 800, 904, [20, 186, 150], [20, 186, 112]],
  [1600, 900, 1000, [20, 200, 190], [20, 200, 120]]
] as const) {
  test(`${w}x${h}: the list and the row columns are the mockup's`, async () => {
    await a.size(w, h)
    const measure = () =>
      a.page.evaluate(() => {
        const m = document.querySelector('.home .main') as HTMLElement
        const cols = getComputedStyle(document.querySelector('.row') as HTMLElement).gridTemplateColumns.split(' ').map((c) => Math.round(parseFloat(c)))
        return { main: Math.round(m.getBoundingClientRect().width), cols: [cols[0], cols[1], cols[3]], scrolls: document.documentElement.scrollHeight > innerHeight }
      })
    const c = await measure()
    expect(c.scrolls).toBe(true)
    expect(c.main).toBe(main)
    expect(c.cols).toEqual(cols)
    const shown = async (sel: string) => a.page.locator(sel).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetWidth > 0).length)
    if (w < 1180) {
      expect(await shown('.grp .why')).toBe(0)
      expect(await shown('.row .mt .l2')).toBe(0)
    } else {
      expect(await shown('.grp .why')).toBeGreaterThan(0)
      expect(await shown('.row:not(.q1) .mt .l2')).toBeGreaterThan(0)
    }
    await a.page.keyboard.press('d')
    expect((await measure()).cols).toEqual(dense)
    await a.page.keyboard.press('d')
  })
}

test('Enter on a focused archived name opens that project, not the Continue one', async () => {
  await a.size(1280, 800)
  const btn = a.page.locator('.arch button', { hasText: 'Bus Stop' })
  await btn.focus()
  await a.page.keyboard.press('Enter')
  await expect(a.page.locator('main h1')).toHaveText('Bus Stop')
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('main h1')).toHaveText('Pick up')
})

test('with no row selected, X and N write nothing', async () => {
  await expect(selected(a)).toHaveCount(0)
  const tasks = () =>
    a.page.evaluate(async () => {
      const res = await window.radar.invoke('projects.list')
      return res.ok ? res.data.projects.map((r) => [r.id, r.doc?.tasks.open.map((t) => t.title), r.doc?.tasks.done.length]) : null
    })
  const before = await tasks()
  await a.page.keyboard.press('x')
  await a.page.keyboard.press('n')
  await a.page.waitForTimeout(500)
  expect(await tasks()).toEqual(before)
  await expect(a.page.locator('.foot')).not.toContainText('done')
})

test('double-clicking an action button on the selected row stays on Pick up', async () => {
  await a.page.locator('.row', { hasText: 'Homelab board' }).first().click()
  await selected(a).locator('.acts .btn', { hasText: 'Copy re-entry prompt' }).dblclick()
  await expect(a.page.locator('main h1')).toHaveText('Pick up')
  await a.page.keyboard.press('Escape')
})

test('L acts only on a project whose log is behind', async () => {
  const ids = await a.page.evaluate(async () => {
    const res = await window.radar.invoke('projects.list')
    const ps = res.ok ? res.data.projects.filter((r) => r.state === 'ok' && !r.hidden && r.doc?.status !== 'archived') : []
    return { ahead: ps.find((r) => !r.activity?.unlogged)?.id, behind: ps.find((r) => r.activity?.unlogged)?.id }
  })
  const clip = () => a.app.evaluate(({ clipboard }) => clipboard.readText())
  for (const [id, copies] of [
    [ids.ahead, false],
    [ids.behind, true]
  ] as const) {
    await a.app.evaluate(({ clipboard }) => clipboard.writeText('SENTINEL'))
    await a.page.locator(`#row-${id}`).click()
    await expect(selected(a).locator('.lag')).toHaveCount(copies ? 1 : 0)
    await a.page.keyboard.press('l')
    if (copies) await expect.poll(clip).toContain('the BLIP.md log is behind the work')
    else {
      await a.page.waitForTimeout(300)
      expect(await clip()).toBe('SENTINEL')
    }
    await a.page.keyboard.press('Escape')
  }
})

test('the v2 row keeps its read-only chip in both densities', async () => {
  const chip = a.page.locator('.row', { hasText: 'Trail maps' }).locator('.chip', { hasText: 'v2 · read-only' })
  await expect(chip.filter({ visible: true })).toHaveCount(1)
  await a.page.keyboard.press('d')
  await expect(chip.filter({ visible: true })).toHaveCount(1)
  await a.page.keyboard.press('d')
})

test('J moves focus to the list, whose active descendant is the selected row', async () => {
  await a.page.keyboard.press('j')
  // the option is the row's mark cell, named for the whole row
  const id = await selected(a).locator('[role=option]').getAttribute('id')
  expect(id).toBe(`opt-${await selected(a).getAttribute('data-id')}`)
  const lb = await a.page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    return { role: el.getAttribute('role'), ad: el.getAttribute('aria-activedescendant'), tab: el.tabIndex }
  })
  expect(lb).toEqual({ role: 'listbox', ad: id, tab: 0 })
  await a.page.keyboard.press('Escape')
  // with nothing selected the list lets go of focus, so no ring is left round it
  expect(await a.page.evaluate(() => document.activeElement?.getAttribute('role') ?? null)).toBeNull()
})
