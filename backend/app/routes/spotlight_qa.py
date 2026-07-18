"""聚光燈 QA Board 儲存 (人工測試用) — GCS-only, no DB.

比照人聲測試集 (testset.py) 的隔離模式:公開靜態頁 (frontend/public/spotlight-qa/)
把一包 QA review JSON 打到這裡,存進 GCS 獨立 prefix,供人工審查用。

設計(為何 GCS-only 無 DB):
- alembic 目前 multi-head,依專案鐵律不在此情況下新建 migration。
- 每筆 review 存 GCS: spotlight-qa/{reviewer_slug}/{ts}-{uid}.json
- 與學生 attempt、testset 音檔皆完全隔離(獨立 prefix),重用既有 reading-audio bucket。

隔離 / 不影響正式環境:
- 獨立 GCS prefix `spotlight-qa/`,不進 DB。
- staging / prod 用不同 bucket(READING_AUDIO_GCS_BUCKET);另外 ENVIRONMENT==production
  時直接 403 拒絕寫入 —— 此功能純人工測試用,不該在正式環境落地。

安全:
- 公開 endpoint → 靠全域 GlobalRateLimitMiddleware(per-IP)+ body size cap + fail-closed。
- reviewer 名進 blob path → _slug 白名單化;load 的 path 參數須以 prefix 開頭(擋跨 prefix 讀取)。
- 無 LLM import(llm-endpoint-hardening 不適用);無 DB migration。
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..auth.qa_tools import enforce_qa_content_length, require_qa_token
from ..services.audio_upload_service import _get_gcs_bucket

logger = logging.getLogger(__name__)

router = APIRouter(tags=["spotlight-qa"])

_PREFIX = "spotlight-qa"
_MAX_BYTES = 4 * 1024 * 1024  # 4 MB:一份 review JSON 遠小於此
_LIST_CAP = 500  # list_blobs 硬上限,避免 unbounded read
# 只讀回本 prefix 底下的 .json,擋路徑注入 / 跨 prefix 讀取
_PATH_RE = re.compile(rf"^{_PREFIX}/[A-Za-z0-9_\-一-鿿]+/[0-9A-Za-z_\-]+\.json$")


def _slug(name: str) -> str:
    """Stable, path-safe slug from reviewer name.

    Charset aligned with _PATH_RE's reviewer segment (ASCII word + BMP CJK) so a name
    that saves can always be read back — non-BMP / accented names degrade to '_' rather
    than producing a blob path that _PATH_RE later rejects on load (M2).
    """
    s = re.sub(r"[^A-Za-z0-9_一-鿿]+", "_", (name or "").strip())
    return (s.strip("_") or "anon")[:40]


def _is_production() -> bool:
    """Fail-closed: unknown/missing env on Cloud Run → treated as production (writes blocked).

    This is a public unauthenticated write endpoint, so the gate must fail CLOSED. We can't
    reuse config.is_dev — it counts staging as non-dev and would block staging too (板子就不能用).
    """
    env = os.environ.get("ENVIRONMENT", "").lower()
    if env in ("staging", "development", "preview"):
        return False
    if env == "production":
        return True
    # Unset/unknown on Cloud Run (K_SERVICE present) → fail-closed as prod; local (no K_SERVICE) → allow
    return bool(os.environ.get("K_SERVICE"))


@router.post(
    "/spotlight-qa/save",
    dependencies=[Depends(require_qa_token), Depends(enforce_qa_content_length)],
)
async def spotlight_qa_save(request: Request):
    """存一份聚光燈 QA review JSON(無登入,人工測試用)。

    Returns: { ok, path } on success; 4xx on validation; 403 in production; 503 if GCS down.

    Auth + early Content-Length cap run as dependencies (#2534) BEFORE the body is
    read; body is parsed manually here so a forged large Content-Length is rejected
    without buffering it or touching GCS.
    """
    # 純人工測試用:正式環境不接受寫入
    if _is_production():
        raise HTTPException(403, "spotlight QA save is disabled in production")

    body_bytes = await request.body()
    if len(body_bytes) > _MAX_BYTES:  # post-parse cap, defense-in-depth
        raise HTTPException(413, "payload too large (max 4MB)")
    try:
        payload = json.loads(body_bytes)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(400, "payload must be valid JSON")

    if not isinstance(payload, dict) or "lessons" not in payload:
        raise HTTPException(400, "payload must be a spotlight-qa export object (missing 'lessons')")

    try:
        raw = json.dumps(payload, ensure_ascii=False)
    except (TypeError, ValueError):
        raise HTTPException(400, "payload is not JSON-serialisable")
    if len(raw.encode("utf-8")) > _MAX_BYTES:
        raise HTTPException(413, "payload too large (max 4MB)")

    bucket = _get_gcs_bucket()
    if bucket is None:
        raise HTTPException(503, "storage temporarily unavailable")

    slug = _slug(str(payload.get("reviewer") or "anon"))
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    uid = uuid.uuid4().hex[:8]
    path = f"{_PREFIX}/{slug}/{ts}-{uid}.json"
    try:
        bucket.blob(path).upload_from_string(raw, content_type="application/json")
    except Exception as exc:  # never leak internals; fail-closed
        logger.warning("spotlight-qa save failed: path=%s err=%s", path, exc)
        raise HTTPException(503, "save failed, please retry")

    logger.info("spotlight-qa save OK: %s (%d bytes)", path, len(raw))
    return {"ok": True, "path": path}


@router.get("/spotlight-qa/reviews", dependencies=[Depends(require_qa_token)])
def spotlight_qa_reviews():
    """列出已存的 review(供雲端載入清單)。reviewer / 時間直接從 path 解,不下載內容。"""
    bucket = _get_gcs_bucket()
    if bucket is None:
        return {"ok": False, "reviews": [], "reason": "storage unavailable"}

    out = []
    try:
        for blob in bucket.list_blobs(prefix=f"{_PREFIX}/", max_results=_LIST_CAP):
            if not blob.name.endswith(".json"):
                continue
            parts = blob.name.split("/")
            reviewer = parts[1] if len(parts) >= 3 else ""
            fname = parts[-1][: -len(".json")]  # {ts}-{uid}
            ts = fname.split("-")[0]
            out.append(
                {
                    "path": blob.name,
                    "reviewer": reviewer,
                    "saved_at": ts,
                    "size": blob.size,
                }
            )
    except Exception as exc:
        logger.warning("spotlight-qa list failed: %s", exc)
        return {"ok": False, "reviews": [], "reason": "list failed"}

    out.sort(key=lambda m: m.get("path", ""), reverse=True)
    return {"ok": True, "count": len(out), "reviews": out}


@router.get("/spotlight-qa/review", dependencies=[Depends(require_qa_token)])
def spotlight_qa_review(path: str = Query(...)):
    """讀回一份 review JSON(供載回續審)。path 須落在 spotlight-qa/ prefix。"""
    if not _PATH_RE.match(path):
        raise HTTPException(400, "invalid path")
    bucket = _get_gcs_bucket()
    if bucket is None:
        raise HTTPException(503, "storage temporarily unavailable")
    blob = bucket.blob(path)
    try:
        if not blob.exists():
            raise HTTPException(404, "review not found")
        return json.loads(blob.download_as_text())
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("spotlight-qa read failed: path=%s err=%s", path, exc)
        raise HTTPException(503, "read failed, please retry")
