import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AWAY_MS, watchAway } from './away'

describe('watchAway (lastOpenedAt after ten minutes hidden)', () => {
  let hidden = false
  const away = vi.fn()
  const back = vi.fn()
  const set = (h: boolean, w: ReturnType<typeof watchAway>): void => {
    hidden = h
    w.change()
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    hidden = false
    away.mockReset()
    back.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('ten minutes hidden keeps the time it was hidden, and the return moves the digest to it', () => {
    const w = watchAway(() => hidden, { away, back })
    set(true, w)
    vi.advanceTimersByTime(AWAY_MS - 1)
    expect(away).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(away).toHaveBeenCalledWith(1_000_000)
    vi.advanceTimersByTime(60_000)
    set(false, w)
    expect(back).toHaveBeenCalledWith(1_000_000)
  })

  it('a shorter absence is not leaving: nothing is written and the digest stays', () => {
    const w = watchAway(() => hidden, { away, back })
    set(true, w)
    vi.advanceTimersByTime(AWAY_MS - 60_000)
    set(false, w)
    vi.advanceTimersByTime(AWAY_MS)
    expect(away).not.toHaveBeenCalled()
    expect(back).not.toHaveBeenCalled()
  })

  it('each absence counts from its own start, and stop clears the timer', () => {
    const w = watchAway(() => hidden, { away, back })
    set(true, w)
    vi.advanceTimersByTime(5 * 60_000)
    set(false, w)
    set(true, w)
    vi.advanceTimersByTime(AWAY_MS - 1)
    expect(away).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(away).toHaveBeenCalledWith(1_000_000 + 5 * 60_000)
    set(true, w)
    w.stop()
    vi.advanceTimersByTime(2 * AWAY_MS)
    expect(away).toHaveBeenCalledTimes(1)
  })
})
