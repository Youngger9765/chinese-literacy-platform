"""Public feature flags consumed by the frontend (#3838 kill switch, #3861 scope correction).

GET /api/features lets the frontend decide, on load, whether to render AI
entry points at all — instead of showing a button that always 503s. No auth
required: this carries no sensitive information, only booleans the UI needs
before a student logs in on some flows.

Two flags:
  - ai_features_enabled: the general AI gate (#3838). Mirrors the server's
    AI_FEATURES_ENABLED (default ON — see ai_feature_flag.py). When false,
    EVERY AI-calling endpoint fails closed with 503 and the frontend should
    hide all AI entry points (reading transcription, OMO upload, exit-ticket
    generation, sentence practice, teacher AI comment, etc.).
  - ai_chatbot_enabled: the chatbot-specific gate (#3861). Mirrors the
    server's AI_CHATBOT_ENABLED (default OFF). When false, only the
    conversational Socratic tutor UI (the comprehension chat / "ask the AI"
    helper) should hide itself — everything else is governed by
    ai_features_enabled alone.
"""
from __future__ import annotations

from fastapi import APIRouter

from ..services.ai_feature_flag import ai_chatbot_enabled, ai_features_enabled

router = APIRouter(tags=["features"])


@router.get("/api/features")
def get_features() -> dict:
    """Feature flags the frontend uses to decide what to render.

    ai_features_enabled mirrors the server-side AI_FEATURES_ENABLED gate
    (#3838). ai_chatbot_enabled mirrors AI_CHATBOT_ENABLED (#3861) and only
    affects the conversational Socratic tutor UI.
    """
    return {
        "ai_features_enabled": ai_features_enabled(),
        "ai_chatbot_enabled": ai_chatbot_enabled(),
    }
