// lastOpenedAt (renderer spec 2): when RADAR was last left, for the digest. Closing the window is
// leaving, and so is ten minutes hidden: once that long, the time it was hidden is kept as the
// last visit, and on its return the digest lists what moved while it was away.

export const AWAY_MS = 10 * 60_000

export interface AwayHooks {
  /** Hidden for AWAY_MS: keep `at`, when it was hidden, as the last visit. */
  away(at: number): void
  /** Shown again after being away: the digest now counts from `at`. */
  back(at: number): void
}

/** A visibilitychange handler that reads `hidden` and the clock each time, and a stop for its timer. */
export function watchAway(hidden: () => boolean, hooks: AwayHooks, now: () => number = Date.now): { change(): void; stop(): void } {
  let hiddenAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    change() {
      clearTimeout(timer)
      if (hidden()) {
        const at = (hiddenAt = now())
        timer = setTimeout(() => hooks.away(at), AWAY_MS)
      } else if (hiddenAt && now() - hiddenAt >= AWAY_MS) {
        hooks.back(hiddenAt)
        hiddenAt = 0
      }
    },
    stop: () => clearTimeout(timer)
  }
}
