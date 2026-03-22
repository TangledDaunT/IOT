"""Timetable alarm worker with state-machine based wake flow."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pygame
import requests
from apscheduler.schedulers.background import BackgroundScheduler

IOT_BRIDGE = "http://localhost:8088"
WORKER_ROOT = Path(__file__).resolve().parents[1]
TIMETABLE_PATH = WORKER_ROOT / "timetable.json"
ALARM_AUDIO_PATH = WORKER_ROOT / "alarm.mp3"

STATE_IDLE = 0
STATE_GENTLE = 1
STATE_LOUD = 2
STATE_STOPPED = 3


@dataclass
class AlarmContext:
    state: int = STATE_IDLE
    gentle_started_at: float = 0.0
    next_poll_at: float = 0.0
    start_requested: bool = False


def _log(message: str) -> None:
    print(f"[ALARM] {message}", flush=True)


def _post(endpoint: str, payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
    try:
        response = requests.post(f"{IOT_BRIDGE}{endpoint}", json=payload, timeout=10)
        if response.headers.get("content-type", "").startswith("application/json"):
            return response.json()
    except Exception as exc:
        _log(f"post failed endpoint={endpoint}: {exc}")
    return None


def _get(endpoint: str) -> dict[str, Any]:
    try:
        response = requests.get(f"{IOT_BRIDGE}{endpoint}", timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        _log(f"get failed endpoint={endpoint}: {exc}")
        return {}


def _load_timetable() -> dict[str, list[str]]:
    if not TIMETABLE_PATH.exists():
        _log(f"timetable not found: {TIMETABLE_PATH}")
        return {}
    with TIMETABLE_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return {str(k).lower(): list(v) for k, v in data.items()}


def _compute_tomorrow_alarm() -> datetime | None:
    timetable = _load_timetable()
    tomorrow = datetime.now() + timedelta(days=1)
    weekday = tomorrow.strftime("%A").lower()
    slots = timetable.get(weekday, [])
    if not slots:
        return None

    first_class = min(slots)
    hour_str, minute_str = first_class.split(":", 1)
    class_dt = tomorrow.replace(hour=int(hour_str), minute=int(minute_str), second=0, microsecond=0)
    return class_dt - timedelta(hours=1)


def _schedule_alarm_for_tomorrow(scheduler: BackgroundScheduler, ctx: AlarmContext) -> None:
    alarm_time = _compute_tomorrow_alarm()
    scheduler.remove_all_jobs()
    if alarm_time is None:
        _log("no classes tomorrow; skipping alarm schedule")
        return

    if alarm_time <= datetime.now():
        _log(f"computed alarm in the past ({alarm_time.isoformat()}); skipping")
        return

    def _request_alarm_start() -> None:
        ctx.start_requested = True
        _log("alarm start requested")

    scheduler.add_job(_request_alarm_start, "date", run_date=alarm_time, id="next-alarm")
    _log(f"scheduled alarm at {alarm_time.isoformat()}")


def _daily_reschedule(scheduler: BackgroundScheduler, ctx: AlarmContext) -> None:
    _schedule_alarm_for_tomorrow(scheduler, ctx)


def _state_name(state: int) -> str:
    return {
        STATE_IDLE: "IDLE",
        STATE_GENTLE: "GENTLE",
        STATE_LOUD: "LOUD",
        STATE_STOPPED: "STOPPED",
    }.get(state, "UNKNOWN")


def _enter_gentle(ctx: AlarmContext) -> None:
    _log("enter GENTLE")
    _post("/room/relay/lights/on")
    _post("/room/relay/fan/off")
    _post("/room/state", {"alarm_active": True, "last_updated": time.time()})
    ctx.state = STATE_GENTLE
    ctx.gentle_started_at = time.time()
    ctx.next_poll_at = time.time()


def _enter_loud(ctx: AlarmContext) -> None:
    _log("enter LOUD")
    ctx.state = STATE_LOUD
    ctx.next_poll_at = time.time()
    try:
        if ALARM_AUDIO_PATH.exists():
            pygame.mixer.music.load(str(ALARM_AUDIO_PATH))
            pygame.mixer.music.play(-1)
            _log("alarm audio started")
        else:
            _log(f"alarm audio missing at {ALARM_AUDIO_PATH}")
    except Exception as exc:
        _log(f"pygame audio start failed: {exc}")


def _enter_stopped(ctx: AlarmContext) -> None:
    _log("enter STOPPED")
    ctx.state = STATE_STOPPED


def _handle_stopped(ctx: AlarmContext) -> None:
    try:
        pygame.mixer.music.stop()
    except Exception:
        pass

    _post("/room/relay/fan/on")
    _post(
        "/room/state",
        {
            "alarm_active": False,
            "alarm_can_stop": False,
            "alarm_manual_stop_requested": False,
            "last_updated": time.time(),
        },
    )
    ctx.state = STATE_IDLE
    ctx.start_requested = False
    _log("returned to IDLE")


def _handle_gentle(ctx: AlarmContext) -> None:
    now = time.time()
    if now < ctx.next_poll_at:
        return

    state = _get("/room/state")
    alarm_can_stop = bool(state.get("alarm_can_stop", False))
    people_in_room = int(state.get("people_in_room", 0) or 0)

    if alarm_can_stop or people_in_room == 0:
        _enter_stopped(ctx)
        return

    if now - ctx.gentle_started_at >= 300:
        _enter_loud(ctx)
        return

    ctx.next_poll_at = now + 10


def _handle_loud(ctx: AlarmContext) -> None:
    now = time.time()
    if now < ctx.next_poll_at:
        return

    state = _get("/room/state")
    alarm_can_stop = bool(state.get("alarm_can_stop", False))
    manual_stop_requested = bool(state.get("alarm_manual_stop_requested", False))

    if manual_stop_requested:
        if alarm_can_stop:
            _enter_stopped(ctx)
            return
        _post("/room/state", {"alarm_manual_stop_requested": False, "last_updated": time.time()})
        _post("/room/announce", {"message": "Camera says you're still in bed. Get up first."})

    if alarm_can_stop:
        _enter_stopped(ctx)
        return

    ctx.next_poll_at = now + 30


def run() -> None:
    try:
        pygame.mixer.init()
    except Exception as exc:
        _log(f"pygame mixer init failed: {exc}")

    ctx = AlarmContext()

    scheduler = BackgroundScheduler()
    scheduler.add_job(lambda: _daily_reschedule(scheduler, ctx), "cron", hour=22, minute=0, id="daily-reschedule")
    scheduler.start()

    _schedule_alarm_for_tomorrow(scheduler, ctx)
    _log("worker started")

    while True:
        try:
            if ctx.start_requested and ctx.state == STATE_IDLE:
                _enter_gentle(ctx)

            if ctx.state == STATE_GENTLE:
                _handle_gentle(ctx)
            elif ctx.state == STATE_LOUD:
                _handle_loud(ctx)
            elif ctx.state == STATE_STOPPED:
                _handle_stopped(ctx)

            time.sleep(1)
        except Exception as exc:
            _log(f"loop error in state={_state_name(ctx.state)}: {exc}")
            time.sleep(1)


if __name__ == "__main__":
    run()
