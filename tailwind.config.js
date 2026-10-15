/** @type {import('tailwindcss').Config} */
// Every value here is a token from src/renderer/src/styles/tokens.css (renderer spec 1): no
// colour, face or radius is defined twice. Nothing animates (spec section 0, rule 10).
const v = (name) => `var(--${name})`
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      ...Object.fromEntries(
        ['bg', 'bg-1', 'bg-2', 'bg-3', 'zone', 'line', 'line-2', 'fg', 'fg-2', 'fg-3', 'acc', 'acc-ink', 'acc-fill', 'on-acc', 'acc-deep', 'acc-wash', 'acc-line', 'scrim'].map((n) => [n, v(n)])
      )
    },
    fontFamily: { display: v('display'), mono: v('mono'), body: v('body') },
    borderRadius: { none: '0', r1: v('r1'), r2: v('r2'), r3: v('r3'), full: '9999px' },
    boxShadow: { none: 'none', go: `3px 3px 0 0 ${v('acc-deep')}`, overlay: v('shadow') },
    extend: {
      spacing: { s1: v('s1'), s2: v('s2'), s3: v('s3'), s4: v('s4'), s5: v('s5'), s6: v('s6') }
    },
    keyframes: {},
    animation: { none: 'none' }
  },
  // a transition is written in app.css, inside prefers-reduced-motion: no-preference (section 11),
  // never as a utility, which would ship unguarded
  corePlugins: { transitionProperty: false, transitionDelay: false, transitionDuration: false, transitionTimingFunction: false },
  plugins: []
}
