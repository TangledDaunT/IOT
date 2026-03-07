/**
 * useKeyboardShortcuts — global keyboard shortcut handler.
 *
 * Shortcuts (while not focused on an input):
 *   1-4           → Toggle relay 1-4
 *   R             → Refresh relay status
 *   V             → Toggle voice recording
 *   /             → Open AI chat panel
 *   ?             → Show shortcut help overlay
 *   Escape        → Stop recording / close overlays
 *   Hold ⌥ Left  → Push-to-talk (start on press, stop on release)
 *
 * Disabled when focus is in a text input, textarea, or select.
 */
import { useEffect, useRef } from 'react'

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
 * @param {() => void} handlers.onPTTStart             - push-to-talk: left ⌥ pressed
 * @param {() => void} handlers.onPTTEnd               - push-to-talk: left ⌥ released
 */
export function useKeyboardShortcuts({ onRelayKey, onRefresh, onVoice, onChat, onHelp, onEscape, onPTTStart, onPTTEnd }) {
  // Track whether PTT is currently held to avoid keydown repeat fires
  const pttActiveRef = useRef(false)

  useEffect(() => {
    const onKeyDown = (e) => {
      // ── Push-to-talk: Left Alt/Option key ────────────────────────────
      // location 1 = DOM_KEY_LOCATION_LEFT
      if (e.key === 'Alt' && e.location === 1) {
        if (e.repeat || pttActiveRef.current) return  // ignore key-repeat
        if (isTyping(e)) return
        e.preventDefault()
        pttActiveRef.current = true
        onPTTStart?.()
        return
      }

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

    const onKeyUp = (e) => {
      if (e.key === 'Alt' && e.location === 1 && pttActiveRef.current) {
        e.preventDefault()
        pttActiveRef.current = false
        onPTTEnd?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRelayKey, onRefresh, onVoice, onChat, onHelp, onEscape, onPTTStart, onPTTEnd])
}
