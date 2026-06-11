import { describe, expect, it } from 'vitest'
import { isClickableLink, normalizeLink, normalizeLinks } from './links'

describe('normalizeLink', () => {
  it('passes a plain URL string through (label = url)', () => {
    expect(normalizeLink('https://x.dev')).toEqual({ label: 'https://x.dev', url: 'https://x.dev' })
    expect(normalizeLink('   ')).toBeNull()
  })

  it('accepts the schema single-key {label: url} object form', () => {
    expect(normalizeLink({ Docs: 'https://x.dev/docs' })).toEqual({
      label: 'Docs',
      url: 'https://x.dev/docs'
    })
  })

  it('accepts an explicit {label, url} shape', () => {
    expect(normalizeLink({ label: 'Repo', url: 'https://github.com/x' })).toEqual({
      label: 'Repo',
      url: 'https://github.com/x'
    })
  })

  it('skips everything else', () => {
    expect(normalizeLink(42)).toBeNull()
    expect(normalizeLink(null)).toBeNull()
    expect(normalizeLink(undefined)).toBeNull()
    expect(normalizeLink(['https://x.dev'])).toBeNull()
    expect(normalizeLink({ a: 1 })).toBeNull() // single key, non-string value
    expect(normalizeLink({ a: 'x', b: 'y' })).toBeNull() // multi-key, not the {label, url} shape
  })
})

describe('normalizeLinks', () => {
  it('keeps every renderable entry — an all-object list no longer renders empty', () => {
    expect(normalizeLinks([{ Docs: 'https://d' }, { Spec: 'https://s' }])).toHaveLength(2)
    expect(normalizeLinks(['https://a', 7, { label: 'B', url: 'https://b' }])).toEqual([
      { label: 'https://a', url: 'https://a' },
      { label: 'B', url: 'https://b' }
    ])
  })

  it('returns [] for a non-list (hides the section)', () => {
    expect(normalizeLinks('not-a-list')).toEqual([])
    expect(normalizeLinks(undefined)).toEqual([])
    expect(normalizeLinks([{ a: 1 }])).toEqual([])
  })
})

describe('isClickableLink', () => {
  it('allows only http(s)/mailto — agent-written files cannot smuggle other schemes', () => {
    expect(isClickableLink('https://x.dev')).toBe(true)
    expect(isClickableLink('http://x.dev')).toBe(true)
    expect(isClickableLink('mailto:a@b.c')).toBe(true)
    expect(isClickableLink('file:///C:/Windows')).toBe(false)
    expect(isClickableLink('javascript:alert(1)')).toBe(false)
    expect(isClickableLink('not a url')).toBe(false)
  })
})
