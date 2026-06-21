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
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..auth.dependencies import get_current_user
from ..models.user import User
from ..services.audio_upload_service import (
    _get_gcs_bucket,
    generate_audio_signed_url,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["testset"])

_PREFIX = "test-dataset"
_MAX_AUDIO_BYTES = 8 * 1024 * 1024  # 8 MB (webm 朗讀用不到更多)
_ALLOWED_MIME = {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"}
_ALLOWED_VERSION = {"correct", "error"}
# lesson_id 進 GCS path → 必須白名單格式，否則可 ../ 跨 prefix 寫入學生錄音 (security #2304)
_LESSON_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,20}$")
_LIST_CAP = 500  # list_blobs hard cap，避免 unbounded read/signBlob

# Rate-limiting 靠全域 GlobalRateLimitMiddleware（讀 X-Forwarded-For，真 per-IP）。
# 不在 endpoint 用 request.client.host limiter — Cloud Run LB 後面那只會讓所有人共用
# 一個 bucket → self-DoS（security 複查 #2304）。


def _slug(name: str) -> str:
    """Stable, path-safe slug from contributor name (keeps CJK, strips separators)."""
    s = re.sub(r"[^\w一-鿿]+", "_", (name or "").strip())
    return (s.strip("_") or "anon")[:40]


@router.post("/testset/upload")
async def testset_upload(
    contributor_name: str = Form(...),
    grade: str = Form(""),  # 選填（Young 2026-06-21：錄音頁拿掉年級欄）
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
    if not contributor_name.strip() or not lesson_id.strip():
        raise HTTPException(400, "contributor_name, lesson_id are required")
    # HIGH: lesson_id 進 blob path → 白名單格式擋路徑注入 / 跨 prefix 寫入
    if not _LESSON_ID_RE.match(lesson_id.strip()):
        raise HTTPException(400, "invalid lesson_id")

    base_mime = (audio.content_type or "").split(";")[0].strip()
    if base_mime not in _ALLOWED_MIME:  # reject empty/missing too (deny-by-default)
        raise HTTPException(415, f"unsupported audio type: {base_mime or '(none)'}")

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
    lid = lesson_id.strip()
    uid = uuid.uuid4().hex[:8]  # 防同名/重錄覆蓋：每次上傳唯一路徑（append-only）
    audio_path = f"{_PREFIX}/{slug}/{lid}/{version}-{uid}.webm"
    meta_path = f"{_PREFIX}/{slug}/{lid}/{version}-{uid}.json"
    meta = {
        "contributor_name": contributor_name.strip(),
        "grade": grade.strip(),
        "lesson_id": lid,
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


@router.get("/testset/progress")
def testset_progress(name: str = "", lesson: str = ""):
    """錄音頁進度查詢（公開，server-truth）：某貢獻者某課是否已上傳 correct/error。

    只回布林（不回名字/年級/play URL 等 PII），讓匿名 record.html 換裝置/清快取後
    仍能讀回真實進度（取代純 localStorage 的 device-local 標記）。
    """
    empty = {"ok": False, "correct": False, "error": False}
    if not name.strip() or not _LESSON_ID_RE.match(lesson.strip()):
        return empty
    bucket = _get_gcs_bucket()
    if bucket is None:
        return empty

    slug = _slug(name)
    lid = lesson.strip()
    done = {"correct": False, "error": False}
    try:
        for blob in bucket.list_blobs(prefix=f"{_PREFIX}/{slug}/{lid}/", max_results=50):
            fname = blob.name.rsplit("/", 1)[-1]
            if not fname.endswith(".webm"):
                continue
            if fname.startswith("correct"):
                done["correct"] = True
            elif fname.startswith("error"):
                done["error"] = True
    except Exception as exc:
        logger.warning("testset progress failed: %s", exc)
        return empty
    return {"ok": True, **done}


@router.get("/testset/recordings")
def testset_recordings(current_user: User = Depends(get_current_user)):
    """owner list UI 用：列出已收的所有錄音 meta + 10 分鐘播放 signed URL。

    任何登入者可看（Young 2026-06-21：先不限 admin/teacher）。仍需登入，
    擋匿名公開抓取貢獻者 PII（名字/年級/可播放錄音）。list.html 讀 localStorage
    `lingoleap_token` 帶 Bearer；未登入 → 401。
    （v2 若要全公開或收回 admin-only 再調；codex #2304 的 role gate 暫移除。）
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return {"ok": False, "recordings": [], "reason": "storage unavailable"}

    out = []
    try:
        for blob in bucket.list_blobs(prefix=f"{_PREFIX}/", max_results=_LIST_CAP):
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
