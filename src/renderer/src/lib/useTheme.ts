import { useEffect, useState } from 'react'
import { CRT_CHANGE_EVENT, THEME_CHANGE_EVENT, getCrtOff, getThemeId } from './theme'

/**
 * Subscribe to live theme + CRT state. `applyTheme()` / `setCrtOff()` broadcast `radar-theme-change` /
 * `radar-crt-change` CustomEvents; this hook keeps a component in sync with them. Used by the title bar
 * and the Appearance tab so neither hand-rolls the same add/removeEventListener block.
 */
export function useThemeState(): { themeId: string; crtOff: boolean } {
  const [themeId, setThemeIdState] = useState(getThemeId)
  const [crtOff, setCrtOffState] = useState(getCrtOff)
  useEffect(() => {
    const onTheme = (): void => setThemeIdState(getThemeId())
    const onCrt = (): void => setCrtOffState(getCrtOff())
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)
    window.addEventListener(CRT_CHANGE_EVENT, onCrt)
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
      window.removeEventListener(CRT_CHANGE_EVENT, onCrt)
    }
  }, [])
  return { themeId, crtOff }
}
