"""24/7 sensor polling worker.

Polls existing IoT endpoints and forwards normalized snapshots to orchestrator.
"""

from __future__ import annotations

import time

import httpx

from app.config import get_settings


def _safe_get_json(client: httpx.Client, url: str):
    try:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def run() -> None:
    settings = get_settings()

    smoke_url = f"{settings.iot_base_url}{settings.smoke_status_path}"
    relay_url = f"{settings.iot_base_url}{settings.relay_status_path}"
    room_url = f"{settings.iot_base_url}{settings.room_sensor_path}"
    orchestrator_url = f"http://127.0.0.1:{settings.port}/api/orchestrator/event"

    with httpx.Client(timeout=settings.iot_timeout_seconds) as client:
        while True:
            smoke = _safe_get_json(client, smoke_url)
            relays = _safe_get_json(client, relay_url)
            room = _safe_get_json(client, room_url)

            if smoke is not None:
                payload = {
                    "event_type": "smoke_telemetry",
                    "payload": smoke.get("telemetry", smoke),
                }
                client.post(orchestrator_url, json=payload)

            if room is not None:
                client.post(orchestrator_url, json={"event_type": "room_snapshot", "payload": room})

            sensors_payload = {
                "timestamp": int(time.time() * 1000),
                "relays": relays,
                "room": room,
                "smoke": smoke,
            }
            client.post(orchestrator_url, json={"event_type": "sensor_snapshot", "payload": sensors_payload})

            time.sleep(max(settings.sensor_poll_interval_ms, 500) / 1000)


def main() -> None:
    run()


if __name__ == "__main__":
    main()
