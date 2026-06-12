import { describe, it, expect } from 'vitest'
import { parseChannels, rgba, rgb, type Channels } from './radarColors'

const FALLBACK: Channels = [0, 255, 136]

describe('parseChannels', () => {
  it('parses the space-separated channel form we store', () => {
    expect(parseChannels('0 255 136', FALLBACK)).toEqual([0, 255, 136])
    expect(parseChannels('  255 176 0 ', FALLBACK)).toEqual([255, 176, 0])
  })

  it('also accepts a comma-separated form', () => {
    expect(parseChannels('68, 147, 248', FALLBACK)).toEqual([68, 147, 248])
  })

  it('falls back when empty or malformed', () => {
    expect(parseChannels('', FALLBACK)).toEqual(FALLBACK)
    expect(parseChannels('   ', FALLBACK)).toEqual(FALLBACK)
    expect(parseChannels('255 176', FALLBACK)).toEqual(FALLBACK)
    expect(parseChannels('nope', FALLBACK)).toEqual(FALLBACK)
  })

  it('takes the first three channels when extras are present', () => {
    expect(parseChannels('1 2 3 4', FALLBACK)).toEqual([1, 2, 3])
  })
})

describe('rgba / rgb', () => {
  it('formats channels + alpha', () => {
    expect(rgba([0, 255, 136], 0.5)).toBe('rgba(0,255,136,0.5)')
    expect(rgb([255, 176, 0])).toBe('rgb(255,176,0)')
  })
})
