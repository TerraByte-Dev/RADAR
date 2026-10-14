// The scope layout (renderer spec 7), lifted from radar-design/final/_scope.js: a pure function of
// (projects, box, options). No DOM, no canvas, no measurement API. Label widths come from the
// advance table below, so the layout is identical in tests and in the app.
import { ageLabel, days, folderName, groupOf, visible, type BoardData, type Group } from './derive'
import { readPrefs, writePrefs } from './prefs'

/** What the layout reads of a project. `group` and `age` come from lib/derive at the board's `now`. */
export interface ScopeProject {
  id: string
  name: string
  days: number | null
  status: 'active' | 'blocked' | 'paused' | 'archived'
  focus: boolean
  live: boolean
  group: Group
  /** `2d`, `3w`, `new`: the age printed after the label in the full view. */
  age: string
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where the rings sit, as fractions of R: 1 day, 1 week, 6 weeks, and the far band. */
export interface Stops {
  day: number
  week: number
  six: number
  far: number
}

/** The one radial scale (7.1); the ring boundaries are the list's group thresholds. */
export const STOPS: Stops = { day: 0.3, week: 0.54, six: 0.74, far: 0.92 }

export type LabelMode = 'all' | 'warm' | 'hot'

export interface ScopeOptions {
  W: number
  H: number
  cx: number
  cy: number
  R: number
  /** Dot radius. */
  dot: number
  /** `all` every project (Scope view), `warm` this week and the last six weeks, `hot` this week only (home panel). */
  labels: LabelMode
  selected?: string | null
  /** Ids always asked for and placed first, with focus: the Continue project on the home panel. */
  keep?: string[]
  /** The age after each label (full view only). */
  ages?: boolean
  /** Rectangles the labels keep off: the stage's overlays. */
  avoid?: Rect[]
  /** Which ring labels are drawn: all three, `week` alone, or none. */
  scale?: boolean | 'week'
  /** The persisted bearing slots (7.2); new ids are assigned on top of them. */
  slots?: Record<string, number>
  stops?: Stops
}

export interface Label {
  /** The label's rectangle, 16px tall; the plate is drawn 2px around it. */
  r: Rect
  /** 1 right of the dot, -1 left, 0 centred above or below. */
  side: 1 | -1 | 0
  dy: number
  /** A 1px leader to the dot: only in the full view, for a label moved off its dot's line. */
  leader: boolean
}

interface Cand {
  x: number
  y: number
  side: 1 | -1 | 0
  dy: number
  stack: number
  leader: boolean
  nudge?: boolean
}

/** How far a home-panel label may slide up or down beside its dot and still hold it in its corner. */
const HUG = 7
/** The slots a mark may be drawn aside from its own, nearest first. */
const NUDGE = [1, -1, 2, -2, 3, -3, 4, -4]
/** How far a home-panel mark whose name must be drawn may itself be drawn aside, to find room for it. */
const ASIDE = [...NUDGE, 5, -5, 6, -6]

export interface ScopeItem {
  p: ScopeProject
  /** Fraction of R. */
  f: number
  slot: number
  /** Drawn bearing in degrees, clockwise from up (the slot, or a nudged neighbour). */
  a: number
  x: number
  y: number
  halo: number
  tier: 'hot' | 'mid' | 'dim'
  sel: boolean
  px: number
  sub: string
  w: number
  L: Label | null
  /** The surface under the label: its halo takes that colour, so a ring never strikes through text. */
  on: 'zone' | 'disc' | 'out' | null
}

export interface ScopeLayout {
  items: ScopeItem[]
  /** Names asked for and not drawn: the Scope's "Tucked away" note. */
  dropped: string[]
  /** The centre cross is drawn only when no blip sits close enough to be read as part of it. */
  cross: boolean
  /** The ring labels' rectangles, centred at 12 o'clock. */
  scales: { f: number; text: string; r: Rect }[]
}

export const SLOTS = 46
const SLOT_DEG = 7.5
const FIRST_DEG = 11.25
/** A label may sit at most two line-steps from its dot; past that it is not drawn. */
export const LEADER_MAX = 28

/** Fraction of R from days since last work: banded log, archived on the rim (7.1). */
export function radiusFrac(days: number | null, status: ScopeProject['status'], s: Stops = STOPS): number {
  if (status === 'archived') return 1
  if (days == null) return s.far
  const d = Math.max(days, 0)
  if (d <= 1) return 0.12 + (s.day - 0.12) * d
  if (d <= 7) return s.day + ((s.week - s.day) * Math.log(d)) / Math.log(7)
  if (d <= 42) return s.week + ((s.six - s.week) * Math.log(d / 7)) / Math.log(6)
  if (d <= 180) return s.six + ((s.far - s.six) * Math.log(d / 42)) / Math.log(180 / 42)
  return s.far
}

export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Bearings are handed out once and kept (7.2): each unknown id, in sorted order, takes the
 * least-used slot farthest from every occupied one, ties broken by nearness to its hash. Known
 * slots never move.
 */
export function assignSlots(ids: string[], known: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = { ...known }
  const used: number[] = Array(SLOTS).fill(0)
  for (const s of Object.values(out)) used[s]++
  const circ = (a: number, b: number): number => Math.min((a - b + SLOTS) % SLOTS, (b - a + SLOTS) % SLOTS)
  for (const id of ids.slice().sort()) {
    if (out[id] != null) continue
    const want = fnv1a(id) % SLOTS
    const least = Math.min(...used)
    let best = -1
    let bestD = -1
    let bestTie = 1e9
    for (let s = 0; s < SLOTS; s++) {
      if (used[s] !== least) continue
      let d = SLOTS
      for (let o = 0; o < SLOTS; o++) if (used[o] > least || (used[o] && least === 0)) d = Math.min(d, circ(s, o))
      const tie = circ(s, want)
      if (d > bestD || (d === bestD && tie < bestTie)) {
        best = s
        bestD = d
        bestTie = tie
      }
    }
    out[id] = best
    used[best]++
  }
  return out
}

export const degOf = (slot: number): number => FIRST_DEG + SLOT_DEG * (((slot % SLOTS) + SLOTS) % SLOTS)

/**
 * The advance table: IBM Plex Mono advances 0.6em for every glyph at every weight, so a label's
 * width is exact from its length. The e2e suite measures the drawn labels against it.
 */
export const ADVANCE = 0.6
export const textW = (s: string, px: number): number => s.length * px * ADVANCE

/** The clearance a blip needs round its dot: the reticle and the live ring are part of the mark. */
export const haloOf = (p: Pick<ScopeProject, 'focus' | 'live'>, dot: number): number => dot + (p.focus ? 8 : p.live ? 5 : 1.5)

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const rad = (d: number): number => (d * Math.PI) / 180

const SCALE_TEXT: [keyof Stops, string][] = [
  ['day', '1 day'],
  ['week', '1 week'],
  ['six', '6 weeks']
]

export function layout(projects: ScopeProject[], o: ScopeOptions): ScopeLayout {
  const { W, H, cx, cy, R, dot, labels, selected = null, ages = true, avoid = [], scale = true } = o
  const stops = o.stops ?? STOPS
  const keep = new Set(o.keep ?? [])
  const xy = (f: number, a: number): [number, number] => [cx + R * f * Math.sin(rad(a)), cy - R * f * Math.cos(rad(a))]

  // 1. dots, sorted by id so the result never depends on input order; a mark that would touch an
  // earlier one is drawn at a neighbouring slot (the stored slot does not change)
  const slots = assignSlots(projects.map((p) => p.id), o.slots)
  const items: ScopeItem[] = []
  for (const p of projects.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const f = radiusFrac(p.days, p.status, stops)
    const halo = haloOf(p, dot)
    const slot = slots[p.id]
    let at: [number, number, number] = [0, 0, 0]
    for (const step of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const a = degOf(slot + step)
      const [x, y] = xy(f, a)
      at = [x, y, a]
      if (items.every((q) => Math.hypot(q.x - x, q.y - y) >= q.halo + halo + 3)) break
    }
    const tier = p.group === 'week' ? 'hot' : p.group === 'recent' ? 'mid' : 'dim'
    const px = tier === 'hot' ? 13 : 12
    const sub = ages && p.status !== 'archived' ? (p.live ? 'live' : p.age) : ''
    const w = textW(p.name, px) + (sub ? 7 + textW(sub, 12) : 0)
    items.push({ p, f, slot, x: at[0], y: at[1], a: at[2], halo, tier, sel: p.id === selected, px, sub, w, L: null, on: null })
  }

  // 2. labels, horizontal only
  const inline = labels !== 'all'
  // On the home panel the selected project is asked for, but last and with no claim on room: what
  // is selected on Pick up never moves a mark or another label there.
  const must = (it: ScopeItem): boolean => (it.sel && !inline) || it.p.focus || keep.has(it.p.id)
  const want = (it: ScopeItem): boolean => labels === 'all' || it.tier === 'hot' || (labels === 'warm' && it.tier === 'mid') || must(it)
  const scales = (scale === false ? [] : SCALE_TEXT.filter(([, t]) => scale !== 'week' || t === '1 week')).map(([k, text]) => {
    const w = textW(text, 12) + 10
    return { f: stops[k], text, r: { x: cx - w / 2, y: cy - R * stops[k] - 9, w, h: 18 } }
  })
  // a label may not come within 4px (2px on the home panel) of another project's mark: that is
  // what makes a label read as the wrong project's
  const gap = inline ? 2 : 4
  const square = (m: ScopeItem, x = m.x, y = m.y): Rect => ({ x: x - m.halo - gap, y: y - m.halo - gap, w: (m.halo + gap) * 2, h: (m.halo + gap) * 2 })
  /** Every rectangle a label keeps off: the overlays, the ring labels, the labels placed so far. */
  let taken: Rect[] = []

  function candidates(it: ScopeItem, pref: 1 | -1): Cand[] {
    const out: Cand[] = []
    for (const dy of inline ? [0] : [0, -14, 14, -LEADER_MAX, LEADER_MAX])
      for (const side of [pref, -pref as 1 | -1]) {
        const g = it.halo + 5 - (dy ? 2 : 0)
        out.push({ x: side > 0 ? it.x + g : it.x - g - it.w, y: it.y + dy, side, dy, stack: 0, leader: dy !== 0 })
      }
    // centred directly above or below the mark, no leader
    if (!inline) for (const v of [-1, 1]) out.push({ x: it.x - it.w / 2, y: it.y + v * (it.halo + 11), side: 0, dy: 0, stack: v, leader: false })
    return out
  }

  /**
   * On the home panel a label is never displaced, but one that must be drawn, when neither side at
   * offset 0 is clear, may take any place that still touches its own mark: beside it a few px up or
   * down, or just above or below it with the dot under its middle, its ends or between. Each holds
   * the dot against the label's own edge, so it cannot be read as a neighbour's.
   */
  function hugs(it: ScopeItem, pref: 1 | -1): Cand[] {
    const out: Cand[] = []
    for (const side of [pref, -pref as 1 | -1])
      for (const dy of [-HUG, HUG]) {
        const g = it.halo + 5
        out.push({ x: side > 0 ? it.x + g : it.x - g - it.w, y: it.y + dy, side, dy: 0, stack: 0, leader: false, nudge: true })
      }
    for (const v of [-1, 1])
      for (const t of [0.5, 0, 1, 0.25, 0.75])
        out.push({ x: it.x - it.halo - t * (it.w - 2 * it.halo), y: it.y + v * (it.halo + 9), side: t === 0 ? 1 : t === 1 ? -1 : 0, dy: 0, stack: v, leader: false })
    return out
  }

  /** A mark that cannot move aside: one that must be named, or whose label is already drawn beside it. */
  const fixed = (m: ScopeItem): boolean => must(m) || m.L !== null
  /** Whether `m` drawn at (x, y) keeps clear of every other mark, as the dot nudge requires. */
  const roomFor = (m: ScopeItem, x: number, y: number): boolean => items.every((q) => q === m || Math.hypot(q.x - x, q.y - y) >= q.halo + m.halo + 3)
  const slotAt = (m: ScopeItem, step: number): { x: number; y: number; a: number } => {
    const a = degOf(m.slot + step)
    const [x, y] = xy(m.f, a)
    return { x, y, a }
  }
  const offLabels = (m: ScopeItem, x: number, y: number): boolean => !taken.some((t) => overlap(square(m, x, y), t) > 0)

  /**
   * Moves every mark in `r` that can move up to four slots aside, out of `r` and off every label
   * already placed; puts them all back and answers false when one cannot go.
   */
  function clear(it: ScopeItem, r: Rect): boolean {
    const was = items.map((m) => [m.x, m.y, m.a] as const)
    for (const m of items) {
      if (m === it || overlap(r, square(m)) === 0) continue
      const to = NUDGE.map((n) => slotAt(m, n)).find((q) => overlap(square(m, q.x, q.y), r) === 0 && offLabels(m, q.x, q.y) && roomFor(m, q.x, q.y))
      if (!to) {
        items.forEach((q, i) => ([q.x, q.y, q.a] = was[i]))
        return false
      }
      ;[m.x, m.y, m.a] = [to.x, to.y, to.a]
    }
    return true
  }

  /** Places `it`'s label at its best candidate, or answers false (the overflow rule). */
  function place(it: ScopeItem): boolean {
    const pref = it.x >= cx ? 1 : -1
    const score = (cands: Cand[]) =>
      cands
        .map((c) => {
          const r = { x: c.x - 2, y: c.y - 8, w: it.w + 4, h: 16 }
          let soft = 0
          let hard = 0
          let fixedHard = 0
          for (const t of taken) soft += overlap(r, t)
          for (const m of items) {
            if (m === it) continue
            const o = overlap(r, square(m))
            hard += o
            if (fixed(m)) fixedHard += o
          }
          const out = r.x < 4 || r.x + r.w > W - 4 || r.y < 4 || r.y + r.h > H - 4
          const cost = soft * 12 + hard * 400 + Math.abs(c.dy) * 1.6 + (c.side === -pref ? 9 : 0) + (c.stack ? 14 : 0) + (c.nudge ? 6 : 0) + (out ? 1e5 : 0)
          const L: Label = { r, side: c.side, dy: c.dy, leader: c.leader }
          return { cost, soft, hard, fixedHard, out, L }
        })
        .sort((x, y) => x.cost - y.cost)
    // A label that cannot sit clear of every other mark and every earlier label is not drawn. In the
    // full view selected and focus labels chose first and are exempt; on the home panel nothing is,
    // because a label touching another mark there was read as that project's.
    const clean = (s: ReturnType<typeof score>[number]): boolean => !s.out && ((!inline && must(it)) || (s.soft <= 4 && s.hard === 0))
    const first = score(candidates(it, pref))[0]
    let best = clean(first) ? first : undefined
    if (!best && inline && must(it)) {
      const more = score([...candidates(it, pref), ...hugs(it, pref)])
      best = clean(more[0]) ? more[0] : undefined
      // still none: the marks in its way that carry no label and need not be named are drawn up
      // to four slots aside, as the dot nudge does
      best ??= more.find((s) => !s.out && s.soft <= 4 && s.fixedHard === 0 && clear(it, s.L.r))
    }
    if (!best) return false
    it.L = best.L
    taken.push(best.L.r)
    const d = Math.hypot(best.L.r.x + best.L.r.w / 2 - cx, best.L.r.y + 8 - cy)
    it.on = d < R * stops.week - 6 ? 'zone' : d < R - 6 ? 'disc' : 'out'
    return true
  }

  /** The last resort for a label that must be drawn on the home panel: its own mark moves up to six slots aside, label and all. */
  function placeAside(it: ScopeItem): boolean {
    const was = [it.x, it.y, it.a] as const
    for (const n of ASIDE) {
      const q = slotAt(it, n)
      if (!roomFor(it, q.x, q.y) || !offLabels(it, q.x, q.y)) continue
      ;[it.x, it.y, it.a] = [q.x, q.y, q.a]
      if (place(it)) return true
    }
    ;[it.x, it.y, it.a] = was
    return false
  }

  // each attempt places the labels in `order` from the dots' own places
  const home = items.map((m) => [m.x, m.y, m.a] as const)
  function attempt(order: ScopeItem[]): ScopeItem[] {
    items.forEach((m, i) => {
      ;[m.x, m.y, m.a] = home[i]
      m.L = null
      m.on = null
    })
    taken = [...avoid, ...scales.map((s) => s.r)]
    return order.filter((it) => !place(it) && !(inline && must(it) && placeAside(it)))
  }
  const order = items.filter(want).sort((a, b) => (inline ? 0 : Number(b.sel) - Number(a.sel)) || Number(must(b)) - Number(must(a)) || a.f - b.f || (a.p.id < b.p.id ? -1 : 1))
  const sel = items.find((it) => it.sel)
  if (sel && !order.includes(sel)) order.push(sel)
  let dropped = attempt(order)
  // On the Scope a label left out takes another turn straight after the selected and focus labels,
  // which still choose first; the order that leaves out fewest wins.
  for (let i = 0; i < 6 && !inline && dropped.length > 0; i++) {
    const next = [...order.filter(must), ...dropped.filter((m) => !must(m)), ...order.filter((m) => !must(m) && !dropped.includes(m))]
    const d = attempt(next)
    if (d.length >= dropped.length) {
      attempt(order)
      break
    }
    order.splice(0, order.length, ...next)
    dropped = d
  }
  // On the home panel a label that must be drawn and is left out lets the first five of them take
  // their turns in every other order, and the order that names the most wins. Past five musts in a
  // crowded week this can still leave one out.
  const missed = (d: ScopeItem[]): number => d.filter(must).length
  if (inline && missed(dropped) > 0) {
    const head = order.filter(must).slice(0, 5)
    const rest = order.filter((m) => !head.includes(m))
    let best = { order, missed: missed(dropped), n: dropped.length }
    for (const p of permutations(head)) {
      const d = attempt([...p, ...rest])
      if (missed(d) < best.missed || (missed(d) === best.missed && d.length < best.n)) best = { order: [...p, ...rest], missed: missed(d), n: d.length }
      if (best.missed === 0) break
    }
    dropped = attempt(best.order)
  }
  const cross = items.every((it) => Math.hypot(it.x - cx, it.y - cy) > it.halo + 12)
  return { items, dropped: dropped.map((m) => m.p.name), cross, scales }
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs]
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]))
}

