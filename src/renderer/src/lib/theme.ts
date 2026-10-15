// Theme is `data-theme="light"` on <html>, or absent for dark (renderer spec 1.1). The native
// window controls over the top bar take the same colours, read back from the tokens.
import type { Theme } from './prefs'

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'light') root.dataset.theme = 'light'
  else delete root.dataset.theme
  const css = getComputedStyle(root)
  const color = css.getPropertyValue('--bg').trim()
  const symbolColor = css.getPropertyValue('--fg-3').trim()
  void window.radar?.invoke('window.titleBar', { color, symbolColor })
}
