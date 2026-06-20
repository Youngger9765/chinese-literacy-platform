"""人聲測試集收集 (Issue #2287) — v1, GCS-only, no DB.

陌生人（招募的貢獻者）點開 /testset/ 頁面，無登入即可:
  填名字+年級 → 選課文 → 錄音 → 上傳。

設計（為何 GCS-only 無 DB）:
- alembic 目前 multi-head，依專案鐵律不在此情況下新建 migration。
- v1 把每筆錄音存 GCS:
    test-dataset/{slug}/{lesson_id}/{version}.webm   (音檔)
    test-dataset/{slug}/{lesson_id}/{version}.json   (meta: 名字/年級/時間)
  owner list UI 用 GET /testset/recordings 讀回（list_blobs + 讀 .json）。
- 與學生 attempt 完全隔離（獨立 prefix），重用既有 reading-audio bucket。

安全:
- 公開 endpoint → IP rate-limit + size cap + content-type 檢查 + fail-closed。
- v1 list 也公開（owner 資料低敏感、URL 隱蔽）；v2 再加 auth。已向 owner 標註此 tradeoff。
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..auth.rate_limiter import make_general_rate_limit_dependency
from ..services.audio_upload_service import (
    _get_gcs_bucket,
    generate_audio_signed_url,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["testset"])

_PREFIX = "test-dataset"
_MAX_AUDIO_BYTES = 15 * 1024 * 1024  # 15 MB
_ALLOWED_MIME = {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"}
_ALLOWED_VERSION = {"correct", "error"}

# Public endpoints → per-IP limits (in-memory, per Cloud Run instance).
_upload_limit = make_general_rate_limit_dependency(max_requests=30, window_seconds=60)
_list_limit = make_general_rate_limit_dependency(max_requests=60, window_seconds=60)


def _slug(name: str) -> str:
    """Stable, path-safe slug from contributor name (keeps CJK, strips separators)."""
    s = re.sub(r"[^\w一-鿿]+", "_", (name or "").strip())
    return (s.strip("_") or "anon")[:40]


@router.post("/testset/upload", dependencies=[Depends(_upload_limit)])
async def testset_upload(
    contributor_name: str = Form(...),
    grade: str = Form(...),
    lesson_id: str = Form(...),
    version: str = Form(...),
    audio: UploadFile = File(...),
):
    """貢獻者上傳一筆錄音（無登入）。

    Returns: { ok, path } on success; HTTPException on validation; 503 if GCS down.
    """
    # ── validate ──────────────────────────────────────────────────────────────
    if version not in _ALLOWED_VERSION:
        raise HTTPException(400, "version must be 'correct' or 'error'")
    if not contributor_name.strip() or not grade.strip() or not lesson_id.strip():
        raise HTTPException(400, "contributor_name, grade, lesson_id are required")

    base_mime = (audio.content_type or "").split(";")[0].strip()
    if base_mime and base_mime not in _ALLOWED_MIME:
        raise HTTPException(415, f"unsupported audio type: {base_mime}")

    audio_bytes = await audio.read()
    if len(audio_bytes) == 0:
        raise HTTPException(400, "empty audio")
    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        raise HTTPException(413, "audio too large (max 15MB)")

    bucket = _get_gcs_bucket()
    if bucket is None:
        # fail-closed: storage unavailable
        raise HTTPException(503, "storage temporarily unavailable")

    slug = _slug(contributor_name)
    ext = "webm"
    audio_path = f"{_PREFIX}/{slug}/{lesson_id}/{version}.{ext}"
    meta_path = f"{_PREFIX}/{slug}/{lesson_id}/{version}.json"
    meta = {
        "contributor_name": contributor_name.strip(),
        "grade": grade.strip(),
        "lesson_id": lesson_id.strip(),
        "version": version,
        "audio_path": audio_path,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        bucket.blob(audio_path).upload_from_string(
            audio_bytes, content_type=base_mime or "audio/webm"
        )
        bucket.blob(meta_path).upload_from_string(
            json.dumps(meta, ensure_ascii=False), content_type="application/json"
        )
    except Exception as exc:  # never leak internals; fail-closed
        logger.warning("testset upload failed: path=%s err=%s", audio_path, exc)
        raise HTTPException(503, "upload failed, please retry")

    logger.info("testset upload OK: %s (%d bytes)", audio_path, len(audio_bytes))
    return {"ok": True, "path": audio_path}


@router.get("/testset/recordings", dependencies=[Depends(_list_limit)])
def testset_recordings():
    """owner list UI 用：列出已收的所有錄音 meta + 10 分鐘播放 signed URL。

    v1 公開（低敏感 + 隱蔽 URL）；v2 加 auth。
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return {"ok": False, "recordings": [], "reason": "storage unavailable"}

    out = []
    try:
        for blob in bucket.list_blobs(prefix=f"{_PREFIX}/"):
            if not blob.name.endswith(".json"):
                continue
            try:
                meta = json.loads(blob.download_as_text())
            except Exception:
                continue
            signed = generate_audio_signed_url(meta.get("audio_path", ""), expiration_seconds=600)
            meta["play_url"] = signed
            out.append(meta)
    except Exception as exc:
        logger.warning("testset list failed: %s", exc)
        return {"ok": False, "recordings": [], "reason": "list failed"}

    out.sort(key=lambda m: m.get("created_at", ""), reverse=True)
    return {"ok": True, "count": len(out), "recordings": out}
