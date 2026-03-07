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
- [src/config/index.js](src/config/index.js) — Central config: relay list, API URLs, timeouts, `WS_PATH`, `DEVICE_POLL_INTERVAL`
- [src/context/](src/context/) — Global state providers (RelayContext, ToastContext, RobotContext, VoiceContext, etc.)
- [src/services/](src/services/) — API layer; [groqService.js](src/services/groqService.js) owns all Groq calls (STT, chat, TTS stream)
- [src/hooks/](src/hooks/) — Custom hooks; [useVoiceCommand.js](src/hooks/useVoiceCommand.js) and [useIdleVoice.js](src/hooks/useIdleVoice.js) for voice pipelines
- [src/components/ui/](src/components/ui/) — Reusable primitives (Button, Card, ToggleSwitch, Modal)

### Data flow
1. [App.jsx](src/App.jsx) wraps everything in: `AuthGate > ErrorBoundary > RobotProvider > ToastProvider > LogProvider > RelayProvider > DeviceProvider > SceneProvider > VoiceProvider`
2. Navigation is **swipe-based** via `PageSwiper` (no React Router). `PAGES` array in [App.jsx](src/App.jsx) defines swipe order and per-page robot expression.
3. Services call [api.js](src/services/api.js) factory (`createApiClient()`) for a fresh Axios instance on every call — picks up `localStorage` IP changes without reload.
4. Hooks like [useRelays.js](src/hooks/useRelays.js) use **optimistic UI** (reverts on failure).

## Code Style

