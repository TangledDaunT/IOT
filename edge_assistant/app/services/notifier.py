"""Notification adapter for mobile/webhook alerts."""

from __future__ import annotations

import httpx

from app.config import Settings


class Notifier:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def notify(self, title: str, message: str, meta: dict | None = None) -> dict:
        if not self._settings.notify_webhook_url:
            return {"sent": False, "reason": "notify_webhook_url_not_configured"}

        payload = {
            "title": title,
            "message": message,
            "meta": meta or {},
        }

        with httpx.Client(timeout=8.0) as client:
            resp = client.post(self._settings.notify_webhook_url, json=payload)
            resp.raise_for_status()

        return {"sent": True}
