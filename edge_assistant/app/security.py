"""Shared security helpers: API auth, step-up MFA, and lightweight rate limiting."""

from __future__ import annotations

import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import Depends, Header, HTTPException, Request

from app.config import Settings, get_settings

_rate_lock = threading.Lock()
_rate_buckets: dict[str, deque[float]] = defaultdict(deque)

_mfa_lock = threading.Lock()
_mfa_challenges: dict[str, tuple[str, float]] = {}
_mfa_tokens: dict[str, float] = {}


def _client_key(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        ip = fwd.split(",", 1)[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"
    return f"{ip}:{request.url.path}"


def _require_configured_token(settings: Settings) -> str:
    token = (settings.security_api_token or "").strip()
    if not token:
        raise HTTPException(status_code=503, detail="Server security token is not configured")
    return token


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        return ""
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return ""
    return parts[1].strip()


def require_api_token(
    request: Request,
    authorization: str | None = Header(default=None),
    x_iot_token: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    expected = _require_configured_token(settings)
    provided = _extract_bearer(authorization) or (x_iot_token or "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def rate_limit(limit: int, window_seconds: int) -> Callable:
    if limit <= 0:
        raise ValueError("limit must be > 0")
    if window_seconds <= 0:
        raise ValueError("window_seconds must be > 0")

    def dependency(request: Request) -> None:
        now = time.time()
        key = _client_key(request)
        threshold = now - window_seconds

        with _rate_lock:
            bucket = _rate_buckets[key]
            while bucket and bucket[0] < threshold:
                bucket.popleft()
            if len(bucket) >= limit:
                raise HTTPException(status_code=429, detail="Too many requests")
            bucket.append(now)

    return dependency


def create_mfa_challenge(settings: Settings) -> tuple[str, int]:
    code = (settings.security_mfa_code or "").strip()
    if not code:
        raise HTTPException(status_code=503, detail="MFA code is not configured")

    challenge_id = secrets.token_urlsafe(18)
    expires_at = time.time() + settings.security_mfa_challenge_ttl_seconds

    with _mfa_lock:
        _mfa_challenges[challenge_id] = (code, expires_at)

    return challenge_id, settings.security_mfa_challenge_ttl_seconds


def verify_mfa_code(challenge_id: str, code: str, settings: Settings) -> tuple[str, int]:
    now = time.time()
    challenge_id = challenge_id.strip()
    code = code.strip()

    with _mfa_lock:
        entry = _mfa_challenges.pop(challenge_id, None)

    if not entry:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA challenge")

    expected_code, expires_at = entry
    if expires_at < now:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA challenge")
    if not code or not hmac.compare_digest(code, expected_code):
        raise HTTPException(status_code=401, detail="Invalid MFA code")

    token = secrets.token_urlsafe(24)
    token_expires = now + settings.security_mfa_token_ttl_seconds

    with _mfa_lock:
        _mfa_tokens[token] = token_expires

    return token, settings.security_mfa_token_ttl_seconds


def require_mfa_token(x_iot_mfa_token: str | None = Header(default=None)) -> None:
    token = (x_iot_mfa_token or "").strip()
    if not token:
        raise HTTPException(status_code=403, detail="Step-up authentication required")

    now = time.time()
    with _mfa_lock:
        exp = _mfa_tokens.get(token)
        if not exp or exp < now:
            _mfa_tokens.pop(token, None)
            raise HTTPException(status_code=403, detail="Step-up authentication required")
