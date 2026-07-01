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

批次評估 (Issue #2340):
- POST /api/testset/batch-eval — 登入後才可用（get_current_user）
- 讀 GCS meta → transcribe → evaluate pipeline，每筆 fail-safe
- 硬上限 _BATCH_EVAL_LIMIT 筆，超過截斷並回 truncated:true + log
- 無 DB migration（GCS-only）
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

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

# 批次評估單次硬上限：每次最多評 N 筆（cost guard，#2340）
# Gemini transcribe 每筆約 2-5s，30 筆 = ~150s；超過截斷並回 truncated:true
_BATCH_EVAL_LIMIT = 30

# Rate-limiting 靠全域 GlobalRateLimitMiddleware（讀 X-Forwarded-For，真 per-IP）。
# 不在 endpoint 用 request.client.host limiter — Cloud Run LB 後面那只會讓所有人共用
# 一個 bucket → self-DoS（security 複查 #2304）。


def _slug(name: str) -> str:
    """Stable, path-safe slug from contributor name (keeps CJK, strips separators)."""
    s = re.sub(r"[^\w一-鿿]+", "_", (name or "").strip())
    return (s.strip("_") or "anon")[:40]


def _audio_bytes_match_declared_mime(data: bytes, declared_mime: str) -> bool:
    """Verify leading magic bytes match client-declared MIME (anti spoofing)."""
    if not data:
        return False
    if declared_mime == "audio/wav":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"
    if declared_mime == "audio/mpeg":
        if data[:3] == b"ID3":
            return True
        return len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0
    if declared_mime == "audio/webm":
        return data[:4] == b"\x1a\x45\xdf\xa3"
    if declared_mime == "audio/ogg":
        return data[:4] == b"OggS"
    if declared_mime == "audio/mp4":
        return len(data) >= 12 and data[4:8] == b"ftyp"
    return False


def _resolve_target_text(lesson_id: str) -> str | None:
    """Return full_text for lesson_id (numeric int or code string like 'G6-L22').

    Priority: int lookup → code lookup. Returns None if not found.
    """
    from ..services.lesson_loader import get_lesson_by_code, get_lesson_by_id  # noqa: PLC0415

    lesson = None
    try:
        lesson = get_lesson_by_id(int(lesson_id))
    except (ValueError, TypeError):
        pass
    if lesson is None:
        lesson = get_lesson_by_code(lesson_id)
    if lesson is None:
        return None
    return lesson.get("full_text") or None


def _eval_blob_path(audio_path: str) -> str:
    """跑分結果持久化的 sibling 路徑：
    .../{version}-{uid}.webm → .../{version}-{uid}.eval.json（#2392）。"""
    if not audio_path:
        return ""
    return audio_path.rsplit(".", 1)[0] + ".eval.json"


def _stamp_persist_append(bucket, audio_path: str, result: dict, results: list) -> None:
    """蓋 scored_at 時間戳 → 持久化 eval 結果到 GCS（fail-safe，寫失敗不中斷批次）→ append。

    讓 dashboard reload 不丟分數 + 標跑分時間（#2392）。重跑會覆寫同一 eval.json。
    """
    result["scored_at"] = datetime.now(timezone.utc).isoformat()
    eval_path = _eval_blob_path(audio_path)
    if eval_path:
        try:
            bucket.blob(eval_path).upload_from_string(
                json.dumps(result, ensure_ascii=False),
                content_type="application/json",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("batch-eval persist failed: path=%s err=%s", eval_path, exc)
    results.append(result)


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
        raise HTTPException(413, "audio too large (max 8MB)")
    if not _audio_bytes_match_declared_mime(audio_bytes, base_mime):
        raise HTTPException(400, "audio content does not match declared type")

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
        "content_type": base_mime,  # 真實 MIME → batch-eval 傳真 mime,原生格式免多餘 transcode (#2434)
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

    回布林 + 各版本最新一筆的 10 分鐘簽名播放 URL（correct_url/error_url），讓匿名
    record.html 換裝置/清快取後仍能讀回真實進度（取代純 localStorage 的 device-local
    標記），且可在「我的進度」直接聽取自己上傳的錄音。
    隱私 tradeoff：URL 以「名字 + 課」查得，知道名字者可聽該人錄音；符合 #2287
    「公開上傳、隱私只做標配」設計，且 URL 10 分鐘過期。
    """
    empty = {"ok": False, "correct": False, "error": False, "correct_url": None, "error_url": None}
    if not name.strip() or not _LESSON_ID_RE.match(lesson.strip()):
        return empty
    bucket = _get_gcs_bucket()
    if bucket is None:
        return empty

    slug = _slug(name)
    lid = lesson.strip()
    latest = {"correct": None, "error": None}  # 各版本最新（lexical 末筆）webm blob path
    try:
        for blob in bucket.list_blobs(prefix=f"{_PREFIX}/{slug}/{lid}/", max_results=50):
            fname = blob.name.rsplit("/", 1)[-1]
            if not fname.endswith(".webm"):
                continue
            if fname.startswith("correct"):
                latest["correct"] = blob.name
            elif fname.startswith("error"):
                latest["error"] = blob.name
    except Exception as exc:
        logger.warning("testset progress failed: %s", exc)
        return empty

    def _url(path: str | None) -> str | None:
        if not path:
            return None
        try:
            return generate_audio_signed_url(path, expiration_seconds=600)
        except Exception:
            return None

    return {
        "ok": True,
        "correct": latest["correct"] is not None,
        "error": latest["error"] is not None,
        "correct_url": _url(latest["correct"]),
        "error_url": _url(latest["error"]),
    }


@router.get("/testset/recordings")
def testset_recordings():
    """owner list UI 用：列出已收的所有錄音 meta + 10 分鐘播放 signed URL。

    公開（Young 2026-06-21：不需登入即顯示貢獻者暱稱/數量）。暱稱為自選暱稱、
    朗讀公開課文，非敏感 PII；list.html 現況表不登入就能看到誰貢獻了哪幾課。
    （此前曾 admin/teacher → 任何登入者 → 現全公開。）

    DECISION NEEDED — auth: 此 endpoint 日後應改為 require_role(system_admin, org_admin)，
    但 frontend/public/testset-7f3a91c4/dashboard.html 目前無登入/token 機制；
    現階段加 require_role 會 403 並讓 admin 無法看錄音清單。須先讓 dashboard 接上
    auth flow 再鎖 endpoint；在此之前維持公開、勿在此加 require_role。
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return {"ok": False, "recordings": [], "reason": "storage unavailable"}

    out = []
    try:
        # 單趟掃描同時收 meta + 持久化的 eval 結果（#2392），用 base path join，
        # 避免每筆再打一次 GCS exists/download（N 次額外呼叫會拖慢清單）。
        metas_by_base: dict[str, dict] = {}
        evals_by_base: dict[str, dict] = {}
        for blob in bucket.list_blobs(prefix=f"{_PREFIX}/", max_results=_LIST_CAP):
            if blob.name.endswith(".eval.json"):
                base = blob.name[: -len(".eval.json")]
                try:
                    evals_by_base[base] = json.loads(blob.download_as_text())
                except Exception:
                    continue
            elif blob.name.endswith(".json"):
                base = blob.name[: -len(".json")]
                try:
                    metas_by_base[base] = json.loads(blob.download_as_text())
                except Exception:
                    continue
        for base, meta in metas_by_base.items():
            signed = generate_audio_signed_url(meta.get("audio_path", ""), expiration_seconds=600)
            meta["play_url"] = signed
            ev = evals_by_base.get(base)
            if ev is not None:
                meta["eval"] = ev  # 含 adjusted_match_rate / flag / scored_at 等
            out.append(meta)
    except Exception as exc:
        logger.warning("testset list failed: %s", exc)
        return {"ok": False, "recordings": [], "reason": "list failed"}

    out.sort(key=lambda m: m.get("created_at", ""), reverse=True)
    return {"ok": True, "count": len(out), "recordings": out}


@router.post("/testset/batch-eval")
async def testset_batch_eval(
    current_user: User = Depends(get_current_user),
    name: str | None = Query(default=None, description="過濾貢獻者名字（slug 比對）"),
    lesson: str | None = Query(default=None, description="過濾課文 lesson_id（字串精確比對）"),
) -> dict:
    """批次跑 STT + 評分 pipeline，驗測試集準度（Issue #2340）。

    Auth: 登入使用者才可呼叫（get_current_user），不需 teacher/admin role。

    Query params:
        name   — 過濾 contributor slug（局部比對，例如 '王小明' → slug '王小明'）
        lesson — 過濾 lesson_id（例如 '1' 或 'G6-L22'）

    Returns:
        {
          ok: bool,
          n: int,
          truncated: bool,
          results: [{
            name, lesson, version,
            match_rate, adjusted_match_rate, cpm,
            transcript_method,  // "gemini" | "fallback"
            transcript_reason,  // fallback 原因，非 fallback 時 null
            expected,           // "high" (correct) | "low" (error)
            flag,               // true = 不符期望（異常）
            error,              // 該筆例外訊息，正常時 null
          }],
          summary: {
            correct_avg,    // correct 版的 adjusted_match_rate 平均（無資料時 null）
            error_avg,      // error 版的 adjusted_match_rate 平均（無資料時 null）
            anomaly_count,  // flag=true 的筆數
          }
        }

    Cost guard: 單次最多評 _BATCH_EVAL_LIMIT（30）筆，超過截斷並標 truncated:true。
    Fail-safe: 單筆 exception 不中斷整批，標 error 欄位並繼續。
    """
    from ..services.reading_evaluation_service import evaluate_reading_with_ai  # noqa: PLC0415
    from ..services.reading_transcription_service import transcribe_reading_audio  # noqa: PLC0415

    # ── 1. GCS availability check (fail-closed) ────────────────────────────
    bucket = _get_gcs_bucket()
    if bucket is None:
        logger.warning("testset batch-eval: GCS unavailable")
        return {
            "ok": False,
            "n": 0,
            "truncated": False,
            "results": [],
            "summary": {"correct_avg": None, "error_avg": None, "anomaly_count": 0},
        }

    # ── 2. Collect meta entries from GCS ──────────────────────────────────
    name_slug = _slug(name) if name else None
    metas: list[dict] = []
    try:
        for blob in bucket.list_blobs(prefix=f"{_PREFIX}/", max_results=_LIST_CAP):
            if not blob.name.endswith(".json"):
                continue
            # 跳過跑分結果檔（#2392）—— 它也以 .json 結尾，當 meta 解析會污染清單
            if blob.name.endswith(".eval.json"):
                continue
            # Apply contributor filter (slug-based path component match)
            if name_slug and f"/{name_slug}/" not in blob.name:
                continue
            try:
                meta = json.loads(blob.download_as_text())
            except Exception:
                continue
            # Apply lesson filter
            if lesson and meta.get("lesson_id", "") != lesson:
                continue
            metas.append(meta)
    except Exception as exc:
        logger.warning("testset batch-eval list failed: %s", exc)
        return {
            "ok": False,
            "n": 0,
            "truncated": False,
            "results": [],
            "summary": {"correct_avg": None, "error_avg": None, "anomaly_count": 0},
        }

    # ── 3. Hard limit — cost guard ─────────────────────────────────────────
    truncated = len(metas) > _BATCH_EVAL_LIMIT
    if truncated:
        logger.info(
            "testset batch-eval truncated: total=%d limit=%d name=%s lesson=%s",
            len(metas), _BATCH_EVAL_LIMIT, name, lesson,
        )
        metas = metas[:_BATCH_EVAL_LIMIT]

    # ── 4. Per-entry pipeline (fail-safe) ──────────────────────────────────
    results: list[dict] = []
    for meta in metas:
        entry_name = meta.get("contributor_name", "")
        entry_lesson = meta.get("lesson_id", "")
        entry_version = meta.get("version", "")
        audio_path = meta.get("audio_path", "")
        # 真實 MIME(#2434);舊紀錄無此欄 → fallback webm（與上線前行為一致，ffmpeg 仍 sniff）
        entry_mime = meta.get("content_type") or "audio/webm"

        base_result: dict = {
            "name": entry_name,
            "lesson": entry_lesson,
            "version": entry_version,
            "match_rate": None,
            "adjusted_match_rate": None,
            "cpm": None,
            "transcript_method": None,
            "transcript_reason": None,
            "expected": "high" if entry_version == "correct" else "low",
            "flag": False,
            "error": None,
        }

        try:
            # 4a. Resolve target_text for this lesson
            target_text = _resolve_target_text(entry_lesson)
            if not target_text:
                base_result["error"] = f"lesson '{entry_lesson}' not found in catalog"
                _stamp_persist_append(bucket, audio_path, base_result, results)
                logger.info("batch-eval skip: lesson not found path=%s", audio_path)
                continue

            # 4b. Download audio bytes
            audio_blob = bucket.blob(audio_path)
            audio_bytes = audio_blob.download_as_bytes()

            # 4c. Transcribe
            transcribe_result = await transcribe_reading_audio(
                audio_bytes=audio_bytes,
                mime_type=entry_mime,  # #2434: 真實 mime（原生 wav/mp3 免多餘 transcode）
                target_text=target_text,
                duration_ms=None,
            )
            transcript = transcribe_result.get("transcript")
            transcript_method = transcribe_result.get("method", "fallback")
            transcript_reason = transcribe_result.get("reason")

            base_result["transcript_method"] = transcript_method
            base_result["transcript_reason"] = transcript_reason

            # 4d. Skip scoring if transcription failed (fallback with no transcript)
            if not transcript:
                base_result["error"] = f"transcription fallback: {transcript_reason or 'unknown'}"
                _stamp_persist_append(bucket, audio_path, base_result, results)
                logger.info(
                    "batch-eval transcribe fallback: path=%s reason=%s",
                    audio_path, transcript_reason,
                )
                continue

            # 4e. Evaluate
            eval_result = await evaluate_reading_with_ai(
                spoken_text=transcript,
                target_text=target_text,
                duration_ms=None,
            )
            match_rate = eval_result.get("match_rate")
            adjusted = eval_result.get("adjusted_match_rate")
            cpm = eval_result.get("cpm")

            base_result["match_rate"] = match_rate
            base_result["adjusted_match_rate"] = adjusted
            base_result["cpm"] = cpm

            # 4f. Flag anomalies vs expected score direction
            # correct → expect adjusted >= 0.8; error → expect adjusted < 0.8
            if adjusted is not None:
                if entry_version == "correct" and adjusted < 0.8:
                    base_result["flag"] = True
                elif entry_version == "error" and adjusted >= 0.8:
                    base_result["flag"] = True

        except Exception as exc:
            # Fail-safe: single entry exception must not abort the batch
            base_result["error"] = type(exc).__name__
            logger.warning(
                "batch-eval entry error: path=%s err=%s", audio_path, exc, exc_info=True
            )

        _stamp_persist_append(bucket, audio_path, base_result, results)

    # ── 5. Summary statistics ───────────────────────────────────────────────
    correct_scores = [
        r["adjusted_match_rate"]
        for r in results
        if r["version"] == "correct" and r["adjusted_match_rate"] is not None
    ]
    error_scores = [
        r["adjusted_match_rate"]
        for r in results
        if r["version"] == "error" and r["adjusted_match_rate"] is not None
    ]
    anomaly_count = sum(1 for r in results if r["flag"])

    correct_avg = round(sum(correct_scores) / len(correct_scores), 4) if correct_scores else None
    error_avg = round(sum(error_scores) / len(error_scores), 4) if error_scores else None

    logger.info(
        "testset batch-eval done: n=%d truncated=%s anomaly=%d correct_avg=%s error_avg=%s",
        len(results), truncated, anomaly_count, correct_avg, error_avg,
    )

    return {
        "ok": True,
        "n": len(results),
        "truncated": truncated,
        "results": results,
        "summary": {
            "correct_avg": correct_avg,
            "error_avg": error_avg,
            "anomaly_count": anomaly_count,
        },
    }
