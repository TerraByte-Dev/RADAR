# RADAR design system

The rules the renderer is held to. Most of them are enforced by tests in
`src/renderer/src/styles/`, so a change that breaks one fails `npm test`.

## Tokens

`src/renderer/src/styles/tokens.css` is **the only file in the renderer that holds a colour
value**. Tailwind's theme (`tailwind.config.js`) and every component read its CSS variables; no
other CSS or TSX file may name a colour (`styles.test.ts`).

| Role | Variables |
|---|---|
| Surfaces, darkest to lightest | `--bg`, `--bg-1`, `--bg-2`, `--bg-3`, `--zone` (the scope's disc) |
| Rules | `--line`, `--line-2` |
| Text | `--fg`, `--fg-2`, `--fg-3` |
| Accent | `--acc` (dark `#00FF88`), `--acc-ink` (text), `--acc-fill` (the filled button), `--on-acc` (text on it), `--acc-wash`, `--acc-line`, `--acc-deep` |
| Effects | `--glow`, `--glow-f`, `--scan`, `--shadow`, `--scrim` |
| Spacing | `--s1`…`--s6`: 4, 8, 12, 16, 24, 32 px |
| Radii | `--r1`…`--r3`: 2, 3, 4 px |
| Motion | `--t-fast` 90 ms, `--t-base` 160 ms, `--t-slow` 240 ms, `--ease` |

**Dark is the default.** Light is `data-theme="light"` on `<html>` and is a token swap only: the
same variables, redefined; every green goes to a dark ink and the glows switch off. The app
follows the system theme until you press `T`. `tokens.test.ts` checks that both themes define
the same tokens, that body text reads at 4.5:1 or more on every surface, and that the accent and
the filled button stand out from the window at 3:1 or more.

The main process paints the window with the dark `--bg` and `--fg-3` before the page loads, and
the native window controls take the theme's colours through the `window.titleBar` route.

## Type

Two faces, bundled in `src/renderer/src/assets/fonts/` under the SIL Open Font License 1.1 (the
licences ship in the installer's `licenses/` folder):

- **IBM Plex Mono** 400, 500 and 600 (`--mono`, also `--body`): everything you read.
- **VT323** (`--display`): the wordmark and headings, only at 22 px and up, in sentence case and
  never in green.

Every `@font-face` uses `font-display: block`, and nothing loads a font from outside the bundle.

## Motion

Transitions only: no keyframes and no animation loop anywhere in the renderer. Every transition
sits inside `@media (prefers-reduced-motion: no-preference)`, the timing tokens drop to 0 ms under
`reduce`, nothing scrolls smoothly, and Tailwind's transition, duration, ease and delay utilities
are switched off so none can ship outside that query.

## The Scope

`src/renderer/src/lib/scope.ts` is a pure function of the projects and the box it is drawn in: no
DOM, no canvas, no measuring, so the layout is identical in tests and in the app.

- **Distance is days since last work**, on one radial scale whose rings (1 day, 1 week, 6 weeks,
  then the far band) are the same thresholds as Pick up's groups.
- **Bearing** is one of 46 slots, given to a project the first time it is drawn and stored, so a
  project never moves round the dial.
- Paused projects are hollow where their last work puts them; archived ones sit hollow on the
  rim. The reticle (focus pins) and the live ring (an agent session) are the only green marks.
- Labels take advance widths from a built-in table; names that do not fit are listed as
  *Tucked away* rather than overlapping.

## Accessibility

Every view is checked with axe in both themes by the e2e suite (`e2e/a11y.spec.ts`), at 200% zoom
nothing scrolls sideways, focus never falls to the page when a view or overlay changes, and
every binding in the keymap (`lib/keymap.ts`, the one table the status bar, the palette and the
keys sheet are generated from) works without a mouse.
