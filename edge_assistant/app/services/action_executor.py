"""Executes safe autonomous actions against the IoT backend."""

from __future__ import annotations

import httpx

from app.config import Settings


class ActionExecutor:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def execute(self, action: dict) -> dict:
        if not action.get("executed"):
            return action

        kind = action.get("action")
        if kind != "relay_control":
            return action

        relay_id = action.get("relay_id")
        state = action.get("state")
        if relay_id is None or state not in {"on", "off"}:
            return {"executed": False, "reason": "invalid_relay_action"}

        target_state = "1" if state == "on" else "0"
        url = f"{self._settings.iot_base_url}{self._settings.relay_toggle_path}"

        with httpx.Client(timeout=self._settings.iot_timeout_seconds) as client:
            resp = client.post(url, params={"id": relay_id, "state": target_state})
            resp.raise_for_status()
            payload = resp.json()

        return {
            "executed": True,
            "action": "relay_control",
            "relay_id": relay_id,
            "state": "on" if payload.get("isOn") else "off",
            "provider": "iot_api",
        }
