"""In-memory orchestrator state and safety-gated autonomous actions."""

from __future__ import annotations

from app.services.action_executor import ActionExecutor
from app.services.notifier import Notifier
from app.config import Settings
from app.schemas import OrchestratorState


class OrchestratorService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._state = OrchestratorState()
        self._executor = ActionExecutor(settings)
        self._notifier = Notifier(settings)

    def get_state(self) -> OrchestratorState:
        return self._state

    def ingest_event(self, event_type: str, payload: dict) -> dict:
        action = {"executed": False, "reason": "no_action"}

        if event_type == "smoke_telemetry":
            self._state.smoke_active = bool(payload.get("smokeActive", False))
            self._state.sensors["smoke"] = payload

            if self._state.smoke_active and self._settings.autonomy_enabled:
                self._notifier.notify(
                    title="Smoke alert",
                    message="Smoke detected.",
                    meta={"smoke": payload},
                )

        if event_type == "room_snapshot":
            self._state.room = payload
            self._state.sensors["room"] = payload

            temperature = _to_float(payload.get("temperature"))
            humidity = _to_float(payload.get("humidity"))
            light_on = payload.get("lighting_status")

            # Safe autonomous behavior: if room is dark, turn light on.
            if (
                self._settings.autonomy_enabled
                and (light_on is False or str(light_on).lower() == "off")
                and "lights" in self._settings.autonomy_safe_actions
            ):
                action = {"executed": True, "action": "relay_control", "relay_id": 1, "state": "on"}
                action = self._executor.execute(action)
                self._append_action_log({"event_type": event_type, "decision": action})

            if temperature is not None and humidity is not None:
                self._state.sensors["comfort_index"] = {
                    "temperature": temperature,
                    "humidity": humidity,
                }

        if event_type == "smoke_uncertain" and self._settings.smoke_confirmation_required:
            self._state.pending_smoke_confirmation = True
            action = {
                "executed": True,
                "action": "ask_confirmation",
                "message": "Sir, are you smoking a cigarette right now?",
            }
            self._notifier.notify(
                title="Smoking confirmation required",
                message="Assistant needs confirmation: smoking detected uncertainly.",
                meta=payload,
            )

        self._append_action_log({"event_type": event_type, "payload": payload, "decision": action})
        return action

    def resolve_smoke_confirmation(self, is_smoking: bool) -> dict:
        self._state.pending_smoke_confirmation = False

        if not self._settings.autonomy_enabled:
            action = {"executed": False, "reason": "autonomy_disabled"}
        elif not is_smoking:
            action = {"executed": False, "reason": "user_declined"}
        elif self._settings.smoke_confirm_yes_action == "fan_off":
            action = {"executed": True, "action": "relay_control", "relay_id": 2, "state": "off"}
            action = self._executor.execute(action)
        else:
            action = {"executed": False, "reason": "unsupported_confirmation_action"}

        self._append_action_log({"event_type": "smoke_confirmation", "is_smoking": is_smoking, "decision": action})
        return action

    def _append_action_log(self, item: dict) -> None:
        self._state.last_actions.append(item)
        if len(self._state.last_actions) > 100:
            self._state.last_actions = self._state.last_actions[-100:]


def _to_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
