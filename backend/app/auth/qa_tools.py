"""Shared request guards for the public QA-board tools — Issue #2534.

The spotlight-qa / keypoints-qa boards are unauthenticated, GCS-only endpoints
served from static pages (no login, human-testing only). Two reusable FastAPI
dependencies harden them:

- ``require_qa_token`` — fail-closed shared-secret gate. When
  ``settings.qa_tools_shared_secret`` is set, every request must carry a matching
  ``x-qa-token`` header or get 401. When the secret is empty/unset the gate is
  open **only off Cloud Run** (local-dev escape hatch); on a deployed service it
  returns 404. See that function for why (#3160, status code revised in #3169).

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
import os

from fastapi import Header, HTTPException, Request

from app.config import settings

logger = logging.getLogger(__name__)

# A QA review JSON is far smaller than this; matches the per-route post-parse cap.
QA_TOOLS_MAX_BYTES = 4 * 1024 * 1024  # 4 MB

_warned_open = False
_warned_closed = False


def require_qa_token(x_qa_token: str | None = Header(default=None)) -> None:
    """Fail-closed shared-secret gate for QA-board endpoints.

    - secret set + header missing/wrong  → 401
    - secret set + header matches        → allow
    - secret unset, off Cloud Run        → allow (local-dev escape hatch)
    - secret unset, ON Cloud Run         → 404 (#3160, code revised in #3169)

    Why the last line exists
    ------------------------
    This docstring already claimed "fail-closed" while the implementation
    returned early when the secret was empty, and ``QA_TOOLS_SHARED_SECRET`` is
    set in none of the three deploy workflows. So the gate was open on every
    deployed environment. Measured on 2026-09-11 with an unauthenticated GET:

        /api/spotlight-qa/reviews   prod 200 (count 0)   staging 200 (count 2)
        /api/keypoints-qa/reviews   prod 200 (count 0)   staging 200 (count 1)

    A bogus ``x-qa-token`` also got 200, so the gate was open rather than
    guessed; ``/api/classrooms`` on the same backend returned 401, so this was
    specific to these endpoints. The staging payload carries a ``reviewer``
    field, i.e. names of teachers and interns, readable by anyone.

    The module docstring is honest that these boards were *designed*
    unauthenticated -- static pages, human testing only. This is not someone
    forgetting a variable; it is optional hardening that was never switched on,
    on endpoints that later started carrying names.

    ⚠️ This will stop the QA boards working on staging until
    ``QA_TOOLS_SHARED_SECRET`` is set in the workflows. A briefly broken
    internal tool is much cheaper than publicly readable names.

    The discriminator is ``K_SERVICE`` (always set by Cloud Run) rather than
    ``ENVIRONMENT``, for two reasons: a backend run locally with
    ``ENVIRONMENT=staging`` is not publicly reachable, and keying on
    ENVIRONMENT would fail an existing lock that deliberately covers exactly
    that case without buying any security.

    Not 401 on purpose: the request is not wrong, so 401 would send whoever hits
    it hunting for a credential that does not exist anywhere yet.

    Not 5xx either, which is what this shipped as and had to be revised (#3169).
    Cloud Run stamps every 5xx **request** log with ``severity=ERROR``, and the
    ``LingoLeap Backend Errors`` alert policy fires on
    ``severity>=ERROR`` for this service with no path or status exclusion. So the
    status code *is* the alert trigger, independently of what this module logs --
    #3166 lowered the log level here and the alert still fired, because it was
    never the log that rang it.

    404 is both quiet and accurate: this deployment does not serve the QA board.
    The detail string has to keep naming the missing setting, because a 404 is
    otherwise indistinguishable from a mistyped path.
    """
    secret = settings.qa_tools_shared_secret or ""
    if not secret:
        if os.environ.get("K_SERVICE"):
            # WARNING once per process, not ERROR per request (#3166) -- and 404
            # rather than 5xx (#3169). Those are two separate fixes to the same
            # alert, and only the second one actually silenced it.
            #
            # #3160 shipped this as logger.error on every refused request, which
            # fired the "LingoLeap Backend Errors" alert policy within two minutes
            # of deploying -- triggered by my own two verification curls. #3166
            # lowered that to WARNING-once, and the application log did go quiet
            # (measured: zero stderr ERROR entries afterwards). The alert fired
            # again anyway.
            #
            # The reason is that the ERROR feeding the alert was never ours:
            #
            #     logName:  .../logs/run.googleapis.com%2Frequests
            #     severity: ERROR
            #     httpRequest.status: 503
            #
            # Cloud Run marks every 5xx request log ERROR, and the policy watches
            # severity>=ERROR with no path or status exclusion. The status code was
            # the trigger the whole time; I had fixed the wrong layer.
            #
            # An unconfigured secret is an expected, benign state here -- the
            # secret is deliberately unset since #3160 -- so reporting it as a
            # server fault keeps an alert ringing during normal operation, which
            # trains people to ignore it. Same disease as a gate that false-alarms.
            #
            # ⚠️ Scope: only this deliberate-disabled path moves off 5xx. A real
            # storage failure in the routes still answers 503, because that one
            # should wake someone. There is a positive control for exactly that in
            # tests/test_qa_token_fail_closed_3160.py.
            global _warned_closed
            if not _warned_closed:
                logger.warning(
                    "QA board endpoints are refusing with 404: QA_TOOLS_SHARED_SECRET "
                    "is not set on a deployed service. Set it in the deploy workflow "
                    "to re-enable the board."
                )
                _warned_closed = True
            raise HTTPException(
                status_code=404,
                detail="QA board is disabled: QA_TOOLS_SHARED_SECRET is not configured",
            )
        global _warned_open
        if not _warned_open:
            logger.warning(
                "QA tools shared secret is not set — QA board endpoints are OPEN. "
                "This is allowed only off Cloud Run (local development)."
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
