/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── TERRABYTE.SYS — Y2K terminal / CRT phosphor palette ──
        // Existing semantic names are remapped onto the phosphor palette so
        // every legacy utility (bg-surface, text-ink, …) renders on-brand.
        bg: '#000000',
        surface: '#020503',
        elevated: '#04090a',
        hover: '#0a1611',
        border: 'rgb(0 255 136 / 0.18)',
        // Text
        ink: '#9bf5b8',
        muted: 'rgb(155 245 184 / 0.58)',
        faint: 'rgb(155 245 184 / 0.32)',
        // Accent === phosphor
        accent: '#00FF88',
        'accent-soft': 'rgb(0 255 136 / 0.10)',
        // Priority flags → terminal channel colors
        p1: '#FF3030',
        p2: '#FFB000',
        p3: '#00E5FF',
        p4: 'rgb(155 245 184 / 0.45)',

        // ── New semantic tokens ──
        panel: '#020503',
        panelLite: '#04090a',
        lcd: '#020a05',
        rule: 'rgb(0 255 136 / 0.18)',
        ruleDim: 'rgb(0 255 136 / 0.08)',
        phosphor: {
          DEFAULT: '#00FF88',
          bright: '#7CFF6B',
          dim: '#1f5e3a',
          veil: 'rgb(0 255 136 / 0.08)',
          faint: 'rgb(0 255 136 / 0.20)'
        },
        term: {
          cyan: '#00E5FF',
          amber: '#FFB000',
          magenta: '#FF2E9A',
          red: '#FF3030'
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
        glow: '0 0 14px rgb(0 255 136 / 0.20)',
        'glow-strong': '0 0 24px rgb(0 255 136 / 0.35)'
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
