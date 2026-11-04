"""AI feature kill switch (Issue #3838 — security incident response).

Context: a sister project (ai-square) had its GCP service account key stolen
via an RCE and was billed for Vertex AI abuse. Young ordered every AI feature
in LingoLeap turned OFF and HIDDEN as an emergency precaution, independent of
whether LingoLeap itself was compromised.

``AI_FEATURES_ENABLED`` must be the literal string ``"true"`` (case
insensitive, surrounding whitespace ignored) for AI features to run. Any
other value — or the variable being absent entirely — means AI is OFF.
Default is OFF: an operator must explicitly opt back in once the incident is
cleared. This file intentionally does NOT set ``AI_FEATURES_ENABLED=true``
anywhere — re-enabling is a deliberate deploy-config change made later.

Every call site that is about to create a Gemini/Vertex AI client or invoke
a generative model MUST call :func:`assert_ai_enabled` first, before doing
any network-reaching work (building prompts is fine; creating a client or
calling ``generate_content`` is not). This is a fail-closed gate: when
disabled, nothing reaches Vertex AI, so the incident cannot be made worse by
this service regardless of whether the SA key here was ever touched.

Route handlers that have no other graceful-degradation path should also
depend on :func:`require_ai_enabled` (a FastAPI dependency) so disabled
requests get an immediate 503 without running any of the handler body —
including input sanitization, rate-limit consumption, or DB writes.
"""

from __future__ import annotations

import os

from fastapi import HTTPException

AI_FEATURES_ENABLED_ENV = "AI_FEATURES_ENABLED"

# Short, non-technical message shown to students/teachers and returned as the
# HTTP body — see CLAUDE.md security rules: no stack traces, no internal
# paths, nothing that helps an attacker understand internals.
DISABLED_MESSAGE_ZH = "AI 功能暫時關閉"


class AIFeaturesDisabledError(RuntimeError):
    """Raised by a gated call site when AI_FEATURES_ENABLED is not 'true'.

    Subclasses RuntimeError on purpose: several existing routes already have
    `except RuntimeError as e: raise HTTPException(503, detail=str(e))`
    handlers (socratic chat, MCQ rescue, etc.) written for their own
    circuit-breaker errors. Reusing RuntimeError means this exception rides
    those existing 503 paths for free, in addition to the dedicated
    FastAPI exception handler registered in main.py for routes that don't
    already have such a handler.
    """

    def __init__(self, feature: str = "ai") -> None:
        self.feature = feature
        super().__init__(f"{DISABLED_MESSAGE_ZH}（{feature}）")


def ai_features_enabled() -> bool:
    """True only when AI_FEATURES_ENABLED is exactly 'true' (case-insensitive).

    Absent, empty, "false", "0", "yes", typos, etc. all mean disabled —
    there is exactly one spelling that turns AI on, so a deploy-config typo
    fails closed instead of accidentally re-enabling billing.
    """
    return os.environ.get(AI_FEATURES_ENABLED_ENV, "").strip().lower() == "true"


def assert_ai_enabled(feature: str = "ai") -> None:
    """Raise AIFeaturesDisabledError if AI features are off.

    Call this before any code that would create a Gemini/Vertex AI client
    or otherwise reach the model — and call it OUTSIDE of any try/except
    that would swallow the exception into a generic "AI failed, here's a
    canned fallback" response. Swallowing it defeats the point: a disabled
    feature must be visibly disabled (503), not silently degraded.
    """
    if not ai_features_enabled():
        raise AIFeaturesDisabledError(feature)


def require_ai_enabled() -> None:
    """FastAPI dependency form of :func:`assert_ai_enabled`.

    Use via `dependencies=[Depends(require_ai_enabled)]` on any route whose
    handler would otherwise catch AIFeaturesDisabledError and degrade
    gracefully (silently falling back to a canned response, or requiring
    several consecutive failures before surfacing an error). Running as a
    decorator-level dependency means it is evaluated before the route body
    — and before other decorator-level / parameter dependencies declared
    after it — so none of the handler's work (sanitization, rate-limit
    consumption, DB writes, scheduling a background task) happens at all
    while AI is disabled.
    """
    if not ai_features_enabled():
        raise HTTPException(status_code=503, detail=DISABLED_MESSAGE_ZH)
