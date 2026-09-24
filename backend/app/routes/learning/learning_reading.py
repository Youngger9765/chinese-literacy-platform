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
from ...services.he_conjunction import _he_conjunction_positions
from ...services.zhuyin_readings import font_zhuyin_table
from ...services.lesson_zhuyin import zhuyin_for_text
from ...services.reading_transcription_service import (
    ALLOWED_AUDIO_MIMES,
    scorable_char_count,
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
    # 兩個欄位都有上限（#3162）。原本兩個都沒有，而所有兄弟端點都有：
    # learning_comprehension.py 的 story_text 是 10000，learning_strategy.py 的
    # 五個欄位從 128 到 4000。就這一支漏掉。
    #
    # 為什麼要緊：target_text 未消毒就直接進 LLM prompt（spoken_text 下游還會被
    # input_sanitizer 砍到 2000，target_text 不會），而 main.py 沒有 body-size
    # middleware。限流是 per-process 的記憶體字典而 prod maxScale=3，所以標
    # 「10 次/分鐘」的實際上限是 30 —— 一個已登入帳號可以持續灌大 payload 進 Gemini，
    # 那同時是花錢面與未消毒的注入面。
    #
    # 10000 對齊 comprehension 的 story_text，理由相同：那是「一篇課文的量級」。
    # 全庫最長的重點段是 621 字，所以這個上限離真實用量很遠，不會擋到學生。
    spoken_text: str = Field(..., max_length=10000, description="STT 轉錄結果")
    target_text: str = Field(..., max_length=10000, description="課文原文")
    duration_ms: int | None = Field(None, description="朗讀時長（毫秒，選填）")
    # #3218：注音改成查逐課對照表。舊版前端不會送這個欄位 → 走下面的 fallback，
    # 行為與這次改動之前完全一樣。pattern 是白名單，路徑穿越在 service 層再擋一次。
    lesson_uid: str | None = Field(
        None, max_length=16, pattern=r"^L\d+$", description="課號（有給就查逐課注音表）"
    )


def _u16_units(text: str) -> list[str]:
    """UTF-16 單位切法 —— 直接用 service 的那支，不再寫第四份實作（#3237）。"""
    from ...services.lesson_zhuyin import u16_chars
    return u16_chars(text)



#: 注音的四個聲調符號與輕聲點。去掉之後剩下的是「音節」。
_TONE_MARKS = "ˊˇˋ˙"


def _build_zhuyin_map(target_text: str) -> dict[int, str]:
    """表裡沒有這段字時的注音 —— **查表，不是選擇**（#3237）。

    ## 這裡以前是第二套讀音來源

    原本這支是一整套選擇器：pypinyin 看上下文挑音節 + 字型定聲調 + 「和」的三道門
    + 對不上時的同音節退讓。它跟逐課對照表對同一段課文會給不同答案 ——
    #3218 量到全庫 **7,682 / 65,754 個破音字位置（11.7%）**不一致。

    ⛔ 而 pypinyin 是**大陸來源**：#3202 就是它造成的（研究 ㄐㄧㄡ、血 ㄒㄩㄝˋ、
    垃圾 ㄌㄚㄐㄧ）。留著它＝留著一個已知讀音不對的第二意見。

    ## 現在

    #3230 之後服務端會交給前端的中文字串 100% 在表裡（45,606 個），朗讀評分送來的
    `target_text` 實測 **1,695 / 1,696 命中**（唯一沒中的是 L0140 的
    `「ㄒㄧ…ㄒㄧ…。」`—— 純注音符號，沒有中文字要標）。所以課文那條路根本走不到這裡；
    會走到的只剩**老師臨時貼的字**。

    那種字給：

        單音字   → 字型的 `single`（11,050 個字，唯一讀音，沒有選擇問題）
        「和」   → `he_conjunction` 的判斷（jieba + 380 筆教育部例外 + 自我指稱檢查）
        其他破音字 → 字型的預設讀音 `d`

    這三者**都是表自己用的權威**，所以結果跟表一致或退讓，不會出現「兩套引擎各說一套」。
    破音字在老師貼的字裡可能不準 —— 但「不準」跟「另一套引擎給出跟表不同的答案」
    是兩件事，後者才是 #3202/#3204/#3215 三張票疊出四層的來源。

    ⚠️ 索引是 **UTF-16 單位**（跟表、跟前端一致）。以前這裡按 Python 碼點走，
    而表是按 UTF-16 產的 —— 非 BMP 字會讓兩邊差一格（#3230 那輪咬了三次）。
    """
    single, poly = font_zhuyin_table()
    # fail-open：jieba 或例外清單載不到就回空集合，「和」維持字型讀音。
    # 標錯讀音比漏標嚴重。
    he_positions = (
        _he_conjunction_positions(target_text) if "和" in target_text else frozenset()
    )
    out: dict[int, str] = {}
    for i, ch in enumerate(_u16_units(target_text)):
        if i in he_positions and ch == "和":
            out[i] = "ㄏㄢˋ"
            continue
        r = single.get(ch)
        if r:
            out[i] = r
            continue
        entry = poly.get(ch)
        if entry and entry.get("d"):
            out[i] = entry["d"]
    return out


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

    # 逐字注音。extra token 在 target_text 裡沒有位置、也不顯示，所以跳過。
    # #3218：注音是課文的一部分，不是執行期算出來的。
    #
    # 讀音選擇的權威是出貨的 `polyphonicProcessor.ts`（方大哥策展的樣式表 + 一/不變調
    # + skipPrev 狀態機），後端**結構上無法重現它** —— #3215 移植過一次吐出 `不 → ㄈㄨ`。
    # 所以離線逐字固化成表，兩邊讀同一份 → 前後端不一致不是「要修到 0」，是不可能存在。
    #
    # ⚠️ 下面那條 `_build_zhuyin_map` 只服務「表裡沒有的文字」= 老師臨時貼的段落。
    # #3237 起它是**純查表**（字型 single + he_conjunction + 字型預設），
    # 不再是第二套選擇器（pypinyin 已移除）。⛔ 不要再往它身上加選擇能力 ——
    # 那正是 #3202/#3204/#3215 三張票疊出四層的來源。要改讀音請改表。
    zhuyin_map = (
        zhuyin_for_text(payload.lesson_uid, payload.target_text)
        if payload.lesson_uid
        else None
    )
    if zhuyin_map is None:
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
    """Fallback reason classification: 'too_short' | 'silent' | 'empty' | 'truncated' |
    'decode' | 'timeout' | 'safety' | 'hallucination' | 'error'.

    Only present when method='fallback'.  ⛔ 前端把每一種對應到**自己的**一句話
    （`frontend/src/hooks/transcribeFallbackMessage.ts`）—— 不要再把它們塌回同一句。
    `empty`（Gemini 聽不出內容）是 fallback 的大宗，它需要跟 `timeout` 完全不同的
    指示：一個要學生多唸一點，一個只要他再按一次（#3299）。
    'hallucination' (Issue #2321): Gemini echoed the lesson hint on silent/noisy audio."""


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
        "reason: <too_short|silent|empty|truncated|decode|timeout|safety|hallucination|error>} "
        "(HTTP 200).\n"
        "⚠️ 這裡原本寫「the frontend can show a fallback alert and use the Web Speech "
        "transcript」—— Web Speech fallback 在 #2266 已經移除，`fallbackReason` 在前端是"
        "寫死 null 的 stub，那個警示從來不會出現。契約兩邊對不上（#3299）。\n"
        "現在的真實行為：前端用 `reason` 查一句**逐原因**的訊息給學生看"
        "（`frontend/src/hooks/transcribeFallbackMessage.ts`）——"
        "太短要他多唸一點、太長要他分段、沒聲音要他檢查麥克風，"
        "只有暫時性問題才叫他再試一次。\n"
        "Rate-limited: 10 requests per minute per user.\n"
        "Audio: ≤10 MB (opus ≈ 55 min headroom), ≥1 s; MIME: audio/webm, audio/mp4, audio/ogg, audio/wav.\n"
        "(Issue #2497: no hard duration cap here — the frontend recorder bounds length per flow.)\n\n"
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
                "target_chars": scorable_char_count(target_text),
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
