"""Room automation and memory router."""

from __future__ import annotations

import base64
import io
import json
import os
import ssl
import subprocess
import threading
import time
from collections import Counter, deque
from typing import Any, Literal

import requests
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.security import rate_limit, require_api_token, require_mfa_token

try:
    from paho.mqtt import client as mqtt_client
except Exception:  # pragma: no cover - import availability depends on env
    mqtt_client = None

load_dotenv()

router = APIRouter(tags=["room"], dependencies=[Depends(require_api_token)])

ESP32_IP = os.getenv("ESP32_IP", "127.0.0.1")
ESP32_PORT = int(os.getenv("ESP32_PORT", "8000"))
MQTT_HOST = os.getenv("MQTT_HOST", "ad827adb37cb486d9a521c61763c31eb.s1.eu.hivemq.cloud")
MQTT_PORT = int(os.getenv("MQTT_PORT", "8883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
MQTT_TOPIC = "Shreyansh/feeds/room-relay"
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

room_state_lock = threading.Lock()
room_state: dict[str, Any] = {
    "people_in_room": 0,
    "alarm_active": False,
    "alarm_can_stop": False,
    "alarm_manual_stop_requested": False,
    "you_are_present": False,
    "strangers_present": False,
    "conversation_heat": "low",
    "last_updated": 0.0,
}

alarm_state: dict[str, Any] = {
    "alarm_active": False,
    "alarm_can_stop": False,
    "alarm_manual_stop_requested": False,
    "last_updated": 0.0,
}

audio_events: deque[dict[str, Any]] = deque(maxlen=50)
audio_events_lock = threading.Lock()

_mqtt_client = None
_mqtt_lock = threading.Lock()

_embedding_model_lock = threading.Lock()
_embedding_model: Any = None
try:
    from sentence_transformers import SentenceTransformer as _SentenceTransformer
    _embedding_model = _SentenceTransformer("all-MiniLM-L6-v2")
except Exception:
    pass


class PowerSavingPayload(BaseModel):
    enabled: bool


class AnnouncePayload(BaseModel):
    message: str = Field(min_length=1, max_length=160)


class AudioEventPayload(BaseModel):
    text: str = Field(default="", max_length=320)
    emotion: Literal["ang", "hap", "sad", "neu"] = "neu"
    timestamp: float


class StatePatchPayload(BaseModel):
    people_in_room: int | None = None
    alarm_active: bool | None = None
    alarm_can_stop: bool | None = None
    alarm_manual_stop_requested: bool | None = None
    you_are_present: bool | None = None
    strangers_present: bool | None = None
    conversation_heat: Literal["low", "medium", "high"] | None = None
    last_updated: float | None = None


class MemorySearchPayload(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=5, ge=1, le=50)


class StrangerAlertPayload(BaseModel):
    image_bytes_b64: str = Field(min_length=1, max_length=2_100_000)


def _log(message: str) -> None:
    print(f"[ROOM] {message}", flush=True)


def _build_toggle_url(relay_id: int, state: int) -> str:
    return f"http://{ESP32_IP}:{ESP32_PORT}/relays/toggle?id={relay_id}&state={state}"


def _announce_with_powershell(message: str) -> None:
    escaped = message.replace("'", "''")
    script = (
        "Add-Type -AssemblyName System.Speech; "
        "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$synth.Rate = 0; $synth.Volume = 100; "
        f"$synth.Speak('{escaped}')"
    )
    try:
        subprocess.Popen(
            ["powershell", "-NoProfile", "-Command", script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        _log(f"announce subprocess failed: {exc}")


def _start_announce_thread(message: str) -> None:
    t = threading.Thread(target=_announce_with_powershell, args=(message,), daemon=True)
    t.start()


def _on_mqtt_connect(client: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any = None) -> None:
    _log(f"mqtt connected rc={reason_code}")


def _get_mqtt_client() -> Any:
    global _mqtt_client
    if mqtt_client is None:
        return None

    with _mqtt_lock:
        if _mqtt_client is not None:
            return _mqtt_client

        client = mqtt_client.Client(client_id="edge_assistant_room", protocol=mqtt_client.MQTTv311)
        if MQTT_USERNAME and MQTT_PASSWORD:
            client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        client.tls_set(tls_version=ssl.PROTOCOL_TLS_CLIENT)
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        client.on_connect = _on_mqtt_connect
        try:
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            client.loop_start()
        except Exception as exc:
            _log(f"mqtt connect failed: {exc}")
        _mqtt_client = client
        return _mqtt_client


def _publish_mqtt_relay(relay_id: int, state: int) -> bool:
    client = _get_mqtt_client()
    if client is None:
        _log("mqtt unavailable: paho-mqtt not installed")
        return False

    payload = {"id": relay_id, "state": state}
    try:
        result = client.publish(MQTT_TOPIC, json.dumps(payload))
        if getattr(result, "rc", 1) != 0:
            _log(f"mqtt publish failed rc={result.rc}")
            return False
        return True
    except Exception as exc:
        _log(f"mqtt publish exception: {exc}")
        return False


def _toggle_relay(relay_id: int, on: bool) -> dict[str, Any]:
    state = 1 if on else 0
    http_ok = False
    mqtt_ok = False

    try:
        resp = requests.post(_build_toggle_url(relay_id, state), timeout=6)
        http_ok = resp.ok
        if not resp.ok:
            _log(f"esp32 toggle failed relay={relay_id} state={state} status={resp.status_code}")
    except Exception as exc:
        _log(f"esp32 toggle exception relay={relay_id} state={state}: {exc}")

    try:
        mqtt_ok = _publish_mqtt_relay(relay_id, state)
    except Exception as exc:
        _log(f"mqtt toggle exception relay={relay_id} state={state}: {exc}")

    return {
        "relay_id": relay_id,
        "requested_state": bool(on),
        "http_ok": http_ok,
        "mqtt_attempted": True,
        "mqtt_ok": mqtt_ok,
        "timestamp": time.time(),
    }


def _update_alarm_from_room_state() -> None:
    alarm_state["alarm_active"] = bool(room_state.get("alarm_active", False))
    alarm_state["alarm_can_stop"] = bool(room_state.get("alarm_can_stop", False))
    alarm_state["alarm_manual_stop_requested"] = bool(room_state.get("alarm_manual_stop_requested", False))
    alarm_state["last_updated"] = float(room_state.get("last_updated", time.time()))


def _get_embedder() -> Any:
    return _embedding_model


@router.get("/state")
async def get_room_state(_: None = Depends(rate_limit(100, 60))) -> dict[str, Any]:
    with room_state_lock:
        return dict(room_state)


@router.post("/state")
async def patch_room_state(
    payload: StatePatchPayload,
    _: None = Depends(rate_limit(40, 60)),
) -> dict[str, Any]:
    patch = payload.model_dump(exclude_none=True)
    with room_state_lock:
        room_state.update(patch)
        room_state["last_updated"] = float(patch.get("last_updated", time.time()))
        _update_alarm_from_room_state()
        return {"ok": True, "state": dict(room_state)}


@router.post("/relay/lights/on")
async def relay_lights_on(
    _: None = Depends(require_mfa_token),
) -> dict[str, Any]:
    return _toggle_relay(1, True)


@router.post("/relay/lights/off")
async def relay_lights_off(
    _: None = Depends(require_mfa_token),
) -> dict[str, Any]:
    return _toggle_relay(1, False)


@router.post("/relay/fan/on")
async def relay_fan_on(
    _: None = Depends(require_mfa_token),
) -> dict[str, Any]:
    return _toggle_relay(2, True)


@router.post("/relay/fan/off")
async def relay_fan_off(
    _: None = Depends(require_mfa_token),
) -> dict[str, Any]:
    return _toggle_relay(2, False)


@router.post("/relay/{relay_id}/{action}")
async def relay_generic(
    relay_id: int,
    action: Literal["on", "off"],
    _: None = Depends(require_mfa_token),
) -> dict[str, Any]:
    if relay_id < 1 or relay_id > 4:
        return {"ok": False, "error": "relay_id must be in range 1..4"}
    return _toggle_relay(relay_id, action == "on")


@router.post("/power_saving")
async def set_power_saving(
    payload: PowerSavingPayload,
    _: None = Depends(require_mfa_token),
) -> dict[str, Any]:
    if payload.enabled:
        actions = [_toggle_relay(1, False), _toggle_relay(2, False), _toggle_relay(3, False), _toggle_relay(4, False)]
    else:
        actions = []
    return {"ok": True, "enabled": payload.enabled, "actions": actions, "timestamp": time.time()}


@router.post("/announce")
async def announce(
    payload: AnnouncePayload,
    _: None = Depends(require_mfa_token),
) -> dict[str, Any]:
    _start_announce_thread(payload.message)
    return {"ok": True, "message": payload.message}


@router.post("/audio_event")
async def add_audio_event(
    payload: AudioEventPayload,
    _: None = Depends(rate_limit(80, 60)),
) -> dict[str, Any]:
    event = payload.model_dump()
    with audio_events_lock:
        audio_events.append(event)
        recent = list(audio_events)[-10:]
        angry_count = sum(1 for item in recent if item.get("emotion") == "ang")

    heat = "low"
    if angry_count >= 3:
        heat = "high"
    elif angry_count >= 1:
        heat = "medium"

    with room_state_lock:
        room_state["conversation_heat"] = heat
        room_state["last_updated"] = time.time()

    return {"ok": True, "event": event, "conversation_heat": heat}


@router.get("/audio_summary")
async def get_audio_summary(_: None = Depends(rate_limit(60, 60))) -> dict[str, Any]:
    with audio_events_lock:
        last_twenty = list(audio_events)[-20:]

    counts = Counter(item.get("emotion", "neu") for item in last_twenty)
    with room_state_lock:
        heat = room_state.get("conversation_heat", "low")

    return {
        "events": last_twenty,
        "emotion_counts": {
            "ang": int(counts.get("ang", 0)),
            "hap": int(counts.get("hap", 0)),
            "sad": int(counts.get("sad", 0)),
            "neu": int(counts.get("neu", 0)),
        },
        "conversation_heat": heat,
    }


@router.post("/alarm/stop_request")
async def set_alarm_stop_request(
    _: None = Depends(require_mfa_token),
) -> dict[str, Any]:
    with room_state_lock:
        room_state["alarm_manual_stop_requested"] = True
        room_state["last_updated"] = time.time()
        _update_alarm_from_room_state()
        return {"ok": True, "alarm_state": dict(alarm_state)}


@router.get("/alarm/state")
async def get_alarm_state(_: None = Depends(rate_limit(60, 60))) -> dict[str, Any]:
    with room_state_lock:
        _update_alarm_from_room_state()
        return dict(alarm_state)


@router.post("/stranger_alert")
async def stranger_alert(
    payload: StrangerAlertPayload,
    _: None = Depends(require_mfa_token),
) -> dict[str, Any]:
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return {"ok": False, "error": "telegram credentials missing"}

    try:
        image_bytes = base64.b64decode(payload.image_bytes_b64, validate=True)
        if len(image_bytes) > 1 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image payload too large")
        files = {"photo": ("stranger.jpg", io.BytesIO(image_bytes), "image/jpeg")}
        data = {"chat_id": TELEGRAM_CHAT_ID, "caption": "Stranger detected in room"}
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendPhoto"
        resp = requests.post(url, data=data, files=files, timeout=15)
        return {"ok": resp.ok, "status_code": resp.status_code}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Alert dispatch failed") from exc


@router.post("/memory/search")
async def memory_search(
    payload: MemorySearchPayload,
    _: None = Depends(rate_limit(24, 60)),
) -> dict[str, Any]:
    try:
        from qdrant_client import QdrantClient

        client = QdrantClient("localhost", port=6333)
        embedder = _get_embedder()
        vector = embedder.encode(payload.query).tolist()
        points = client.search(collection_name="shreyansh_memory", query_vector=vector, limit=payload.limit)

        return {
            "ok": True,
            "query": payload.query,
            "results": [
                {
                    "score": float(point.score),
                    "payload": point.payload,
                    "id": str(point.id),
                }
                for point in points
            ],
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Memory search failed") from exc
