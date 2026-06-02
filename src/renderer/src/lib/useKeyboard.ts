import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { tasksForView } from './selectors'

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable
  )
}

/**
 * App-wide keyboard model (Things-3 style):
 *   ⌘/Ctrl+K  command palette        q or ⌘/Ctrl+N  quick add
 *   j / ↓     next task              k / ↑          previous task
 *   x / space toggle complete        ⌫ / del        delete
 *   enter     expand / collapse      s              star (mark active)
 */
export function useKeyboard(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const s = useStore.getState()
      const mod = e.metaKey || e.ctrlKey

      // While the boot sequence is up, it owns the keyboard (any key skips it).
      if (!s.bootDone) return

      // Command palette — always available.
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setPaletteOpen(!s.paletteOpen)
        return
      }

      // While a dialog is open, let it own the keyboard.
      if (s.quickAddOpen || s.paletteOpen) return

      // Quick add.
      if ((mod && e.key.toLowerCase() === 'n') || (!mod && !isTyping(e.target) && e.key === 'q')) {
        e.preventDefault()
        s.setQuickAddOpen(true)
        return
      }

      if (isTyping(e.target)) return

      const visible = tasksForView(s.tasks, s.view, new Date(), s.showCompleted)
      if (visible.length === 0) return
      const idx = visible.findIndex((t) => t.id === s.selectedTaskId)

      switch (e.key) {
        case 'j':
        case 'ArrowDown': {
          e.preventDefault()
          const next = idx < 0 ? 0 : Math.min(idx + 1, visible.length - 1)
          s.setSelectedTask(visible[next].id)
          break
        }
        case 'k':
        case 'ArrowUp': {
          e.preventDefault()
          const prev = idx < 0 ? 0 : Math.max(idx - 1, 0)
          s.setSelectedTask(visible[prev].id)
          break
        }
        case 'x':
        case ' ': {
          if (idx >= 0) {
            e.preventDefault()
            s.toggleComplete(visible[idx].id)
          }
          break
        }
        case 'Enter': {
          if (idx >= 0) {
            e.preventDefault()
            s.toggleExpanded(visible[idx].id)
          }
          break
        }
        case 's': {
          if (idx >= 0) {
            e.preventDefault()
            s.toggleStar(visible[idx].id)
          }
          break
        }
        case 'Backspace':
        case 'Delete': {
          if (idx >= 0) {
            e.preventDefault()
            s.deleteTask(visible[idx].id)
          }
          break
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
