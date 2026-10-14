// R6 (renderer spec 6.3, 6.7, 7, 13): the scope on the placeholder data set. The home panel names
// every focus project and the Continue project; the Scope view shares one selection with its list,
// hover marks both, the arrows move by bearing and by ring and Enter opens; bearings survive a
// restart; the labels' drawn widths are the advance table's; and nothing in the bundle animates.
import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, launch, makeWorld, type App } from './harness'
import { ADVANCE } from '../src/renderer/src/lib/scope'

let a: App
test.beforeAll(async () => {
  a = await launch({ demo: true, size: [1280, 800] })
  await a.page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(a.page.locator('.cont')).toBeVisible()
})
test.afterAll(async () => {
  await a?.close()
})

const blip = (a: App, name: string) => a.page.locator(`.stage .blip[aria-label^="${name},"]`)
const named = (a: App, sel: string) => a.page.locator(`${sel} text.lbl`).evaluateAll((ts) => ts.map((t) => t.firstChild?.textContent ?? ''))

test('the home panel names every focus project and the Continue project, at 1280 and at 1600', async () => {
  const focus = await a.page.evaluate(async () => {
    const list = await window.radar.invoke('projects.list')
    return list.ok ? list.data.projects.filter((r) => r.doc?.focus && !r.hidden).map((r) => r.doc!.name) : []
  })
  expect(focus.length).toBeGreaterThan(1)
  const cont = (await a.page.locator('.cont h2').innerText()).trim()
  for (const [w, h, sel] of [
    [1280, 800, '.panel .s-n'],
    [1600, 900, '.panel .s-w']
  ] as const) {
    await a.size(w, h)
    await expect(a.page.locator(sel)).toBeVisible()
    expect(await named(a, sel)).toEqual(expect.arrayContaining([...focus, cont]))
  }
  await a.size(1280, 800)
})

test('the panel is one link to the Scope, and 2 goes there too', async () => {
  await a.page.locator('.panel').click()
  await expect(a.page.locator('main h1')).toHaveText('Scope')
  await a.page.keyboard.press('1')
  await a.page.keyboard.press('2')
  await expect(a.page.locator('.stage svg.scope')).toBeVisible()
})

test('a blip and its list row are one selection, and hovering either marks both', async () => {
  await a.page.keyboard.press('2')
  await a.page.locator('.sl button', { hasText: 'Cloud Glide' }).click()
  await expect(a.page.locator('.stage .blip.is-sel text.lbl')).toHaveText(/^Cloud Glide/)
  await expect(a.page.locator('.readout .nm')).toHaveText('Cloud Glide')
  await blip(a, 'Sketchpad').locator('.hit').click()
  await expect(a.page.locator('.sl button.on')).toHaveText(/Sketchpad/)
  // a list row marks its blip; the readout above the list keeps the selection, so the rows never move under the pointer
  await a.page.locator('.sl button', { hasText: 'Marble Racer' }).hover()
  await expect(a.page.locator('.stage .blip.hov text.lbl')).toHaveText(/^Marble Racer/)
  await expect(a.page.locator('.readout .nm')).toHaveText('Sketchpad')
  // a blip marks its row and shows in the readout
  await blip(a, 'Link Jar').locator('.hit').hover()
  await expect(a.page.locator('.sl button.hov')).toHaveText(/Link Jar/)
  await expect(a.page.locator('.readout .nm')).toHaveText('Link Jar')
  await a.page.mouse.move(0, 790)
  // the selection is Pick up's too
  await a.page.keyboard.press('1')
  await expect(a.page.locator('.row.sel .nm')).toHaveText('Sketchpad')
  await a.page.keyboard.press('Escape')
})

test('the arrows move by bearing and by ring, Enter opens and Esc lets go', async () => {
  await a.page.keyboard.press('2')
  // Esc lets a selection go; with none it would go back
  if (await a.page.locator('.stage .blip.is-sel').count()) await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.stage .blip.is-sel')).toHaveCount(0)
  await a.page.keyboard.press('ArrowRight')
  const first = await a.page.locator('.stage .blip.is-sel').getAttribute('data-blip')
  expect(first).toBeTruthy()
  const seen = new Set<string>([first!])
  const total = await a.page.locator('.stage .blip').count()
  for (let i = 1; i < total; i++) {
    await a.page.keyboard.press('ArrowRight')
    seen.add((await a.page.locator('.stage .blip.is-sel').getAttribute('data-blip'))!)
  }
  expect(seen.size).toBe(total)
  await a.page.keyboard.press('ArrowRight')
  await expect(a.page.locator('.stage .blip.is-sel')).toHaveAttribute('data-blip', first!)
  await a.page.keyboard.press('ArrowDown')
  await expect(a.page.locator('.stage .blip.is-sel')).not.toHaveAttribute('data-blip', first!)
  const name = (await a.page.locator('.sl button.on').innerText()).split('\n')[0].trim()
  await a.page.keyboard.press('Enter')
  await expect(a.page.locator('.detail .title h1')).toHaveText(name)
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('main h1')).toHaveText('Scope')
  await a.page.keyboard.press('Escape')
  await expect(a.page.locator('.stage .blip.is-sel')).toHaveCount(0)
})

test('every label is as wide as the advance table says (IBM Plex Mono, 0.6em a glyph)', async () => {
  for (const [w, h] of [
    [900, 640],
    [1280, 800],
    [1600, 900]
  ] as const) {
    await a.size(w, h)
    await a.page.keyboard.press('2')
    const off = await a.page.locator('svg.scope text.lbl').evaluateAll(
      (ts, adv) =>
        ts
          .filter((t) => (t as SVGTextElement).getBBox().width > 0)
          .map((t) => {
            const el = t as SVGTextElement
            const name = el.firstChild?.textContent ?? ''
            const px = Number(el.getAttribute('font-size'))
            return { name, diff: Math.abs(el.getSubStringLength(0, name.length) - name.length * px * adv) }
          })
          .filter((x) => x.diff > 0.5),
      ADVANCE
    )
    expect(off).toEqual([])
  }
  await a.size(1280, 800)
})

