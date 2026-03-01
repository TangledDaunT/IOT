# IoT Control Dashboard

Production-ready local IoT dashboard for controlling ESP32 relays via FastAPI backend.  
Optimised for **Samsung Galaxy J6 (Android 8, 720×1480, 3 GB RAM)**.

---

## Stack

| Layer | Tech |
|-------|------|
| UI | React 18 + Vite 5 |
| Styling | TailwindCSS 3 |
| HTTP | Axios |
| Routing | React Router 6 |
| State | Context API + useReducer |
| PWA | vite-plugin-pwa + Workbox |

No Redux. No MUI. No heavy libraries.

---

## Quick Start

```bash
# 1. Clone / open project
cd "IOT"

# 2. Install dependencies
npm install

# 3. Start dev server (mock mode on by default)
npm run dev

# 4. Open on phone:
#    Find your Mac's local IP (System Preferences → Network)
#    Open: http://192.168.x.x:5173 in Chrome on your phone
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
VITE_API_BASE_URL=http://192.168.1.100:8000   # FastAPI backend IP
VITE_MOCK_MODE=true                            # true = mock API, false = real
```

> **Runtime override**: Go to the Settings page in the app and enter the backend IP there.  
> It's saved to `localStorage` and used immediately — no rebuild needed.

---

## Folder Structure

```
src/
├── config/
│   └── index.js          ← Central config (relay list, API URL, timeouts)
├── context/
│   ├── RelayContext.jsx  ← Global relay on/off state
│   ├── ToastContext.jsx  ← Toast notification system
│   └── RobotContext.jsx  ← Robot face expression control
├── services/
│   ├── api.js            ← Axios instance factory + error normalisation
│   ├── mock.js           ← Mock API responses for dev
│   ├── relayService.js   ← Relay API calls
│   └── timerService.js   ← Timer/schedule API calls
├── hooks/
│   ├── useRelays.js      ← Relay fetch + toggle + polling logic
│   └── useLocalStorage.js
├── components/
│   ├── ui/
│   │   ├── Button.jsx
│   │   ├── Card.jsx
│   │   ├── ToggleSwitch.jsx
│   │   ├── Modal.jsx
│   │   └── TimerInput.jsx
│   ├── layout/
│   │   ├── Layout.jsx    ← Root shell (navbar + robot + toasts)
│   │   └── Navbar.jsx    ← Bottom tab bar
│   ├── robot/
│   │   └── RobotFace.jsx ← 🤖 Always-on-top companion widget
│   ├── RelayCard.jsx
│   └── ToastContainer.jsx
├── pages/
│   ├── Dashboard.jsx     ← 4 relay cards
│   ├── Timer.jsx         ← Schedule relay actions
│   └── Settings.jsx      ← Backend IP config
├── App.jsx               ← Routes + providers
├── main.jsx              ← Entry point + PWA SW registration
└── index.css             ← Tailwind + custom animations
```

---

## Robot Face 🤖

The robot is a floating SVG widget (bottom-right corner) driven by `RobotContext`.  
It reacts to app events automatically.

| Expression | Triggered by |
|------------|-------------|
| `idle` | Default / after revert |
| `thinking` | User taps a relay toggle |
| `success` | Relay toggled successfully |
| `error` | API failure |
| `loading` | Ping / schedule API call |
| `happy` | Clear settings |
| `sleeping` | (Set manually or future idle timeout) |

**Trigger from any component:**
```js
const { setRobotExpression } = useRobot()
setRobotExpression(EXPRESSIONS.SUCCESS, 'Done!', 3000)
// args: expression, speech bubble text, ms before reverting to idle
```

**Tap the robot** to minimise it to a small icon in the corner.

---

## Adding More Relays

Edit `src/config/index.js`:

```js
export const RELAY_CONFIG = [
  { id: 1, name: 'Main Lights',  icon: '💡' },
  { id: 5, name: 'New Relay',    icon: '⚡' }, // ← add here
]
```

That's it. The Dashboard and Timer pages read from this config automatically.

---

## Backend API Contract (FastAPI)

When the backend is ready, implement these endpoints:

```
GET  /relays/status          → [{ id, isOn }]
POST /relays/{id}/toggle     → { id, isOn }    body: { isOn: bool }
GET  /health                 → 200 OK
POST /timers                 → timer object    body: { relayId, scheduledAt, action }
GET  /timers                 → [timer]
```

---

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # serve dist/ locally
```

**Bundle sizes (gzip):**
- Initial load: ~63 KB (vendor + router)
- App core:      ~9 KB
- Timer page:    ~2 KB (lazy)
- Settings page: ~1.8 KB (lazy)
- CSS:           ~4.4 KB

---

## PWA Installation

1. Open the app in Chrome on your Android phone
2. Tap the three-dot menu → "Add to Home screen"
3. The app installs as a standalone PWA (no browser UI)
4. Works offline (app shell cached by Workbox)

---

## Performance Notes (Samsung J6)

- Dark background reduces LCD power on AMOLED-adjacent panels
- No animations on relay cards — only toggle transition
- Robot face uses pure SVG + CSS, no canvas, no requestAnimationFrame loop
- Lazy-loaded routes (Timer, Settings) don't block initial render
- Context state is keyed by relay ID for O(1) lookup
- `React.memo` on all card/UI components to prevent sibling re-renders
- No global polling by default (set `POLL_INTERVAL > 0` in config to enable)
