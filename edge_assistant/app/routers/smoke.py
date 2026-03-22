"""Smoke API proxy routes with auth/MFA guards."""

from __future__ import annotations

import requests
from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings, get_settings
from app.security import rate_limit, require_api_token, require_mfa_token

router = APIRouter(prefix="/api/smoke", tags=["smoke"], dependencies=[Depends(require_api_token)])


def _join_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


@router.get("/status", dependencies=[Depends(rate_limit(80, 60))])
def smoke_status(settings: Settings = Depends(get_settings)):
    url = _join_url(settings.iot_base_url, settings.smoke_status_path)
    try:
        resp = requests.get(url, timeout=settings.iot_timeout_seconds)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Unable to reach IoT backend") from exc

    if not resp.ok:
        raise HTTPException(status_code=resp.status_code, detail="IoT backend error")

    return resp.json()


@router.post("/policy", dependencies=[Depends(require_mfa_token), Depends(rate_limit(20, 60))])
def smoke_policy_update(payload: dict, settings: Settings = Depends(get_settings)):
    if not settings.security_api_token:
        raise HTTPException(status_code=503, detail="Server security token is not configured")

    url = _join_url(settings.iot_base_url, "/smoke/policy")
    headers = {
        "Authorization": f"Bearer {settings.security_api_token}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=settings.iot_timeout_seconds)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Unable to reach IoT backend") from exc

    if not resp.ok:
        raise HTTPException(status_code=resp.status_code, detail="IoT backend rejected policy update")

    return resp.json()
