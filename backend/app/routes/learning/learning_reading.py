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
from ...services.polyphone_words import readings_in as _polyphone_word_readings
from ...services.zhuyin_readings import font_zhuyin_table
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


# ⚠️ 這個範圍必須**涵蓋 pypinyin 認得的每一個漢字**，不然就會重演 #3175：
# 認不得的字會走到「非中文」那條，`startswith` 對不上 → fail-closed 停住 →
# **那個字之後整行都沒有注音**。兩個實際會踩到的：
#   〇 U+3007（台灣寫年份就用它：二〇二六年）—— 在 U+4E00 之下，舊範圍漏掉
#   CJK 擴充 B 之後 U+20000–U+2FA1F —— 舊範圍只到擴充 A
_CHINESE_CHAR_RE = re.compile(r"[〇一-鿿㐀-䶿\U00020000-\U0002FA1F]")

#: 注音符號本體（U+3105–U+312F）。真正的讀音一定含至少一個；數字／拉丁／標點
#: 一個都沒有。
#: ⚠️ 上界要到 U+312F 不是 ㄦ(U+3126) —— **ㄧㄨㄩ 三個介音排在 ㄦ 後面**
#: （U+3127–U+3129）。寫成 `[ㄅ-ㄦ]` 會把「育」(ㄩˋ)、「一」(ㄧ) 判成不是注音，
#: 純中文的正向對照當場就紅了。
_BOPOMOFO_RE = re.compile(r"[\u3105-\u312F]")


#: 注音的四個聲調符號與輕聲點。去掉之後剩下的是「音節」。
_TONE_MARKS = "ˊˇˋ˙"


def _strip_tone(reading: str) -> str:
    return reading.rstrip(_TONE_MARKS)


