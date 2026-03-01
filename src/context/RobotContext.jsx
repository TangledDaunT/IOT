/**
 * RobotContext — drives robot face expressions from anywhere in the app.
 *
 * Expressions map to visual states in the RobotFace component:
 *   idle       → neutral blink, small smile
 *   happy      → crescent eyes, big smile
 *   thinking   → one squinted eye, sideways mouth
 *   loading    → spinning pupils, open circle mouth
 *   success    → stars in eyes, huge grin
 *   error      → drooped eyes, sad mouth, red tint
 *   sleeping   → closed eyes, ZZZ
 *
 * Expressions auto-revert to 'idle' after a configurable timeout.
 */
import { createContext, useContext, useState, useCallback, useRef } from 'react'

export const EXPRESSIONS = {
  IDLE: 'idle',
  HAPPY: 'happy',
  THINKING: 'thinking',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
  SLEEPING: 'sleeping',
}

const RobotContext = createContext(null)

export function RobotProvider({ children }) {
  const [expression, setExpression] = useState(EXPRESSIONS.IDLE)
  const [message, setMessage] = useState('')
  const [minimized, setMinimized] = useState(false)
  const revertTimer = useRef(null)

  /**
   * Set robot expression, optionally with a message bubble and revert timeout.
   * @param {string} expr     - one of EXPRESSIONS values
   * @param {string} msg      - optional speech bubble text
   * @param {number} revertMs - ms before reverting to idle (0 = stay)
   */
  const setRobotExpression = useCallback((expr, msg = '', revertMs = 3000) => {
    clearTimeout(revertTimer.current)
    setExpression(expr)
    setMessage(msg)

    if (revertMs > 0) {
      revertTimer.current = setTimeout(() => {
        setExpression(EXPRESSIONS.IDLE)
        setMessage('')
      }, revertMs)
    }
  }, [])

  const toggleMinimized = useCallback(() => setMinimized((v) => !v), [])

  return (
    <RobotContext.Provider
      value={{ expression, message, minimized, setRobotExpression, toggleMinimized }}
    >
      {children}
    </RobotContext.Provider>
  )
}

export function useRobot() {
  const ctx = useContext(RobotContext)
  if (!ctx) throw new Error('useRobot must be used inside RobotProvider')
  return ctx
}
