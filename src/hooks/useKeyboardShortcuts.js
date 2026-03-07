/**
 * useKeyboardShortcuts — global keyboard shortcut handler.
 *
 * Shortcuts (while not focused on an input):
 *   1-4      → Toggle relay 1-4
 *   R        → Refresh relay status
 *   V        → Toggle voice recording
 *   /        → Open AI chat panel
 *   ?        → Show shortcut help overlay
 *   Escape   → Stop recording / close overlays
 *
 * Disabled when focus is in a text input, textarea, or select.
 */
import { useEffect } from 'react'

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isTyping(event) {
  const tag = event.target?.tagName?.toUpperCase()
  return IGNORED_TAGS.has(tag) || event.target?.isContentEditable
}

/**
 * @param {object} handlers
 * @param {(id: number) => void} handlers.onRelayKey   - called with relay id 1-4
 * @param {() => void} handlers.onRefresh              - refresh relay status
 * @param {() => void} handlers.onVoice                - toggle voice
 * @param {() => void} handlers.onChat                 - open AI chat
 * @param {() => void} handlers.onHelp                 - toggle shortcut help
 * @param {() => void} handlers.onEscape               - escape / cancel
 */
export function useKeyboardShortcuts({ onRelayKey, onRefresh, onVoice, onChat, onHelp, onEscape }) {
  useEffect(() => {
    const handler = (e) => {
      if (isTyping(e)) return

      switch (e.key) {
        case '1': case '2': case '3': case '4':
          e.preventDefault()
          onRelayKey?.(Number(e.key))
          break
        case 'r': case 'R':
          e.preventDefault()
          onRefresh?.()
          break
        case 'v': case 'V':
          e.preventDefault()
          onVoice?.()
          break
        case '/':
          e.preventDefault()
          onChat?.()
          break
        case '?':
          e.preventDefault()
          onHelp?.()
          break
        case 'Escape':
          onEscape?.()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onRelayKey, onRefresh, onVoice, onChat, onHelp, onEscape])
}
