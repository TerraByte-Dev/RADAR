/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── TERRABYTE.SYS — Y2K terminal / CRT phosphor palette ──
        // Every token maps onto a CSS variable holding space-separated RGB channels (defined in
        // styles/index.css `:root` + per-theme `[data-theme]` blocks), so the whole palette recolors at
        // runtime via the theme engine (lib/theme.ts). `<alpha-value>` keeps `text-x/50` opacity utilities
        // working; fixed-alpha derived tokens (border/rule/veil/muted/faint) stay literal on purpose.
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--panel-rgb) / <alpha-value>)',
        elevated: 'rgb(var(--panel-lite-rgb) / <alpha-value>)',
        hover: 'rgb(var(--hover-rgb) / <alpha-value>)',
        border: 'rgb(var(--phosphor-rgb) / 0.18)',
        // Text
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        muted: 'rgb(var(--ink-rgb) / 0.58)',
        faint: 'rgb(var(--ink-rgb) / 0.32)',
        // Accent === phosphor
        accent: 'rgb(var(--phosphor-rgb) / <alpha-value>)',
        'accent-soft': 'rgb(var(--phosphor-rgb) / 0.10)',
        // Priority flags → terminal channel colors
        p1: 'rgb(var(--term-red-rgb) / <alpha-value>)',
        p2: 'rgb(var(--term-amber-rgb) / <alpha-value>)',
        p3: 'rgb(var(--term-cyan-rgb) / <alpha-value>)',
        p4: 'rgb(var(--ink-rgb) / 0.45)',

        // ── New semantic tokens ──
        panel: 'rgb(var(--panel-rgb) / <alpha-value>)',
        panelLite: 'rgb(var(--panel-lite-rgb) / <alpha-value>)',
        lcd: 'rgb(var(--lcd-rgb) / <alpha-value>)',
        rule: 'rgb(var(--phosphor-rgb) / 0.18)',
        ruleDim: 'rgb(var(--phosphor-rgb) / 0.08)',
        phosphor: {
          DEFAULT: 'rgb(var(--phosphor-rgb) / <alpha-value>)',
          bright: 'rgb(var(--phosphor-bright-rgb) / <alpha-value>)',
          dim: 'rgb(var(--phosphor-dim-rgb) / <alpha-value>)',
          veil: 'rgb(var(--phosphor-rgb) / 0.08)',
          faint: 'rgb(var(--phosphor-rgb) / 0.20)'
        },
        term: {
          cyan: 'rgb(var(--term-cyan-rgb) / <alpha-value>)',
          amber: 'rgb(var(--term-amber-rgb) / <alpha-value>)',
          magenta: 'rgb(var(--term-magenta-rgb) / <alpha-value>)',
          red: 'rgb(var(--term-red-rgb) / <alpha-value>)'
        }
      },
      fontFamily: {
        // Body / UI text
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        // Labels, nav, metadata — the workhorse mono
        mono: ['"IBM Plex Mono"', '"Share Tech Mono"', 'monospace'],
        // Big display / headings — bitmap terminal
        term: ['"VT323"', '"Share Tech Mono"', 'monospace'],
        // LCD readouts
        lcd: ['"Share Tech Mono"', '"VT323"', 'monospace']
      },
      // Sharp, terminal-flavored corners everywhere; dots stay round (full).
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '2px',
        md: '2px',
        lg: '3px',
        xl: '3px',
        '2xl': '4px',
        '3xl': '4px',
        full: '9999px'
      },
      boxShadow: {
        glow: '0 0 14px rgb(var(--phosphor-rgb) / 0.20)',
        'glow-strong': '0 0 24px rgb(var(--phosphor-rgb) / 0.35)'
      },
      transitionTimingFunction: {
        calm: 'cubic-bezier(0.22, 1, 0.36, 1)'
      },
      keyframes: {
        blink: { '0%,50%': { opacity: '1' }, '50.01%,100%': { opacity: '0' } },
        caret: { '50%': { opacity: '0' } },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        flicker: {
          '0%,96%,100%': { opacity: '1' },
          '97%': { opacity: '0.85' },
          '98%': { opacity: '1.05' },
          '99%': { opacity: '0.92' }
        }
      },
      animation: {
        blink: 'blink 1s steps(2) infinite',
        caret: 'caret 0.8s steps(2) infinite',
        'pulse-led': 'pulse 1.6s ease-in-out infinite',
        flicker: 'flicker 6s steps(60) infinite'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