// ---- arrow keys (7.5): left and right by bearing, up and down to the nearest blip in the next ring ----

/** The ring band a fraction falls in: inside 1 day, 1 week, 6 weeks, beyond, and the rim. */
const band = (f: number, s: Stops): number => (f >= 1 ? 4 : f > s.six ? 3 : f > s.week ? 2 : f > s.day ? 1 : 0)

const circDeg = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * The blip an arrow moves to from `from` (null: nothing selected yet, which starts at the
 * innermost blip). Right is clockwise, left counter-clockwise, both wrapping; up moves one ring in
 * (more recent, as up the list), down one ring out, to the blip nearest in bearing.
 */
export function step(items: Pick<ScopeItem, 'p' | 'a' | 'f'>[], from: string | null, key: string, s: Stops = STOPS): string | null {
  if (!items.length) return null
  const cur = items.find((it) => it.p.id === from)
  if (!cur) return items.slice().sort((x, y) => x.f - y.f || x.a - y.a)[0].p.id
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const byA = items.slice().sort((x, y) => x.a - y.a || x.f - y.f || (x.p.id < y.p.id ? -1 : 1))
    const i = byA.indexOf(cur)
    return byA[(i + (key === 'ArrowRight' ? 1 : -1) + byA.length) % byA.length].p.id
  }
  const b = band(cur.f, s)
  const dir = key === 'ArrowUp' ? -1 : 1
  for (let n = b + dir; n >= 0 && n <= 4; n += dir) {
    const ring = items.filter((it) => band(it.f, s) === n)
    if (ring.length) return ring.sort((x, y) => circDeg(x.a, cur.a) - circDeg(y.a, cur.a) || Math.abs(x.f - cur.f) - Math.abs(y.f - cur.f))[0].p.id
  }
  return cur.p.id
}

