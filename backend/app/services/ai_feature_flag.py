"""AI feature flags (Issue #3838 security incident; scope-corrected #3861).

Context: a sister project (ai-square) had its GCP service account key stolen
via an RCE and was billed for Vertex AI abuse. Young ordered every AI feature
in LingoLeap turned OFF and HIDDEN as an emergency precaution (#3838),
independent of whether LingoLeap itself was compromised.

#3861 scope correction: #3838's blanket kill switch went further than
intended — it turned off reading transcription/scoring, OMO grading, AI
teacher comments, and every other AI feature along with the conversational
Socratic tutor. Vertex AI access has since been re-enabled on the GCP side,
and only the chatbot / conversational surface needs to stay off. Two flags
now exist:

* ``AI_FEATURES_ENABLED`` — the general AI gate. Defaults ON (absent means
  enabled): AI features are expected to work normally. Setting it to the
  literal string ``"false"`` (case-insensitive, whitespace ignored) is the
  remaining emergency switch that turns off ALL AI at once, for a future
  incident of this kind.
* ``AI_CHATBOT_ENABLED`` — gates ONLY conversational/open-ended chat (the
  Socratic comprehension dialogue: ``/api/comprehension/chat`` and the
  deprecated ``/api/comprehension/question``). Defaults OFF (absent means
  disabled) and must be the literal string ``"true"`` to turn chat back on.
  Scoring, grading, and generation that happens inside a fixed learning step
  (reading transcription, OMO grading/identification, sentence/strategy
  validation, exit-ticket/story-structure generation, teacher comments, TTS)
  is NOT chatbot and is governed by ``AI_FEATURES_ENABLED`` alone.

Every call site that is about to create a Gemini/Vertex AI client or invoke
a generative model MUST call :func:`assert_ai_enabled` (non-chatbot) or
:func:`assert_chatbot_enabled` (conversational) first, before doing any
network-reaching work (building prompts is fine; creating a client or
calling ``generate_content`` is not). This is a fail-closed gate: when
disabled, nothing reaches Vertex AI, so the incident cannot be made worse by
this service regardless of whether the SA key here was ever touched.

Route handlers that have no other graceful-degradation path should also
depend on :func:`require_ai_enabled` / :func:`require_chatbot_enabled` (a
FastAPI dependency) so disabled requests get an immediate 503 without
running any of the handler body — including input sanitization, rate-limit
consumption, or DB writes.
"""

from __future__ import annotations

import os

from fastapi import HTTPException

AI_FEATURES_ENABLED_ENV = "AI_FEATURES_ENABLED"
AI_CHATBOT_ENABLED_ENV = "AI_CHATBOT_ENABLED"

# Short, non-technical message shown to students/teachers and returned as the
# HTTP body — see CLAUDE.md security rules: no stack traces, no internal
# paths, nothing that helps an attacker understand internals.
DISABLED_MESSAGE_ZH = "AI 功能暫時關閉"
DISABLED_MESSAGE_CHATBOT_ZH = "AI 聊天功能暫時關閉"


class AIFeaturesDisabledError(RuntimeError):
    """Raised by a gated call site when AI is off (general or chatbot gate).

    Subclasses RuntimeError on purpose: several existing routes already have
    `except RuntimeError as e: raise HTTPException(503, detail=str(e))`
    handlers (socratic chat, MCQ rescue, etc.) written for their own
    circuit-breaker errors. Reusing RuntimeError means this exception rides
    those existing 503 paths for free, in addition to the dedicated
    FastAPI exception handler registered in main.py for routes that don't
    already have such a handler.
    """

    def __init__(self, feature: str = "ai", message: str = DISABLED_MESSAGE_ZH) -> None:
        self.feature = feature
        super().__init__(f"{message}（{feature}）")


def ai_features_enabled() -> bool:
    """True unless AI_FEATURES_ENABLED is explicitly the literal "false".

    Default (absent, empty, any other value) is ON — AI features are
    expected to work normally. Setting AI_FEATURES_ENABLED=false
    (case-insensitive, whitespace ignored) is the emergency kill switch for
    ALL AI, used during a security incident like #3838.
    """
    return os.environ.get(AI_FEATURES_ENABLED_ENV, "").strip().lower() != "false"


def ai_chatbot_enabled() -> bool:
    """True only when AI_CHATBOT_ENABLED is exactly "true" (case-insensitive).

    Default (absent, empty, "false", typos, etc.) is OFF — the conversational
    Socratic tutor stays disabled per #3861 until an operator explicitly
    opts back in. This mirrors the original #3838 allow-list design (exactly
    one spelling turns it on) because chat is the surface that stays off by
    default going forward.
    """
    return os.environ.get(AI_CHATBOT_ENABLED_ENV, "").strip().lower() == "true"


def assert_ai_enabled(feature: str = "ai") -> None:
    """Raise AIFeaturesDisabledError if the general AI gate is off.

    Call this before any code that would create a Gemini/Vertex AI client
    or otherwise reach the model for a non-chatbot feature (scoring,
    grading, generation inside a fixed learning step) — and call it OUTSIDE
    of any try/except that would swallow the exception into a generic "AI
    failed, here's a canned fallback" response. Swallowing it defeats the
    point: a disabled feature must be visibly disabled (503), not silently
    degraded.
    """
    if not ai_features_enabled():
        raise AIFeaturesDisabledError(feature, DISABLED_MESSAGE_ZH)


def assert_chatbot_enabled(feature: str = "chatbot") -> None:
    """Raise AIFeaturesDisabledError if conversational AI is off.

    Chatbot/conversational call sites (the Socratic comprehension dialogue)
    need BOTH gates: the general kill switch (a full-incident "AI off
    everywhere" override) AND the chatbot-specific flag introduced by #3861.
    Checking the general gate first means a full `AI_FEATURES_ENABLED=false`
    incident still blocks chat even if someone left AI_CHATBOT_ENABLED=true
    set from before.
    """
    assert_ai_enabled(feature)
    if not ai_chatbot_enabled():
        raise AIFeaturesDisabledError(feature, DISABLED_MESSAGE_CHATBOT_ZH)


def require_ai_enabled() -> None:
    """FastAPI dependency form of :func:`assert_ai_enabled`.

    Use via `dependencies=[Depends(require_ai_enabled)]` on any non-chatbot
    route whose handler would otherwise catch AIFeaturesDisabledError and
    degrade gracefully (silently falling back to a canned response, or
    requiring several consecutive failures before surfacing an error).
    Running as a decorator-level dependency means it is evaluated before the
    route body — and before other decorator-level / parameter dependencies
    declared after it — so none of the handler's work (sanitization,
    rate-limit consumption, DB writes, scheduling a background task) happens
    at all while AI is disabled.
    """
    if not ai_features_enabled():
        raise HTTPException(status_code=503, detail=DISABLED_MESSAGE_ZH)


def require_chatbot_enabled() -> None:
    """FastAPI dependency form of :func:`assert_chatbot_enabled`.

    Use on chatbot/conversational routes (the Socratic comprehension
    dialogue) instead of :func:`require_ai_enabled` — 503s when EITHER the
    general gate or the chatbot-specific gate is off, before the route body
    (and any silent-fallback except clause inside it) runs.
    """
    if not ai_features_enabled():
        raise HTTPException(status_code=503, detail=DISABLED_MESSAGE_ZH)
    if not ai_chatbot_enabled():
        raise HTTPException(status_code=503, detail=DISABLED_MESSAGE_CHATBOT_ZH)