test('no count of undone work and no overdue on the Scope', async () => {
  await a.page.keyboard.press('2')
  const texts = await a.page.locator('main *').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
  for (const t of texts) {
    expect(t).not.toMatch(/\d+ (open|more|tasks|unlogged|left)/)
    expect(t).not.toMatch(/\+\d+/)
    expect(t).not.toMatch(/overdue/i)
  }
})

test('bearings are kept: every blip keeps its stored slot and its angle after a restart', async () => {
  await a.page.keyboard.press('2')
  // the angle alone: a dot's distance follows the clock, so its position drifts between launches
  const angles = () =>
    a.page.locator('.stage svg.scope').evaluate((svg) => {
      const disc = svg.querySelector('.disc')!
      const [cx, cy] = [Number(disc.getAttribute('cx')), Number(disc.getAttribute('cy'))]
      return Object.fromEntries(
        [...svg.querySelectorAll('.blip')].map((g) => {
          const dot = g.querySelector('.dot')!
          const [x, y] = [Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))]
          return [g.getAttribute('data-blip')!, (Math.atan2(x - cx, cy - y) * 180) / Math.PI]
        })
      )
    })
  const bearings = () => a.page.evaluate(() => JSON.parse(localStorage.getItem('radar.v3') ?? '{}').bearings as Record<string, number>)
  const before = await angles()
  const stored = await bearings()
  for (const id of Object.keys(before)) expect(stored[id], id).toBeGreaterThanOrEqual(0)
  await a.close()
  a = await launch({ world: a.world, size: [1280, 800] })
  await a.page.emulateMedia({ reducedMotion: 'reduce' })
  await a.page.keyboard.press('2')
  await expect(a.page.locator('.stage .blip')).toHaveCount(Object.keys(before).length)
  expect(await bearings()).toEqual(stored)
  const after = await angles()
  for (const [id, deg] of Object.entries(before)) expect(Math.abs(after[id] - deg), id).toBeLessThan(0.5)
})

test('keyboard focus on a blip outlines its label plate and fills it, and draws no ring round the dot', async () => {
  await a.page.keyboard.press('2')
  await blip(a, 'Cloud Glide').focus()
  // an arrow moves the focus on, as a keyboard user walks the blips
  await a.page.keyboard.press('ArrowRight')
  const st = await a.page.evaluate(() => {
    const g = document.activeElement as SVGGElement
    const cs = (sel: string) => {
      const el = g.querySelector(sel)
      return el ? getComputedStyle(el) : null
    }
    return {
      blip: g.matches('.stage .blip:focus-visible'),
      label: !!g.querySelector('.plate'),
      hit: cs('.hit')!.stroke,
      plate: cs('.plate') && [cs('.plate')!.fill, cs('.plate')!.stroke, cs('.plate')!.strokeWidth],
      fsq: cs('.fsq') && [cs('.fsq')!.stroke, cs('.fsq')!.strokeWidth]
    }
  })
  expect(st.blip).toBe(true)
  expect(st.hit).toBe('none')
  if (st.label) {
    expect(st.plate![0]).not.toBe('rgba(0, 0, 0, 0)')
    expect(st.plate![1]).not.toBe('none')
    expect(st.plate![2]).toBe('2px')
  } else expect(st.fsq).toEqual([expect.not.stringMatching(/^none$/), '2px'])
  await a.page.keyboard.press('Escape')
})

test('the note is a rectangle the labels keep off, and under 1180 it still names what was tucked away', async () => {
  const b = await launch({ world: makeWorld({ demo: true, extra: true }), size: [900, 640] })
  try {
    await b.page.emulateMedia({ reducedMotion: 'reduce' })
    await b.page.keyboard.press('2')
    for (const [w, h] of [
      [900, 640],
      [1181, 760],
      [1280, 800]
    ] as const) {
      await b.size(w, h)
      await expect(b.page.locator('.stage svg.scope')).toBeVisible()
      const r = await b.page.evaluate(() => {
        const box = (el: Element) => el.getBoundingClientRect()
        const blips = document.querySelectorAll('.stage .blip').length
        const labels = [...document.querySelectorAll('.stage .plate')].map(box)
        const note = document.querySelector('.sc-note')!
        const tuck = document.querySelector('.sc-note .tuck')
        const n = box(note)
        const hit = labels.filter((l) => n.height > 0 && l.left < n.right && l.right > n.left && l.top < n.bottom && l.bottom > n.top).length
        return { blips, labels: labels.length, tuck: tuck ? box(tuck).height > 0 : false, hit }
      })
      expect(r.hit, `${w}x${h}`).toBe(0)
      expect(r.tuck, `${w}x${h}: ${r.labels} labels for ${r.blips} blips`).toBe(r.labels < r.blips)
    }
  } finally {
    await b.close()
  }
})

test('nothing in the bundle animates: no keyframes, no animation and no requestAnimationFrame', () => {
  const dir = join(ROOT, 'out', 'renderer', 'assets')
  const files = readdirSync(dir).filter((f) => /\.(js|css)$/.test(f))
  expect(files.some((f) => f.endsWith('.css'))).toBe(true)
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8')
    expect(text, f).not.toMatch(/requestAnimationFrame|@keyframes|\.animate\(/)
    // React's event table names the animation events; no style may use one
    if (f.endsWith('.css')) expect(text, f).not.toMatch(/animation/)
  }
})
