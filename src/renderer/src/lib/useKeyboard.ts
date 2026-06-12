import { useEffect } from 'react'
import { useStore } from '../store/useStore'

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/**
 * App-wide keyboard model:
 *   ⌘/Ctrl+K  command palette
 *   q or ⌘/Ctrl+N  quick capture
 * (Per-view interaction — radar drag, Esc to dismiss a panel — lives in those views.)
 */
export function useKeyboard(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const s = useStore.getState()
      const mod = e.metaKey || e.ctrlKey

      if (!s.bootDone) return

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setPaletteOpen(!s.paletteOpen)
        return
      }

      if (s.quickAddOpen || s.paletteOpen) return

      if ((mod && e.key.toLowerCase() === 'n') || (!mod && !isTyping(e.target) && e.key === 'q')) {
        e.preventDefault()
        s.setQuickAddOpen(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