def _build_zhuyin_map(target_text: str) -> dict[int, str]:
    """Return a position→bopomofo map for all CJK characters in target_text.

    Passing the full string (rather than individual chars) lets pypinyin use
    surrounding context to disambiguate polyphonic characters (破音字), e.g.
    「的」(ㄉㄜ˙ vs ㄉㄧˋ), 「樂」(ㄌㄜˋ vs ㄩㄝˋ), 「長」(ㄓㄤˇ vs ㄔㄤˊ).
    ⛔ 不可以改成逐字呼叫 —— `lazy_pinyin("的")` 單獨呼叫回 ㄉㄜ˙，
    「目的地」的「的」要讀 ㄉㄧˋ，那個能力會整個弄丟。

    ## 為什麼不能用 zip（#3175）

    這裡原本寫 `zip(target_text, bopomofo_list)`，前提是「一個字一個元素」。
    **那個前提是錯的**：pypinyin 會把**連續的非中文**（數字、拉丁字母、連著的
    標點）塌成**一個**元素，於是從那一點開始整串位移 ——

        "民國2019年楊俊體育課"
            年 → ㄊㄧˇ（「體」的）  楊 → ㄩˋ（「育」的）  俊 → ㄎㄜˋ（「課」的）
            體育課 三個字完全沒有注音

    而且 `bpmf != char` 那個過濾器攔不住標點：`"…我點頭。"` 裡的「頭」會拿到
    句號當 ruby。服務端量到 **151 課有 135 課（89.4%）至少一段對不齊，
    69.5% 的中文字落在位移點之後**，錯了多久沒查。

    ## 修法：照長度消耗，不靠位置對齊

    走一遍 `bopomofo_list`，非中文的「原樣回傳」元素消耗 `len(element)` 個來源
    字元，中文字消耗 1 個。這樣**整串的上下文完全不變**（pypinyin 看到的仍是
    整個句子），只修正索引。

    fail-closed：一旦對不上就**就地停住**，後面的字寧可沒有 ruby。
    漏標只是少一排注音，標錯是教錯讀音。

    ## 「和」（#3204）

    台灣把當連接詞的「和」讀 **ㄏㄢˋ**，而它在這裡優先於其他所有判斷 ——
    因為那是三道門的結果（`services/he_conjunction.py`：jieba 斷詞、380 筆教育部
    例外清單、以及「和」自我指稱的檢查），比逐字查表更有把握。

    ⛔ 不可以無腦替換：`和平` 是 ㄏㄜˊ、`一唱一和` 是 ㄏㄜˋ、`溫和` 是 ㄏㄜˊ ——
    盲換是拿一個錯讀音換另一個。所以判斷是**跟語音那條路共用的**（`he_conjunction.py`
    原本住在 `tts/normalization.py` 裡，#3204 抽出來），不是重寫一套。
    #3202 上線時這條還沒接，語料 730 處全部標成 ㄏㄜˊ。
    """
    single, poly = font_zhuyin_table()
    # ⚠️ fail-open：jieba 或例外清單載不到時回空集合，「和」維持字型的 ㄏㄜˊ ——
    #    跟這次改動之前一樣。標錯讀音比漏標嚴重。
    he_positions = _he_conjunction_positions(target_text) if "和" in target_text else frozenset()
    # 詞樣式表（#3215）—— 優先於逐字判斷，因為「詞」比「字」具體：
    # pypinyin 對「難」的每個情境都回 ㄋㄢˊ，而 poyin_db 知道 災難/難民/患難 是 ㄋㄢˋ。
    # 讀不到表就回空 dict，維持原本的 pypinyin 判讀。
    word_readings = _polyphone_word_readings(target_text)
    bopomofo_list = lazy_pinyin(target_text, style=Style.BOPOMOFO)
    zhuyin_map: dict[int, str] = {}
    pos = 0
    for element in bopomofo_list:
        if pos >= len(target_text):
            break
        char = target_text[pos]
        if _CHINESE_CHAR_RE.match(char):
            # 中文字：一個字一個音節，永遠只消耗一個字元。
            # 只收「看起來真的是注音」的東西 —— 萬一哪天 pypinyin 對中文字也
            # 不再 1:1，這裡會變成漏標而不是把數字／標點標成讀音。
            reading = word_readings.get(pos)
            if reading is None:
                reading = "ㄏㄢˋ" if pos in he_positions else single.get(char)
            if reading is None and element and element != char and _BOPOMOFO_RE.search(element):
                entry = poly.get(char)
                if entry is None:
                    # 字型沒收這個字（175 課裡總共 5 字次）→ 維持 pypinyin。
                    reading = element
                elif element in entry["v"]:
                    # pypinyin 依上下文挑的讀音，台灣字型有 → 直接採用
                    reading = element
                else:
                    # 對不上時的分工原則：**音節聽 pypinyin，聲調聽字型**。
                    #
                    # pypinyin 的價值是「在這個詞裡是哪個音」（它看了整句上下文）；
                    # 字型的價值是「台灣這個音讀第幾聲」。嚴格比對整個字串會為了一個
                    # 聲調把對的音節整個丟掉，退回一個**完全不同的音**：
                    #
                    #   削  pypinyin ㄒㄩㄝ · 字型候選 [ㄒㄧㄠ, ㄒㄩㄝˋ]
                    #       嚴格比對 → 退預設 ㄒㄧㄠ（音錯）
                    #       同音節   → ㄒㄩㄝˋ（對）
                    #
                    # 全語料量過（`full_text_annotate` + `key_reading`，536 個走到這條
                    # 分支的位置、17 個字）：同音節匹配**只改變兩個字**，其餘 15 個字的
                    # 同音節候選本來就等於預設：
                    #
                    #   削 ×21  ㄒㄧㄠ → ㄒㄩㄝˋ   修好（語料全是 剝削/削弱/瘦削/削減）
                    #   欸 ×3   ㄟˋ  → ㄞˇ      改壞（見 NEW_DISAGREEMENT_FROM_3202）
                    #
                    # 「唯一一個」候選才採用 —— 有兩個以上同音節候選代表聲調本身就是
                    # 語意區別，那時沒有依據可選，退預設。
                    same_syllable = [r for r in entry["v"] if _strip_tone(r) == _strip_tone(element)]
                    reading = same_syllable[0] if len(same_syllable) == 1 else entry["d"]
            if reading:
                zhuyin_map[pos] = reading
            pos += 1
            continue
        # 非中文：pypinyin 原樣回傳，可能是一整串（"2019"、"Wi-Fi"、"」，"）。
        if not target_text.startswith(element, pos):
            # 對不上 —— 不知道後面該怎麼數了，就地停住（見上方 fail-closed）。
            break
        pos += len(element)
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
    """Fallback reason classification: 'timeout' | 'safety' | 'decode' | 'empty' | 'error' | 'too_short' | 'hallucination'.
    Only present when method='fallback'. Used by frontend to show appropriate alert.
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
        "reason: <timeout|safety|decode|empty|error>} (HTTP 200) so the frontend can show "
        "a fallback alert and use the Web Speech transcript.\n"
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
