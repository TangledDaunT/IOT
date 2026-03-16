# Edge Assistant (Comprehensive Implementation)

This service adds a local always-on backend for your IoT dashboard:
- Local Whisper STT (CPU-first)
- Groq LLM intent parsing and assistant replies (Llama-3.3-70B-Instruct-fast)
- Groq TTS synthesis (canopylabs/orpheus-v1-english)
- Continuous 24/7 sensor worker
- Orchestrator event/state APIs for autonomous decisions and relay actions

## 1. Setup

```bash
cd edge_assistant
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Install ffmpeg if missing:

```bash
brew install ffmpeg
```

## 2. Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8088 --reload
```

In a second terminal, start the 24/7 workers:

```bash
python run_workers.py
```

## 3. Endpoints

- `GET /health`
- `POST /api/voice/transcribe` (multipart form field: `audio`)
- `POST /api/voice/parse`
- `POST /api/voice/respond`
- `POST /api/voice/tts`
- `POST /api/orchestrator/event`
- `GET /api/orchestrator/state`
- `POST /api/orchestrator/confirm-smoking?answer=true|false`

## 4. Notes

- Local STT requires ffmpeg and enough CPU for realtime-ish transcription.
- Groq API key is mandatory for LLM and TTS endpoints.
- Sensor worker polls smoke, relays, and room endpoints and feeds orchestrator state.
- If `ROOM_SENSOR_PATH` is not available in ESP32 firmware, room temperature/humidity/light will stay empty until firmware exposes them.
