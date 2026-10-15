import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * index.html carries the production CSP as a meta tag (it holds for file:// loads, where no
 * response header exists). The dev server alone drops it: Vite's HMR client and React's
 * refresh preamble are inline scripts the policy would block.
 */
const devWithoutCsp: Plugin = {
  name: 'radar-dev-without-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, '')
}

export default defineConfig({
  main: {
    // Bundle the ESM `radar-blip` engine into the main-process bundle (it is not a
    // CJS module electron can `require` at runtime); its only runtime dep, `yaml`,
    // is bundled transitively. Everything else stays externalized.
    build: {
      externalizeDeps: { exclude: ['radar-blip'] },
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/bridge.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react(), devWithoutCsp]
  }
})
