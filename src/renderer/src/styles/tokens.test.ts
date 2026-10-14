// Renderer spec 1.1: the contrast table, recomputed from tokens.css. Text under 4.5 fails;
// display text and component boundaries under 3 fail. Translucent surfaces are composited
// first, as radar-design/final/_contrast.js does.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8')

function block(selector: RegExp): Record<string, string> {
  const m = selector.exec(css)
  if (!m) throw new Error(`no block for ${selector}`)
  const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]))
}
const dark = block(/^:root\s*\{/m)
const light = { ...dark, ...block(/^:root\[data-theme='light'\]\s*\{/m) }

type RGB = [number, number, number]
function rgba(v: string): { rgb: RGB; a: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(v)
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as RGB, a: 1 }
  const fn = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(v)
  if (fn) return { rgb: [+fn[1], +fn[2], +fn[3]], a: +fn[4] }
  if (v === 'transparent') return { rgb: [0, 0, 0], a: 0 }
  throw new Error(`not a colour: ${v}`)
}
const over = (fg: string, bg: RGB): RGB => {
  const { rgb, a } = rgba(fg)
  return rgb.map((c, i) => Math.round(c * a + bg[i] * (1 - a))) as RGB
}
const lum = (c: RGB): number => {
  const s = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]
}
const ratio = (a: RGB, b: RGB): number => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const SURFACES = ['bg', 'bg-1', 'bg-2', 'bg-3', 'zone', 'acc-wash over bg-1', 'scanline over bg-1'] as const
function surface(t: Record<string, string>, s: (typeof SURFACES)[number]): RGB {
  if (s === 'acc-wash over bg-1') return over(t['acc-wash'], rgba(t['bg-1']).rgb)
  if (s === 'scanline over bg-1') return over(t.scan, rgba(t['bg-1']).rgb)
  return rgba(t[s]).rgb
}

// The table in renderer spec 1.1, row by row, in the order of SURFACES. Its figures were rounded
// twice (to two places, then one), so a match is within 0.06.
const TABLE: Record<'dark' | 'light', Record<string, number[]>> = {
  dark: {
    fg: [18.4, 17.7, 16.8, 15.3, 17.2, 15.4, 16.4],
    'fg-2': [13.9, 13.4, 12.7, 11.6, 13.0, 11.6, 12.5],
    'fg-3': [9.3, 8.9, 8.5, 7.7, 8.7, 7.8, 8.3],
    'acc-ink': [15.1, 14.5, 13.8, 12.5, 14.1, 12.6, 13.5]
  },
  light: {
    fg: [16.6, 17.6, 15.2, 13.6, 16.0, 15.9, 17.6],
    'fg-2': [10.7, 11.4, 9.8, 8.8, 10.3, 10.3, 11.4],
    'fg-3': [6.3, 6.7, 5.8, 5.2, 6.1, 6.0, 6.7],
    'acc-ink': [6.0, 6.4, 5.5, 4.9, 5.8, 5.8, 6.4]
  }
}

describe('tokens.css', () => {
  it('defines the same tokens in both themes', () => {
    const own = block(/^:root\[data-theme='light'\]\s*\{/m)
    const colours = Object.keys(dark).filter((k) => !/^(display|mono|body|track|label-track|s\d|r\d|t-|ease)/.test(k))
    expect(Object.keys(own).sort()).toEqual(colours.sort())
    for (const k of ['zone', 'acc-fill', 'on-acc', 'acc-deep', 'scan', 'bar-1', 'bar-2']) expect(dark).toHaveProperty(k)
  })

  for (const [name, theme] of [
    ['dark', dark],
    ['light', light]
  ] as const) {
    describe(name, () => {
      for (const [text, row] of Object.entries(TABLE[name])) {
        it(`--${text} reads at 4.5 or more on every surface, as the spec's table says`, () => {
          SURFACES.forEach((s, i) => {
            const r = ratio(rgba(theme[text]).rgb, surface(theme, s))
            expect(r, `${text} on ${s}`).toBeGreaterThanOrEqual(4.5)
            expect(Math.abs(r - row[i]), `${text} on ${s}: ${r.toFixed(2)}, the spec says ${row[i]}`).toBeLessThanOrEqual(0.06)
          })
        })
      }

      it('text on the filled button reads at 4.5 or more', () => {
        const r = ratio(rgba(theme['on-acc']).rgb, rgba(theme['acc-fill']).rgb)
        expect(r).toBeGreaterThanOrEqual(4.5)
        expect(r).toBeCloseTo(name === 'dark' ? 14.2 : 6.4, 0)
      })

      it('green marks and the filled button stand out from the window at 3 or more', () => {
        for (const s of ['bg', 'bg-1'] as const) expect(ratio(rgba(theme.acc).rgb, rgba(theme[s]).rgb), `acc on ${s}`).toBeGreaterThanOrEqual(3)
        expect(ratio(rgba(theme['acc-fill']).rgb, rgba(theme.bg).rgb)).toBeGreaterThanOrEqual(3)
      })
    })
  }
})
