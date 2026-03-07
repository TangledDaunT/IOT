# Project Guidelines — IoT Control Dashboard

## Build & Test Commands
```bash
npm install           # Install deps
npm run dev           # Start dev server (mock mode by default)
npm run build         # Production build → dist/  (base: /IOT/ for GitHub Pages)
npm run build:esp32   # ESP32 self-hosted build   (base: /)
npm run lint          # ESLint check
npm run test          # Run tests once (vitest + jsdom)
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Coverage report → htmlcov/
npm run preview       # Serve dist/ locally
```

## Architecture

**Stack**: React 18 + Vite 5, TailwindCSS 3, Axios, Context API + useReducer. No Redux/MUI.

**Target device**: Samsung Galaxy J6 (720×1480, 3GB RAM). All code must be lightweight.

### Key directories
- [src/config/index.js](src/config/index.js) — Central config: relay list, API URLs, timeouts, device definitions, `WS_PATH`, `DEVICE_POLL_INTERVAL`
- [src/context/](src/context/) — Global state providers (RelayContext, ToastContext, RobotContext, etc.)
- [src/services/](src/services/) — API layer with Axios; includes mock implementations
- [src/hooks/](src/hooks/) — Custom hooks for relay control, WebSocket, localStorage
- [src/components/ui/](src/components/ui/) — Reusable primitives (Button, Card, ToggleSwitch, Modal)

### Data flow
1. [App.jsx](src/App.jsx) wraps all pages in: `RobotProvider > ToastProvider > LogProvider > RelayProvider > DeviceProvider > SceneProvider > VoiceProvider`
2. Navigation is **swipe-based** via `PageSwiper` (no React Router). `PAGES` array in [App.jsx](src/App.jsx) defines swipe order and per-page robot expression.
3. Services call [api.js](src/services/api.js) factory (`createApiClient()`) for a fresh Axios instance on every call — picks up `localStorage` IP changes without reload.
4. Hooks like [useRelays.js](src/hooks/useRelays.js) orchestrate context updates + toast/robot feedback; toggle uses **optimistic UI** (reverts on failure).

## Code Style

- **JSX files**: `.jsx` extension, functional components only
- **Component exports**: `export default function ComponentName()`
- **Context pattern**: Create context → Provider component → `useXxx()` hook that throws if outside provider
- **Doc comments**: Every file starts with `/** file.js — description */` block
- **State keying**: Use object keyed by ID for O(1) lookups (see [RelayContext.jsx](src/context/RelayContext.jsx#L14-L16))
- **Memoization**: Use `React.memo` on UI components to prevent sibling re-renders

## Project Conventions

### Adding relays
Edit `RELAY_CONFIG` in [src/config/index.js](src/config/index.js#L27-L32). Dashboard/Timer read from this array automatically.

### ESP32 IP address
`getBaseUrl()` in [src/config/index.js](src/config/index.js#L13-L17) resolves the backend host in priority order:
1. `localStorage` key `iot_base_url` (set via Settings page — overrides everything)
2. `VITE_API_BASE_URL` env var
3. Hardcoded fallback: `http://192.168.1.7`

To permanently change the default, update the fallback string in `getBaseUrl()`. Do **not** rely on `localhost` — the actual device is always the ESP32.

### Mock mode
`VITE_MOCK_MODE=true` uses [mock.js](src/services/mock.js) instead of real API. Toggle in `.env` or Settings page (saved to localStorage).

### Robot expressions
Trigger via `useRobot()` hook:
```js
setRobotExpression(EXPRESSIONS.SUCCESS, 'Done!', 3000)
```
Expressions: `IDLE`, `THINKING`, `SUCCESS`, `ERROR`, `LOADING`, `HAPPY`, `SLEEPING`

### Error handling pattern
Services normalize errors to `{ message, status }` via [attachInterceptors](src/services/api.js#L31-L47). Components show toast + robot expression on failure.

### Lazy loading
All pages except Dashboard are lazy-loaded via `React.lazy()` + `<Suspense>` in the `PAGES` array — see [App.jsx](src/App.jsx#L22-L26). Each has `expr` key to auto-switch robot expression on page open.

### Build targets
- `npm run build` → GitHub Pages deploy (`base: /IOT/`)
- `npm run build:esp32` → ESP32 LittleFS self-hosting (`base: /`, `BUILD_TARGET=esp32`)
- PWA with Workbox; API routes use `NetworkOnly` (never cached).
- Chunk split: `vendor` (react/react-dom), `router`, `http` (axios); target `es2015` for Android WebView.

## Testing

- **Framework**: Vitest + jsdom, test utilities in [src/test/utils.jsx](src/test/utils.jsx)
- **Setup**: [src/test/setup.js](src/test/setup.js) applies `@testing-library/jest-dom` matchers
- **Pattern**: Co-locate tests as `ComponentName.test.jsx` next to their source file
- Mock services with `vi.mock('../services/relayService')` \u2014 see [RelayContext.test.jsx](src/context/RelayContext.test.jsx)
- Tests use `globals: true` \u2014 no need to import `describe`/`it`/`expect`

## Backend API Contract (ESP32)
```
GET  /relays/status                   → [{ id, isOn }]
POST /relays/toggle?id=X&state=1|0    → { id, isOn }
GET  /health                          → 200 OK
WS   /ws                              → Real-time relay updates
```

**ESP32 firmware** ([esp32/relay_controller.ino](esp32/relay_controller.ino)):
- mDNS: Access via `http://esp32.local`
- WebSocket path: `/ws` (see `WS_PATH` in config)
- LittleFS: Self-hosted React dashboard (`npm run build:esp32`)
- Active-LOW relay logic: `LOW` = ON, `HIGH` = OFF

## MQTT Integration (HiveMQ Cloud)

The ESP32 firmware subscribes to HiveMQ Cloud over TLS (port 8883) using **PubSubClient** + `WiFiClientSecure` with `setInsecure()` (no root CA stored).

| Constant | Value |
|---|---|
| Broker | `ad827adb37cb486d9a521c61763c31eb.s1.eu.hivemq.cloud` |
| Port | `8883` |
| Topic | `Shreyansh/feeds/room-relay` |
| Payload `"1"` | Relay 1 ON |
| Payload `"0"` | Relay 1 OFF |

- Reconnect is **non-blocking** via `millis()` gate in `mqttReconnect()` — never delays `server.handleClient()`
- `applyRelay()` is always called so `relayState[]` stays in sync with HTTP endpoints
- Credentials live in `relay_controller.ino` globals (`MQTT_USER`, `MQTT_PASS`) — update there before flashing

## Performance Requirements
- No heavy animations on relay cards
- SVG + CSS only for robot (no canvas/rAF loops)
- Bundle target: <70KB gzip initial load
- Context lookups must be O(1) via object keying
