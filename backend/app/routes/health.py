"""
Health check endpoints for LingoLeap backend.

GET /api/health          — basic liveness check (used by Cloud Run + uptime checks)
GET /api/health/detailed — component-level status (DB, AI service, version info)
"""

import logging
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])

# Record startup time for uptime calculation
_START_TIME = time.monotonic()
_START_DATETIME = datetime.now(timezone.utc)

# Application version — keep in sync with FastAPI app version in main.py
APP_VERSION = "0.3.0"


# `/health` 是監控工具的慣例路徑：uptime checker、Cloud Run、k8s probe、
# 負載平衡器預設都打它。以前只有 `/api/health` 存在，於是每小時的巡檢 tick
# 對 `/health` 拿到 404、開了一張「backend 掛了」的假 issue（#2737），
# 而後端一直是健康的。
#
# 兩條路徑共用同一個 handler —— 不是各寫一份。兩份健康狀態會分岔，
# 那時候就有兩個互相矛盾的「真相」，比 404 更難查。
@router.get("/health")
@router.get("/api/health")
def health_liveness():
    """Basic liveness check. Returns 200 when the process is running."""
    return {"status": "ok", "version": APP_VERSION}


@router.get("/api/health/detailed")
def health_detailed(db: Session = Depends(get_db)):
    """
    Detailed health check including component status.

    Returns:
        200 — all components healthy
        503 — one or more components degraded (body still returned for diagnostics)

    Components checked:
        - database: can execute a simple SELECT 1 query
        - ai_service: Vertex AI SDK importable and project configured
    """
    components: dict[str, dict] = {}
    overall_healthy = True

    # ------------------------------------------------------------------
    # 1. Database check
    # ------------------------------------------------------------------
    try:
        db.execute(text("SELECT 1"))
        components["database"] = {"status": "ok"}
    except Exception as exc:
        logger.error("Health check — database error: %s", exc)
        components["database"] = {"status": "error", "detail": "DB query failed"}
        overall_healthy = False

    # ------------------------------------------------------------------
    # 2. AI service check (Vertex AI SDK available)
    # ------------------------------------------------------------------
    try:
        from google import genai  # noqa: F401
        # ai_service.py hardcodes project="lingoleap-dev", no env var needed
        components["ai_service"] = {"status": "ok", "provider": "vertex_ai"}
    except ImportError:
        logger.warning("Health check — google-genai SDK not installed")
        components["ai_service"] = {
            "status": "error",
            "detail": "google-genai SDK not available",
        }
        overall_healthy = False

    # ------------------------------------------------------------------
    # Build response
    # ------------------------------------------------------------------
    uptime_seconds = int(time.monotonic() - _START_TIME)
    environment = os.environ.get("ENVIRONMENT", "development")

    body = {
        "status": "ok" if overall_healthy else "degraded",
        "version": APP_VERSION,
        "environment": environment,
        "uptime_seconds": uptime_seconds,
        "started_at": _START_DATETIME.isoformat(),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "components": components,
    }

    if not overall_healthy:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content=body)

    return body
