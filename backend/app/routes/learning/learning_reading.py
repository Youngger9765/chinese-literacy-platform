"""AI Reading Analysis routes (Step 6).

Handles AI-powered reading diagnosis and improvement suggestions.
"""
import json
import logging
import re
import time
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_5_per_min, ai_limit_10_per_min
from ...database import get_db
from ...models.session import LearningSession
from ...models.user import User
from ...services.ai_service import generate_reading_analysis, GeminiContentFilterError, CONTENT_FILTER_FRIENDLY_MSG
from ...services.ai_usage_tracker import last_usage, log_ai_usage
from ...services.input_sanitizer import sanitize_ai_input
from ...services.reading_evaluation_service import evaluate_reading_with_ai
from pypinyin import Style, lazy_pinyin
from ...services.reading_transcription_service import (
    ALLOWED_AUDIO_MIMES,
    transcribe_reading_audio,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# Session.ai_analysis cache: v2 wraps response + enrichment fingerprint so we can
# invalidate when the client sends richer data (Fixes #540 — stale cache after
# comprehension/vocab/dictation completes).
AI_ANALYSIS_CACHE_V2 = "ai_analysis_v2"
_LEGACY_ANALYSIS_KEYS = frozenset({
    "analysis_summary",
    "strengths",
    "areas_for_improvement",
    "practice_suggestions",
    "encouragement_message",
})


class AIAnalysisRequest(BaseModel):
    story_title: str = Field(..., max_length=200)
    accuracy: float = Field(..., ge=0, le=100)
    cpm: float = Field(..., ge=0)
    error_chars: list[str] = Field(default_factory=list)
    total_characters: int = Field(..., ge=0)
    # Optional enrichment fields — Issue #415: comprehensive AI analysis
    comprehension_score: float | None = Field(None, ge=0, le=100)
    vocab_practiced_count: int | None = Field(None, ge=0)
    vocab_total_count: int | None = Field(None, ge=0)
    dictation_correct_count: int | None = Field(None, ge=0)
    dictation_total_count: int | None = Field(None, ge=0)


class AIAnalysisResponse(BaseModel):
    analysis_summary: str
    strengths: list[str]
    areas_for_improvement: list[str]
    practice_suggestions: list[str]
    encouragement_message: str


def _enrichment_cache_signature(payload: AIAnalysisRequest) -> str:
    """Stable string for comparing which optional metrics were included in the request."""
    c = payload.comprehension_score
    if c is not None:
        c = round(float(c), 4)
    parts = [
        c,
        payload.vocab_practiced_count,
        payload.vocab_total_count,
        payload.dictation_correct_count,
        payload.dictation_total_count,
    ]
    return json.dumps(parts, separators=(",", ":"), ensure_ascii=False)


def _try_return_cached_ai_analysis(
    raw: str | None,
    payload: AIAnalysisRequest,
) -> AIAnalysisResponse | None:
    """Return cached AIAnalysisResponse if still valid for this payload; else None."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None

    sig = _enrichment_cache_signature(payload)

    if data.get("format") == AI_ANALYSIS_CACHE_V2:
        if data.get("enrichment_sig") == sig:
            resp = data.get("response")
            if isinstance(resp, dict) and _LEGACY_ANALYSIS_KEYS.issubset(resp.keys()):
                return AIAnalysisResponse(**{k: resp[k] for k in _LEGACY_ANALYSIS_KEYS})
        return None

    # Legacy: flat response JSON only (pre-#540). If the client now sends any
    # enrichment, ignore cache — it was generated without cross-step context.
    if _LEGACY_ANALYSIS_KEYS.issubset(data.keys()):
        if sig != "[null,null,null,null,null]":
            logger.info("Ignoring legacy AI analysis cache — request has enrichment data")
            return None
        try:
            return AIAnalysisResponse(**{k: data[k] for k in _LEGACY_ANALYSIS_KEYS})
        except Exception:
            return None

    return None


def _wrap_ai_analysis_for_cache(analysis: dict, payload: AIAnalysisRequest) -> str:
    wrapped = {
        "format": AI_ANALYSIS_CACHE_V2,
        "enrichment_sig": _enrichment_cache_signature(payload),
        "response": analysis,
    }
    return json.dumps(wrapped, ensure_ascii=False)


@router.post(
    "/learning/sessions/{session_id}/ai-analysis",
    response_model=AIAnalysisResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def get_ai_analysis(
    session_id: int,
    payload: AIAnalysisRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate AI reading diagnosis and improvement suggestions.

    Caches in ``session.ai_analysis`` with an enrichment fingerprint (#540).
    Legacy flat JSON caches are ignored when the client sends comprehension /
    vocab / dictation metrics so the report can regenerate after later steps
    complete.

    Rate limited: 5 requests per minute per user/IP.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    # Sanitize user-provided text before sending to AI
    safe_story_title, _ = sanitize_ai_input(payload.story_title, user_id=str(current_user.id))

    cached_resp = _try_return_cached_ai_analysis(session.ai_analysis, payload)
    if cached_resp is not None:
        return cached_resp
    if session.ai_analysis:
        try:
            json.loads(session.ai_analysis)
        except (json.JSONDecodeError, TypeError):
            logger.warning("Corrupted ai_analysis cache for session %d, regenerating", session_id)

    # Call Gemini
    start_time = time.monotonic()
    ai_success = True
    ai_error_type = None
    try:
        analysis = await generate_reading_analysis({
            "story_title": safe_story_title,
            "accuracy": payload.accuracy,
            "cpm": payload.cpm,
            "error_chars": payload.error_chars,
            "total_characters": payload.total_characters,
            # Optional enrichment (Issue #415)
            "comprehension_score": payload.comprehension_score,
            "vocab_practiced_count": payload.vocab_practiced_count,
            "vocab_total_count": payload.vocab_total_count,
            "dictation_correct_count": payload.dictation_correct_count,
            "dictation_total_count": payload.dictation_total_count,
        })
    except GeminiContentFilterError:
        ai_success = False
        ai_error_type = "ContentFilter"
        logger.warning("Content filter blocked AI analysis for session %d", session_id)
        return AIAnalysisResponse(
            analysis_summary=CONTENT_FILTER_FRIENDLY_MSG,
            strengths=[],
            areas_for_improvement=[],
            practice_suggestions=["換一篇課文再試試看"],
            encouragement_message="你很棒，繼續加油！",
        )
    except TimeoutError:
        ai_success = False
        ai_error_type = "Timeout"
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        ai_success = False
        ai_error_type = type(e).__name__
        logger.error("AI analysis generation failed for session %d: %s", session_id, e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    # Track AI usage AFTER try/except — not in finally (FAIL-2 review fix).
    # In finally, the DB session may be in an inconsistent state after HTTPException.
    latency_ms = int((time.monotonic() - start_time) * 1000)
    usage = last_usage.get()
    log_ai_usage(
        db,
        endpoint=f"/learning/sessions/{session_id}/ai-analysis",
        step="analysis",
        student_id=current_user.id,
        story_title=safe_story_title,
        session_id=session_id,
        input_tokens=usage.input_tokens if usage else 0,
        output_tokens=usage.output_tokens if usage else 0,
        model=usage.model if usage else "gemini-2.5-flash-lite",
        latency_ms=latency_ms,
        success=ai_success,
        error_type=ai_error_type,
        model_version=usage.model_version if usage else None,
        prompt_char_count=usage.prompt_char_count if usage else None,
        response_char_count=usage.response_char_count if usage else None,
        content_filtered=usage.content_filtered if usage else False,
        prompt_template_id="reading_ai_analysis",
    )

    # Cache the result (versioned + enrichment fingerprint — #540)
    session.ai_analysis = _wrap_ai_analysis_for_cache(analysis, payload)
    db.commit()

    logger.info("Generated AI analysis for session %d", session_id)
    return AIAnalysisResponse(**analysis)


@router.post(
    "/learning/ai-analysis",
    response_model=AIAnalysisResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
    deprecated=True,
)
async def get_ai_analysis_standalone(
    payload: AIAnalysisRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """DEPRECATED — will be removed in a future release.

    Use the session-scoped endpoint instead:
        POST /api/learning/sessions/{session_id}/ai-analysis

    This endpoint was the fallback for frontend flows without a DB session ID.
    All callers have been updated to use the session-scoped cached endpoint (Issue #1648).

    Original: Generate AI reading diagnosis without requiring a backend session.
    No caching — analysis is generated fresh each call.

    Rate limited: 5 requests per minute per user/IP.
    """
    logger.warning(
        "DEPRECATED: /api/learning/ai-analysis called — frontend should use "
        "/api/learning/sessions/{id}/ai-analysis instead. (Issue #1648)"
    )

    # Sanitize user-provided text before sending to AI
    safe_story_title, _ = sanitize_ai_input(payload.story_title, user_id=str(current_user.id))

    start_time = time.monotonic()
    ai_success = True
    ai_error_type = None
    try:
        analysis = await generate_reading_analysis({
            "story_title": safe_story_title,
            "accuracy": payload.accuracy,
            "cpm": payload.cpm,
            "error_chars": payload.error_chars,
            "total_characters": payload.total_characters,
            # Optional enrichment (Issue #415)
            "comprehension_score": payload.comprehension_score,
            "vocab_practiced_count": payload.vocab_practiced_count,
            "vocab_total_count": payload.vocab_total_count,
            "dictation_correct_count": payload.dictation_correct_count,
            "dictation_total_count": payload.dictation_total_count,
        })
    except GeminiContentFilterError:
        ai_success = False
        ai_error_type = "ContentFilter"
        logger.warning("Content filter blocked standalone AI analysis for user %d", current_user.id)
        return AIAnalysisResponse(
            analysis_summary=CONTENT_FILTER_FRIENDLY_MSG,
            strengths=[],
            areas_for_improvement=[],
            practice_suggestions=["換一篇課文再試試看"],
            encouragement_message="你很棒，繼續加油！",
        )
    except TimeoutError:
        ai_success = False
        ai_error_type = "Timeout"
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        ai_success = False
        ai_error_type = type(e).__name__
        logger.error("Standalone AI analysis generation failed: %s", e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    # Track AI usage AFTER try/except — not in finally (FAIL-2 review fix).
    latency_ms = int((time.monotonic() - start_time) * 1000)
    usage = last_usage.get()
    log_ai_usage(
        db,
        endpoint="/learning/ai-analysis",
        step="analysis",
        student_id=current_user.id,
        story_title=safe_story_title,
        input_tokens=usage.input_tokens if usage else 0,
        output_tokens=usage.output_tokens if usage else 0,
        model=usage.model if usage else "gemini-2.5-flash-lite",
        latency_ms=latency_ms,
        success=ai_success,
        error_type=ai_error_type,
        model_version=usage.model_version if usage else None,
        prompt_char_count=usage.prompt_char_count if usage else None,
        response_char_count=usage.response_char_count if usage else None,
        content_filtered=usage.content_filtered if usage else False,
        prompt_template_id="reading_ai_analysis",
    )

    logger.info("Generated standalone AI analysis for user %d", current_user.id)
    return AIAnalysisResponse(**analysis)


# ── Reading Evaluation (Issue #454) ─────────────────────────────────────────


class ReadingEvaluateRequest(BaseModel):
    spoken_text: str = Field(..., description="STT 轉錄結果")
    target_text: str = Field(..., description="課文原文")
    duration_ms: int | None = Field(None, description="朗讀時長（毫秒，選填）")


_CHINESE_CHAR_RE = re.compile(r"[一-鿿㐀-䶿]")


def _build_zhuyin_map(target_text: str) -> dict[int, str]:
    """Return a position→bopomofo map for all CJK characters in target_text.

    Passing the full string (rather than individual chars) lets pypinyin use
    surrounding context to disambiguate polyphonic characters (破音字), e.g.
    「的」(ㄉㄜ˙ vs ㄉㄧˋ), 「樂」(ㄌㄜˋ vs ㄩㄝˋ), 「長」(ㄓㄤˇ vs ㄔㄤˊ).
    """
    # lazy_pinyin returns one bopomofo element per character (including punctuation).
    # Non-CJK characters produce their raw form; we only keep CJK positions.
    bopomofo_list = lazy_pinyin(target_text, style=Style.BOPOMOFO)
    zhuyin_map: dict[int, str] = {}
    for idx, (char, bpmf) in enumerate(zip(target_text, bopomofo_list)):
        if _CHINESE_CHAR_RE.match(char) and bpmf and bpmf != char:
            zhuyin_map[idx] = bpmf
    return zhuyin_map


class DiffToken(BaseModel):
    char: str
    type: str  # "correct" | "forgiven" | "wrong" | "missing" | "extra"
    spoken: str | None = None
    reason: str | None = None
    zhuyin: str | None = None


class ReadingEvalStats(BaseModel):
    correct_count: int
    forgiven_count: int
    wrong_count: int
    missing_count: int
    extra_count: int


class ReadingEvalThresholds(BaseModel):
    reading_pass: float
    reading_excellent: float


class ReadingEvaluateResponse(BaseModel):
    match_rate: float
    adjusted_match_rate: float
    tier: int
    feedback: str
    cpm: float | None = None
    diff_tokens: list[DiffToken]
    stats: ReadingEvalStats
    thresholds: ReadingEvalThresholds
    evaluation_method: str  # "ai" | "fallback"


@router.post(
    "/reading/evaluate",
    response_model=ReadingEvaluateResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
    summary="AI 語義朗讀評分 (Issue #454)",
    description=(
        "使用 Gemini 2.5 Flash 對學生朗讀進行語義級評分。\n"
        "支援同音字、近音字、語氣詞通融，並回傳逐字 diff_tokens。\n"
        "無狀態（不需 session_id）。AI 失敗時自動 fallback 到規則引擎。"
    ),
)
async def evaluate_reading_endpoint(
    payload: ReadingEvaluateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stateless AI reading evaluation. Rate limited: 10 requests per minute."""
    # Sanitize user-provided spoken text before sending to AI
    safe_spoken_text, _ = sanitize_ai_input(payload.spoken_text, user_id=str(current_user.id))

    logger.info(
        "Reading eval request: user=%d target_len=%d spoken_len=%d",
        current_user.id,
        len(payload.target_text),
        len(safe_spoken_text),
        extra={
            "event": "reading_eval_request",
            "user_id": current_user.id,
            "target_length": len(payload.target_text),
        },
    )

    start_time = time.monotonic()
    result = await evaluate_reading_with_ai(
        spoken_text=safe_spoken_text,
        target_text=payload.target_text,
        duration_ms=payload.duration_ms,
    )
    latency_ms = int((time.monotonic() - start_time) * 1000)

    # Track AI usage (Issue #874) — only when AI method was used
    if result.get("evaluation_method") == "ai":
        usage = last_usage.get()
        log_ai_usage(
            db,
            endpoint="/reading/evaluate",
            step="reading",
            student_id=current_user.id,
            input_tokens=usage.input_tokens if usage else 0,
            output_tokens=usage.output_tokens if usage else 0,
            model=usage.model if usage else "gemini-2.5-flash-lite",
            latency_ms=latency_ms,
            success=True,
            model_version=usage.model_version if usage else None,
            prompt_char_count=usage.prompt_char_count if usage else None,
            response_char_count=usage.response_char_count if usage else None,
            content_filtered=usage.content_filtered if usage else False,
            prompt_template_id="reading_evaluate",
        )

    # Build a position→bopomofo map from target_text so pypinyin can use full-context
    # polyphone disambiguation (破音字).  extra tokens have no position in target_text
    # and are not displayed; skip zhuyin for them to avoid wasted lookups.
    zhuyin_map = _build_zhuyin_map(payload.target_text)
    target_pos = 0  # track position through non-extra tokens
    diff_tokens: list[DiffToken] = []
    for t in result["diff_tokens"]:
        token_type = t.get("type", "")
        if token_type == "extra":
            diff_tokens.append(DiffToken(**t))
        else:
            zhuyin = zhuyin_map.get(target_pos) if target_pos < len(payload.target_text) else None
            diff_tokens.append(DiffToken(**t, zhuyin=zhuyin))
            target_pos += 1
    return ReadingEvaluateResponse(
        match_rate=result["match_rate"],
        adjusted_match_rate=result["adjusted_match_rate"],
        tier=result["tier"],
        feedback=result["feedback"],
        cpm=result.get("cpm"),
        diff_tokens=diff_tokens,
        stats=ReadingEvalStats(**result["stats"]),
        thresholds=ReadingEvalThresholds(**result["thresholds"]),
        evaluation_method=result["evaluation_method"],
    )


# ─── FullReading STT: Gemini audio transcription (Issue #2131) ───────────────

# Hard limits (enforced before hitting Gemini)
_MAX_AUDIO_BYTES = 10 * 1024 * 1024   # 10 MB
_MAX_TARGET_CHARS = 3000               # ≈ longest G9 lesson
# Issue #2321 — Gate 2: minimum duration below which we skip STT entirely.
# Frontend Gate 1 (volume + 1 500 ms) is the primary filter; this is a backend
# safety net for clients that bypass the frontend (or have no AnalyserNode).
# 1 000 ms chosen conservatively: real speech takes ≥ 200 ms per syllable even
# at fast pace; anything under 1 s almost certainly contains no useful audio.
_MIN_AUDIO_DURATION_MS = 1000          # 1 second


class TranscribeReadingResponse(BaseModel):
    """Response schema for POST /api/reading/transcribe."""

    transcript: str | None = None
    """High-quality transcript with punctuation, or None on Gemini failure."""

    method: str
    """'gemini' on success, 'fallback' when Gemini is unavailable."""

    reasoning: str | None = None
    """Gemini's 1-2 sentence explanation (for teacher audit). None on fallback."""

    reason: str | None = None
    """Fallback reason classification: 'timeout' | 'safety' | 'decode' | 'empty' | 'error' | 'too_short'.
    Only present when method='fallback'. Used by frontend to show appropriate alert."""


@router.post(
    "/reading/transcribe",
    response_model=TranscribeReadingResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
    summary="Gemini audio transcription for FullReading STT upgrade (Issue #2131)",
    description=(
        "Accepts a student reading audio blob and the lesson target text.\n"
        "Returns a high-quality transcript with punctuation via Gemini audio.\n"
        "webm input is transcoded to ogg via ffmpeg before calling Gemini (Issue #2156).\n"
        "On Gemini failure/timeout the route returns {transcript: null, method: 'fallback', "
        "reason: <timeout|safety|decode|empty|error>} (HTTP 200) so the frontend can show "
        "a fallback alert and use the Web Speech transcript.\n"
        "Rate-limited: 10 requests per minute per user.\n"
        "Audio: ≤10 MB, ≤120 s; MIME: audio/webm, audio/mp4, audio/ogg, audio/wav.\n\n"
        "NOTE (Issue #2297): GCS audio upload is NO LONGER done here.  The frontend\n"
        "must call POST /reading/save-audio after the score is accepted to persist the\n"
        "audio blob.  The session_id parameter is kept for API compatibility but ignored."
    ),
)
async def transcribe_reading_endpoint(
    audio: UploadFile = File(
        ...,
        description="Audio blob from browser MediaRecorder (WebM/MP4/OGG/WAV, max 10 MB)",
    ),
    target_text: str = Form(
        ...,
        description="Original lesson text (used by Gemini to resolve homophones)",
    ),
    duration_ms: int | None = Form(
        default=None,
        description="Recording duration in milliseconds (informational, optional)",
    ),
    session_id: int | None = Form(  # noqa: ARG001  # kept for API compat, ignored (Issue #2297)
        default=None,
        description=(
            "DEPRECATED (Issue #2297): no longer used.  GCS upload is deferred to "
            "POST /reading/save-audio which is called only after score is accepted."
        ),
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Transcribe student reading audio via Gemini.

    Rate-limited to 10 requests per minute per user (shared with /reading/evaluate).
    Input caps are enforced before any AI call.
    webm audio is transcoded to ogg/opus via ffmpeg before calling Gemini — this is the
    root cause fix for Issue #2156 (Chrome records webm; Gemini only accepts ogg/wav/etc).
    On any Gemini failure the route returns HTTP 200 with method='fallback' and a reason
    field so the frontend can display the fallback alert banner (I4).

    Issue #2297: GCS audio upload has been removed from this endpoint.
    Only the Gemini transcription is performed here.  The frontend calls
    POST /reading/save-audio after the student accepts the score.
    """
    # ── 1. Validate MIME type (cheap, before reading bytes) ──────────────────
    raw_mime = audio.content_type or "audio/webm"
    base_mime = raw_mime.split(";")[0].strip()
    if base_mime not in {m.split(";")[0].strip() for m in ALLOWED_AUDIO_MIMES}:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported audio type: {raw_mime!r}. "
                "Accepted: audio/webm, audio/mp4, audio/ogg, audio/wav, audio/mpeg"
            ),
        )

    # ── 2. Read and size-cap audio bytes ─────────────────────────────────────
    audio_bytes = await audio.read()
    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file too large ({len(audio_bytes)} bytes). Max 10 MB.",
        )
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Audio file is empty.")

    # ── 2.5. Issue #2321 — Gate 2: duration too short → return fallback immediately ─
    # Frontend Gate 1 (volume + 1 500 ms) is the primary filter.  This backend gate
    # protects against clients that supply duration_ms but bypass the frontend check.
    # Only applied when duration_ms is explicitly provided and below the threshold —
    # absent duration_ms means the client did not send it, not that the audio is short.
    if duration_ms is not None and duration_ms < _MIN_AUDIO_DURATION_MS:
        logger.warning(
            "Reading transcribe skipped — audio too short: user=%d duration_ms=%d",
            current_user.id,
            duration_ms,
            extra={
                "event": "reading_transcribe_fallback",
                "reason": "too_short",
                "user_id": current_user.id,
                "duration_ms": duration_ms,
            },
        )
        return TranscribeReadingResponse(
            transcript=None,
            method="fallback",
            reason="too_short",
        )

    # ── 3. Cap target_text ───────────────────────────────────────────────────
    if len(target_text) > _MAX_TARGET_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"target_text too long ({len(target_text)} chars). Max {_MAX_TARGET_CHARS}.",
        )
    if not target_text.strip():
        raise HTTPException(status_code=400, detail="target_text must not be empty.")

    logger.info(
        "Reading transcribe request: user=%d audio_bytes=%d duration_ms=%s",
        current_user.id,
        len(audio_bytes),
        duration_ms,
        extra={
            "event": "reading_transcribe_request",
            "user_id": current_user.id,
            "audio_bytes": len(audio_bytes),
            "duration_ms": duration_ms,
        },
    )

    # ── 4. Call Gemini (fail-closed — never 500 on AI failure) ───────────────
    start_time = time.monotonic()
    result = await transcribe_reading_audio(
        audio_bytes=audio_bytes,
        mime_type=raw_mime,
        target_text=target_text,
        duration_ms=duration_ms,
    )
    latency_ms = int((time.monotonic() - start_time) * 1000)

    # ── 4.5. GCS audio upload deferred to POST /reading/save-audio (Issue #2297) ──
    # Audio is now uploaded only after the student accepts the score, not at
    # transcription time.  This prevents orphaned blobs from discarded takes.
    logger.debug(
        "transcribe: upload deferred to /reading/save-audio endpoint (Issue #2297); "
        "user=%d session_id=%s",
        current_user.id,
        session_id,
    )

    # ── 5. Log usage when Gemini succeeded ───────────────────────────────────
    if result.get("method") == "gemini":
        usage = last_usage.get()
        log_ai_usage(
            db,
            endpoint="/reading/transcribe",
            step="full-reading",
            student_id=current_user.id,
            input_tokens=usage.input_tokens if usage else 0,
            output_tokens=usage.output_tokens if usage else 0,
            model=usage.model if usage else "gemini-2.5-flash",
            latency_ms=latency_ms,
            success=True,
            model_version=usage.model_version if usage else None,
            prompt_char_count=usage.prompt_char_count if usage else None,
            response_char_count=usage.response_char_count if usage else None,
            content_filtered=usage.content_filtered if usage else False,
            prompt_template_id="reading_transcribe",
        )

    return TranscribeReadingResponse(
        transcript=result.get("transcript"),
        method=result["method"],
        reasoning=result.get("reasoning"),
        reason=result.get("reason"),
    )