- **JSX files**: `.jsx` extension, functional components only
- **Component exports**: `export default function ComponentName()`
- **Context pattern**: Create context → Provider component → `useXxx()` hook that throws if outside provider
- **Doc comments**: Every file starts with `/** file.js — description */` block
- **State keying**: Use object keyed by ID for O(1) lookups (see [RelayContext.jsx](src/context/RelayContext.jsx#L14-L16))
- **Memoization**: Use `React.memo` on UI components to prevent sibling re-renders

## Project Conventions

### Adding relays
Edit `RELAY_CONFIG` in [src/config/index.js](src/config/index.js#L27-L32). Dashboard/Timer/voice all read from this array automatically. Each relay has `{ id, name, icon }` — no `label` field.

### ESP32 IP address
`getBaseUrl()` in [src/config/index.js](src/config/index.js#L13-L17) resolves the backend host in priority order:
1. `localStorage` key `iot_base_url` (set via Settings page)
2. `VITE_API_BASE_URL` env var
3. Hardcoded fallback: `http://192.168.1.7`

**Never** rely on `localhost` — the device is always an ESP32. `.env` is gitignored; copy `.env.example`.

### Mock mode
`VITE_MOCK_MODE=true` uses [mock.js](src/services/mock.js) instead of real API. Toggle in `.env` or Settings page.

### Auth gate
[src/components/AuthGate.jsx](src/components/AuthGate.jsx) — full-screen SHA-256 password gate (outermost wrapper in App.jsx). Password comes from `VITE_APP_PASSWORD` env var, session stored in `sessionStorage`. Cleared on tab close.

### Voice pipeline — two separate flows

**1. Active mic button** (`useVoiceCommand` + `VoiceMicButton` + `RobotMicButton`):
- Records audio via `MediaRecorder`, sends blob to **Groq Whisper** (`transcribeWithGroq` in [groqService.js](src/services/groqService.js)) — **not** to ESP32
- Intent parsed by `parseWithGroq` (LLM) then rule-based fallback
- Unknown commands → streams a conversational reply via `streamVoiceResponse` (SSE generator), displayed in robot speech bubble and spoken via browser TTS
- `RobotMicButton` (inside [RobotFace.jsx](src/components/robot/RobotFace.jsx)) stays on current page; `VoiceMicButton` is the bottom-left floating button

**2. Idle screen voice** (`useIdleVoice` in [src/hooks/useIdleVoice.js](src/hooks/useIdleVoice.js)):
- Uses **browser SpeechRecognition API** (no external STT cost) for always-on wake word detection: `"hey buddy"`
- On wake word → live interim transcript shown below robot, intent parsed, streaming reply rendered with cursor animation
- Robot expression tracks phase: `LOADING` (listening) → `THINKING` (processing) → `HAPPY` (responding)

### Groq service ([src/services/groqService.js](src/services/groqService.js))
- `transcribeWithGroq(blob)` — Whisper large-v3-turbo, direct to `https://api.groq.com/openai/v1/audio/transcriptions`
- `parseWithGroq(transcript, relayStates)` — llama3-8b-8192, returns structured JSON intent
- `streamChatResponse(messages)` — async generator, yields SSE delta strings
- `streamVoiceResponse(transcript, commandResult, relayStates)` — conversational reply stream
- Key from `VITE_GROQ_API_KEY`; check with `isGroqConfigured()`

### Keyboard shortcuts ([src/hooks/useKeyboardShortcuts.js](src/hooks/useKeyboardShortcuts.js))
| Key | Action |
|---|---|
| `1`–`4` | Toggle relay 1–4 |
| `R` | Refresh relay status |
| `V` | Toggle voice |
| `/` | Open AI chat panel |
| `?` | Show help overlay |
| `Esc` | Cancel / close |
| **Hold Left ⌥** | Push-to-talk mic (keydown → start, keyup → stop) |

PTT uses `e.location === 1` to target left Alt/Option only. Fires `iot:voice-trigger` / `iot:voice-stop` custom events. `VoiceMicButton` listens to these events.

### Robot expressions
Trigger via `useRobot()` hook:
```js
setRobotExpression(EXPRESSIONS.SUCCESS, 'Done!', 3000)
```
Expressions: `IDLE`, `THINKING`, `SUCCESS`, `ERROR`, `LOADING`, `HAPPY`, `SLEEPING`

### Error handling pattern
Services normalize errors to `{ message, status }` via [attachInterceptors](src/services/api.js#L31-L47). Components show toast + robot expression on failure. Voice errors (ESP32 offline) are handled gracefully — voice still streams a reply.

### Lazy loading
All pages except Dashboard are lazy-loaded via `React.lazy()` + `<Suspense>` — see [App.jsx](src/App.jsx#L22-L26). Each has `expr` key to auto-switch robot expression on swipe.

### Build targets
- `npm run build` → GitHub Pages (`base: /IOT/`)
- `npm run build:esp32` → ESP32 LittleFS (`base: /`, `BUILD_TARGET=esp32`)
- PWA with Workbox; API routes use `NetworkOnly`. Chunk split: `vendor`, `router`, `http`
- Build target: **`es2020`** (required for `@picovoice/porcupine-web` WASM BigInt literals)

## Testing

- **Framework**: Vitest + jsdom, test utilities in [src/test/utils.jsx](src/test/utils.jsx)
- **Setup**: [src/test/setup.js](src/test/setup.js) applies `@testing-library/jest-dom` matchers
- **Pattern**: Co-locate tests as `ComponentName.test.jsx` next to their source file
- Mock services with `vi.mock('../services/relayService')` — see [RelayContext.test.jsx](src/context/RelayContext.test.jsx)
- Tests use `globals: true` — no need to import `describe`/`it`/`expect`

## Backend API Contract (ESP32)
```
GET  /relays/status                   → [{ id, isOn }]
POST /relays/toggle?id=X&state=1|0    → { id, isOn }
GET  /health                          → 200 OK
WS   /ws                              → Real-time relay updates
```

**ESP32 firmware** ([esp32/relay_controller.ino](esp32/relay_controller.ino)):
- mDNS: `http://esp32.local` | WebSocket path: `/ws` | Active-LOW relay logic: `LOW` = ON
- LittleFS: Self-hosted React dashboard via `npm run build:esp32`

## MQTT Integration (HiveMQ Cloud)

| Constant | Value |
|---|---|
| Broker | `ad827adb37cb486d9a521c61763c31eb.s1.eu.hivemq.cloud` |
| Port | `8883` (TLS, `setInsecure()`) |
| Topic | `Shreyansh/feeds/room-relay` |
| Payload `"1"` / `"0"` | Relay 1 ON / OFF |

Reconnect is non-blocking via `millis()` gate. Credentials in `relay_controller.ino` globals.

## Deployment (Render)

[render.yaml](render.yaml) configures a static site. Set these env vars manually in Render dashboard (all `sync: false`):
`VITE_API_BASE_URL`, `VITE_APP_PASSWORD`, `VITE_GROQ_API_KEY`, `VITE_PORCUPINE_ACCESS_KEY`

## Security
- `.env` is **gitignored** — never commit it. Use `.env.example` as template.
- `VITE_*` vars are bundled into JS — treat as client-visible. Don't put server secrets here.
- `VITE_APP_PASSWORD` is SHA-256 hashed client-side; change from default `changeme123` before deploying.

## Performance Requirements
- No heavy animations on relay cards
- SVG + CSS only for robot (no canvas/rAF loops)
- Bundle target: <70 KB gzip initial load (Porcupine WASM chunk is large but split separately)
- Context lookups must be O(1) via object keying
