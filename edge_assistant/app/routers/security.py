"""Security routes for step-up MFA token flow."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.security import create_mfa_challenge, rate_limit, require_api_token, verify_mfa_code

router = APIRouter(prefix="/api/security", tags=["security"], dependencies=[Depends(require_api_token)])


class MfaChallengeResponse(BaseModel):
    challenge_id: str
    expires_in_s: int


class MfaVerifyRequest(BaseModel):
    challenge_id: str = Field(min_length=8, max_length=128)
    code: str = Field(min_length=4, max_length=64)


class MfaVerifyResponse(BaseModel):
    mfa_token: str
    expires_in_s: int


@router.post("/mfa/challenge", response_model=MfaChallengeResponse, dependencies=[Depends(rate_limit(6, 60))])
def mfa_challenge(settings: Settings = Depends(get_settings)) -> MfaChallengeResponse:
    challenge_id, ttl = create_mfa_challenge(settings)
    return MfaChallengeResponse(challenge_id=challenge_id, expires_in_s=ttl)


@router.post("/mfa/verify", response_model=MfaVerifyResponse, dependencies=[Depends(rate_limit(12, 60))])
def mfa_verify(req: MfaVerifyRequest, settings: Settings = Depends(get_settings)) -> MfaVerifyResponse:
    token, ttl = verify_mfa_code(req.challenge_id, req.code, settings)
    return MfaVerifyResponse(mfa_token=token, expires_in_s=ttl)
