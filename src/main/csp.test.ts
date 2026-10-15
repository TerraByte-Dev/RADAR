import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The packaged page loads from file://, where only a meta tag can carry the policy (spec 8.7).
describe('the renderer CSP', () => {
  const html = readFileSync(resolve(__dirname, '../renderer/index.html'), 'utf8')
  const policy = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
  const directives = new Map(
    policy
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name, values])
  )

  it('is in index.html and keeps scripts to the app itself: no inline script, no eval, no plugins', () => {
    expect(directives.get('default-src')).toEqual(["'self'"])
    expect(directives.has('script-src')).toBe(false)
    expect(policy).not.toContain('unsafe-eval')
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('base-uri')).toEqual(["'none'"])
  })
})
