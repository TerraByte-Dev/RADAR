// Renderer spec 1 and 13 (R1): no colour value outside tokens.css, and both faces come from
// files bundled with the app — no @font-face URL that leaves the bundle.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import type { Config } from 'tailwindcss'

const SRC = resolve(__dirname, '..')
const RENDERER = resolve(SRC, '..')
const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.(tsx?|css)$/.test(e.name) && !/\.test\.ts$/.test(e.name))
  .map((e) => join(e.parentPath, e.name))
  .concat(join(RENDERER, 'index.html'), join(RENDERER, '..', '..', 'tailwind.config.js'))
const tokens = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8')
/** A token's dark value, from the `:root` block. */
const dark = (name: string): string => new RegExp(`--${name}:\\s*(#[0-9a-f]+)`, 'i').exec(tokens.split(/:root\[data-theme/)[0])?.[1] ?? ''

describe('colour values', () => {
  it('appear only in tokens.css', () => {
    expect(files.length).toBeGreaterThan(10)
    const offenders: string[] = []
    for (const f of files) {
      if (f.endsWith('tokens.css')) continue
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/gi)) offenders.push(`${relative(RENDERER, f)}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('no CSS names a colour either', () => {
    expect(files.some((f) => f.endsWith('tailwind.config.js'))).toBe(true)
    const named = /:\s*[^;{}]*(white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|lime|navy|teal)/gi
    const offenders = files.filter((f) => f.endsWith('.css')).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(named)].map((m) => `${relative(RENDERER, f)}: ${m[0]}`))
    expect(offenders).toEqual([])
  })

  it("main's first paint and window controls are the dark --bg and --fg-3", () => {
    const main = readFileSync(join(RENDERER, '..', 'main', 'index.ts'), 'utf8')
    const overlay = /titleBarOverlay:\s*\{\s*color:\s*'([^']+)',\s*symbolColor:\s*'([^']+)'/.exec(main)
    const background = /backgroundColor:\s*'([^']+)'/.exec(main)
    expect(dark('bg')).toMatch(/^#/)
    expect([overlay?.[1], overlay?.[2], background?.[1]].map((c) => c?.toLowerCase())).toEqual([dark('bg'), dark('fg-3'), dark('bg')].map((c) => c.toLowerCase()))
  })
})

describe('fonts', () => {
  const FONTS = join(SRC, 'assets', 'fonts')
  const faces = files
    .filter((f) => f.endsWith('.css'))
    .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => ({ file: f, rule: m[0] })))

  it('bundles the seven faces and both licences', () => {
    const want = ['400', '500', '600'].flatMap((w) => [`IBMPlexMono-${w}.woff2`, `IBMPlexMono-${w}-arrows.woff2`]).concat('VT323-400.woff2', 'OFL-IBMPlexMono.txt', 'OFL-VT323.txt')
    expect(readdirSync(FONTS).sort()).toEqual(want.sort())
  })

  it('every @font-face source is one of those files, with font-display: block', () => {
    expect(faces).toHaveLength(7)
    for (const { file, rule } of faces) {
      expect(rule).toMatch(/font-display:\s*block/)
      const urls = [...rule.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1])
      expect(urls).toHaveLength(1)
      const target = resolve(dirname(file), urls[0])
      expect(dirname(target)).toBe(FONTS)
      expect(existsSync(target), urls[0]).toBe(true)
    }
  })

  it('nothing reaches for a font outside the bundle', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), relative(RENDERER, f)).not.toMatch(/@fontsource|fonts\.googleapis|fonts\.gstatic|url\(\s*['"]?(https?:)?\/\//)
    const pkg = JSON.parse(readFileSync(join(RENDERER, '..', '..', 'package.json'), 'utf8'))
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => d.startsWith('@fontsource/'))).toEqual([])
  })
})

describe('motion (rule 10)', () => {
  it('no animation loop and no keyframes anywhere in the renderer: transitions only', () => {
    // tailwind.config.js names `animation` only to empty Tailwind's set
    const offenders = files.filter((f) => !f.endsWith('tailwind.config.js')).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/requestAnimationFrame|@keyframes|\banimation\b|\.animate\(/g)].map((m) => `${relative(RENDERER, f)}: ${m[0]}`))
    expect(offenders).toEqual([])
  })

  /** Each transition declaration in the CSS that no prefers-reduced-motion: no-preference block holds. */
  const unguarded = (css: string): string[] => {
    const out: string[] = []
    // the blocks open at each point, innermost last
    const open: string[] = []
    let from = 0
    for (const m of css.matchAll(/[{}]|\btransition(-[a-z]+)?\s*:/g)) {
      if (m[0] === '{') open.push(css.slice(from, m.index).split(/[;}]/).pop()?.trim() ?? '')
      else if (m[0] === '}') open.pop()
      else if (!open.some((o) => /@media[^{]*prefers-reduced-motion:\s*no-preference/.test(o))) out.push(`${m[0]} at ${m.index} in ${open[open.length - 1]}`)
      from = (m.index ?? 0) + 1
    }
    return out
  }

  it('every transition sits inside prefers-reduced-motion: no-preference, and nothing scrolls smoothly (section 11)', () => {
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      if (/scroll-behavior:\s*smooth|behavior:\s*['"]smooth/.test(text)) offenders.push(`${relative(RENDERER, f)}: smooth scrolling`)
      if (f.endsWith('.css')) offenders.push(...unguarded(text).map((o) => `${relative(RENDERER, f)}: ${o}`))
    }
    expect(offenders).toEqual([])
  })

  it('Tailwind generates no transition utility, whatever words the source holds', async () => {
    const { default: postcss } = await import('postcss')
    const { default: tailwind } = await import('tailwindcss')
    const config = createRequire(__filename)(join(RENDERER, '..', '..', 'tailwind.config.js')) as Config
    const raw = '<div class="transition transition-colors transition-all duration-150 duration-fast ease-in-out ease-out delay-100">'
    const { css } = await postcss([tailwind({ ...config, content: [{ raw, extension: 'html' }] })]).process('@tailwind utilities;', { from: undefined })
    expect(unguarded(css)).toEqual([])
    expect(css).not.toMatch(/\.(transition|duration|ease|delay)/)
  })
})