// ---- the board, the boxes and the stored bearings ----

/** What the scope draws of the board: every visible project. */
export function scopeProjects(b: BoardData): ScopeProject[] {
  return visible(b).map((r) => {
    const d = days(r, b.now)
    return {
      id: r.id,
      name: r.doc?.name ?? folderName(r.dir),
      days: d,
      status: r.doc?.status ?? 'active',
      focus: r.doc?.focus === true,
      live: r.agent.live,
      group: groupOf(r, b.now),
      age: ageLabel(d)
    }
  })
}

type Box = Omit<ScopeOptions, 'selected' | 'keep' | 'slots'>

/**
 * The home panel under 1500 (6.3): 298x284, the week only, and its own radial scale. The rings sit
 * further out than on the Scope (1 week at 0.70 of R, not 0.54, and 0.23 of R left for six weeks
 * and beyond), so the projects of this week have room for their names. With a realistic board
 * every focus project and the Continue project is named on it; with many focus projects crowded
 * into the week some of them can be left out, and the panel does not say which (see the list).
 */
export const PANEL_STOPS: Stops = { day: 0.45, week: 0.7, six: 0.84, far: 0.93 }
export const HOME_PANEL: Box = { W: 298, H: 284, R: 126, cx: 149, cy: 143, dot: 3.5, labels: 'hot', ages: false, scale: 'week', stops: PANEL_STOPS }
/** The home panel from 1500: the rail's width, this week and the last six weeks, the Scope's own scale. */
export const HOME_PANEL_WIDE: Box = { W: 508, H: 456, R: 200, cx: 254, cy: 230, dot: 4, labels: 'warm', ages: false }

