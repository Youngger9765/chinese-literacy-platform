"""Public feature flags consumed by the frontend (Issue #3838 kill switch).

GET /api/features lets the frontend decide, on load, whether to render AI
entry points (socratic tutor, OMO upload, exit-ticket generation, sentence
practice, teacher AI comment, etc.) at all — instead of showing a button
that always 503s. No auth required: this carries no sensitive information,
only a boolean the UI needs before a student logs in on some flows.
"""
from __future__ import annotations

from fastapi import APIRouter

from ..services.ai_feature_flag import ai_features_enabled

router = APIRouter(tags=["features"])


@router.get("/api/features")
def get_features() -> dict:
    """Feature flags the frontend uses to decide what to render.

    ai_features_enabled mirrors the server-side AI_FEATURES_ENABLED kill
    switch (#3838, security incident response). When false, every AI-calling
    endpoint fails closed with 503 and the frontend should hide the
    corresponding UI rather than let a student tap something that always
    errors.
    """
    return {"ai_features_enabled": ai_features_enabled()}
