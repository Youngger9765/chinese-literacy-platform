"""Shared request guards for the public QA-board tools — Issue #2534.

The spotlight-qa / keypoints-qa boards are unauthenticated, GCS-only endpoints
served from static pages (no login, human-testing only). Two reusable FastAPI
dependencies harden them:

- ``require_qa_token`` — fail-closed shared-secret gate. When
  ``settings.qa_tools_shared_secret`` is set, every request must carry a matching
  ``x-qa-token`` header or get 401. When the secret is empty/unset the gate is
  OPEN (local-dev escape hatch) and a single warning is logged.

- ``enforce_qa_content_length`` — reject oversized uploads based on the
  ``Content-Length`` request header with 413 *before* the body is read into
  memory / before any GCS write, so a forged large Content-Length can't force the
  server to buffer megabytes or touch storage.

Both are single, shared dependencies wired into all endpoints via the router
decorator's ``dependencies=[...]`` — not copy-pasted per endpoint.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import Header, HTTPException, Request

from app.config import settings

logger = logging.getLogger(__name__)

# A QA review JSON is far smaller than this; matches the per-route post-parse cap.
QA_TOOLS_MAX_BYTES = 4 * 1024 * 1024  # 4 MB

_warned_open = False


def require_qa_token(x_qa_token: str | None = Header(default=None)) -> None:
    """Fail-closed shared-secret gate for QA-board endpoints.

    - secret set + header missing/wrong → 401
    - secret set + header matches       → allow
    - secret empty/unset                → allow (open; log once)
    """
    secret = settings.qa_tools_shared_secret or ""
    if not secret:
        global _warned_open
        if not _warned_open:
            logger.warning(
                "QA tools shared secret is not set — QA board endpoints are OPEN. "
                "Set QA_TOOLS_SHARED_SECRET to require an x-qa-token header."
            )
            _warned_open = True
        return

    if not x_qa_token or not hmac.compare_digest(x_qa_token, secret):
        raise HTTPException(status_code=401, detail="invalid or missing x-qa-token")


def enforce_qa_content_length(request: Request) -> None:
    """Reject oversized bodies on the Content-Length header BEFORE parsing.

    Runs as a dependency (before the endpoint reads the body) so a request that
    declares more than the cap is rejected with 413 without buffering the body
    or reaching GCS. Endpoints keep a post-parse size check as defense-in-depth.
    """
    raw = request.headers.get("content-length")
    if raw is None:
        return
    try:
        declared = int(raw)
    except (TypeError, ValueError):
        return
    if declared > QA_TOOLS_MAX_BYTES:
        raise HTTPException(status_code=413, detail="payload too large (max 4MB)")