/**
 * The Scope stage laid out at its measured size (6.7), with the margins of the three designed
 * boxes: 948x726 (R 312) at 1280x800, 1240x826 (R 364) at 1600x900 and 600x566 (R 222) at 900x640.
 * The overlays are `avoid` rectangles: the headline top left, the legend bottom left, the note
 * bottom right. `note` is the note as drawn, measured on the stage: it grows a line or two when
 * labels are tucked away, and under 1180 it is only the Tucked away line, under the headline.
 */
export function stageBox(W: number, H: number, windowWidth: number, note: Rect | null = null): Box {
  const drawn = note && note.h > 0 ? note : null
  if (windowWidth <= 1180) {
    const R = Math.max(80, Math.min(222 + (H - 566) / 2, (W - 156) / 2))
    return {
      W,
      H,
      cx: W / 2 + 10,
      cy: H / 2 - 21,
      R,
      dot: 3.8,
      labels: 'all',
      avoid: [
        { x: 0, y: 0, w: 240, h: 52 },
        { x: 0, y: H - 88, w: 216, h: 88 },
        ...(drawn ? [{ x: 0, y: drawn.y - 4, w: drawn.x + drawn.w + 8, h: drawn.h + 8 }] : [])
      ]
    }
  }
  const R = Math.max(80, Math.min(312 + (H - 726) * 0.52, W / 2 - 24))
  // the designed box, 20px above a two-line note, or above the note as drawn when it is taller
  const nx = Math.min(W - 312, drawn ? drawn.x - 12 : Infinity)
  const ny = Math.min(H - 76, drawn ? drawn.y - 20 : Infinity)
  return {
    W,
    H,
    cx: W / 2,
    cy: H / 2,
    R,
    dot: windowWidth >= 1500 ? 4.6 : 4.2,
    labels: 'all',
    avoid: [
      { x: 0, y: 0, w: 262, h: 112 },
      { x: 0, y: H - 98, w: 250, h: 98 },
      { x: nx, y: ny, w: W - nx, h: H - ny }
    ]
  }
}

/**
 * The stored bearings (7.2) with every id on the board given a slot, and the ids of projects no
 * longer tracked let go. `ids` is every record the board holds, hidden and missing ones too, so a
 * project keeps its bearing while it is tracked at all. Written back only when it changed.
 */
export function syncBearings(ids: string[]): Record<string, number> {
  const stored = readPrefs().bearings ?? {}
  const kept: Record<string, number> = {}
  for (const id of ids) {
    const s = stored[id]
    if (Number.isInteger(s) && s >= 0 && s < SLOTS) kept[id] = s
  }
  const next = assignSlots(ids, kept)
  const same = Object.keys(next).length === Object.keys(stored).length && Object.entries(next).every(([id, s]) => stored[id] === s)
  if (!same) writePrefs({ bearings: next })
  return next
}
