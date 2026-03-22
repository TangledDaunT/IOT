# IoT Control Dashboard

Production-ready local IoT dashboard for controlling ESP32 relays with a React frontend and an optional FastAPI edge assistant.
Designed for Samsung Galaxy J6 class hardware (720x1480, 3 GB RAM), with lightweight UI and strict performance constraints.

## Stack

- Frontend: React 18 + Vite 5 + TailwindCSS 3
- State: Context API + useReducer
- Networking: Axios + WebSocket
- Voice/AI: Groq (Whisper STT, LLM parsing, streaming chat/TTS)
- Edge backend (optional): FastAPI
- Firmware: ESP32 Arduino (HTTP + WS + optional LittleFS self-hosting)

No Redux. No MUI.

## Build and test commands

```bash
npm install
npm run dev
npm run build
npm run build:esp32
npm run lint
npm run test
npm run test:watch
npm run test:coverage
npm run preview
```

## Edge assistant commands

```bash
cd edge_assistant
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8088 --reload
python run_workers.py
```

Run uvicorn and run_workers.py in separate terminals.

## Architecture

- App provider order in src/App.jsx:
  AuthGate > ErrorBoundary > RobotProvider > ToastProvider > LogProvider > RelayProvider > DeviceProvider > SmokeProvider > SceneProvider > VoiceProvider
- Navigation is swipe-based through PageSwiper (not React Router).
- Central config is in src/config/index.js.
- API access goes through src/services/api.js with fresh Axios client creation per call so IP changes from Settings/localStorage apply without reload.
- Relay updates use optimistic UI with rollback on failure.

## Key directories

- src/config/ central constants and mappings (relay/device/polling/websocket config)
- src/context/ global state providers
- src/services/ API and integration layer
- src/hooks/ domain hooks (voice, relays, websocket, idle handling)
- src/components/ui/ reusable primitives
- src/pages/ swipeable screens
- edge_assistant/ FastAPI orchestration and background workers
- esp32/ firmware and dashboard upload helpers

## Project conventions

### Adding relays

Edit RELAY_CONFIG in src/config/index.js.
Dashboard, timer, and voice command flows read from this array automatically.
Relay shape is { id, name, icon }.

### Multi-device routing

Edit DEVICE_CONFIG in src/config/index.js to map relays to multiple ESP32 nodes.
DeviceContext handles per-device health, polling, and websocket state.

### Backend host resolution

getBaseUrl() resolves backend host in this order:

1. localStorage key iot_base_url
2. VITE_API_BASE_URL
3. hardcoded fallback (current project default)

Never assume localhost for device control.

### Edge assistant base URL

VITE_EDGE_API_BASE_URL is optional.
If unset, it falls back to VITE_API_BASE_URL.
Set it explicitly when FastAPI edge assistant runs on a separate host or port (for example :8088).

### Mock mode

VITE_MOCK_MODE=true switches service calls to src/services/mock.js.
This can be toggled from env and from the Settings page.

### Voice pipeline (two flows)

1) Active mic button flow
- useVoiceCommand + VoiceMicButton + RobotMicButton
- Records audio with MediaRecorder
- Sends blob to Groq Whisper (not ESP32)
- Parses intent with LLM plus rule-based fallback
- Streams conversational fallback replies to robot speech and browser TTS

2) Idle wake-word flow
- useIdleVoice (browser SpeechRecognition API)
- Wake phrase: hey buddy
- Shows live interim transcript and streams response rendering
- Robot expression progression: LOADING -> THINKING -> HAPPY

### Keyboard shortcuts

- 1-4: Toggle relay 1-4
- R: Refresh relay status
- V: Toggle voice
- /: Open AI chat panel
- ?: Show help overlay
- Esc: Close/cancel
- Hold left Option (Alt): push-to-talk start/stop events

### Error handling

Service interceptors normalize errors to { message, status }.
UI reports failures via toast + robot expressions.
Voice fallback remains conversational even when ESP32 is unavailable.

## Testing

- Framework: Vitest + jsdom
- Setup: src/test/setup.js with @testing-library/jest-dom
- Pattern: colocated ComponentName.test.jsx
- Services are mocked with vi.mock where needed
- Vitest globals are enabled

## ESP32 API contract

```text
GET  /relays/status                   -> [{ id, isOn }]
POST /relays/toggle?id=X&state=1|0    -> { id, isOn }
GET  /smoke/status                    -> telemetry + policy snapshot
POST /smoke/policy                    -> updated smoke policy
GET  /health                          -> 200 OK
WS   /ws                              -> realtime relay updates
```

Firmware baseline notes:
- mDNS: http://esp32.local
- WebSocket path: /ws
- Active-LOW relays (LOW = ON)

## MQTT integration

- Broker: ad827adb37cb486d9a521c61763c31eb.s1.eu.hivemq.cloud
- Port: 8883 TLS
- Topic: Shreyansh/feeds/room-relay
- Payload 1/0: relay 1 on/off

## Deployment (Render)

render.yaml deploys a static site.
Set these env vars in Render (sync false):

- VITE_API_BASE_URL
- VITE_EDGE_API_BASE_URL (if edge API is separate)
- VITE_APP_PASSWORD
- VITE_GROQ_API_KEY
- VITE_PORCUPINE_ACCESS_KEY

## Security

- .env is gitignored. Use .env.example as template.
- VITE_* values are bundled client-side and must be treated as public.
- Change default VITE_APP_PASSWORD before deployment.
- Keep backend-only secrets in edge_assistant/.env (for example GROQ_API_KEY), not in frontend VITE_* variables.

## Performance requirements

- Avoid heavy animations on relay cards
- Use SVG + CSS for robot visuals (no canvas render loop)
- Keep context lookups O(1) via ID-keyed objects
- Build target remains es2020 for Porcupine BigInt WASM compatibility
- Maintain lightweight initial experience for Galaxy J6 class devices
