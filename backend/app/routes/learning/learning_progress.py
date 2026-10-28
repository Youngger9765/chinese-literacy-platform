"""Student Progress routes.

Handles stuck-point detection and per-text completion progress tracking.
"""
import logging
from datetime import datetime
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.session import LearningSession
from ...models.user import User
from ...schemas.session import parse_step_progress
from ...services.learning_stats_service import get_completed_story_count
from ...services.lesson_loader import get_lesson_by_id
from ...services.stuck_detection_service import detect_stuck_points
from ._helpers import verify_student_access

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Step names / labels ───────────────────────────────────────────────────────

STEP_NAMES = {
    1: "intro",
    2: "live_tutor",
    3: "comprehension",
    4: "vocab",
    5: "full_reading",
    6: "report",
}

_MAX_STEP_NUM = max(STEP_NAMES.keys())

STEP_LABELS = {
    1: "簡介",
    2: "逐段朗讀",
    3: "課文理解",
    4: "生字練習",
    5: "全文朗讀",
    6: "學習報告",
}

# Frontend step IDs may differ from backend STEP_NAMES values.
# This mapping normalizes frontend keys → backend keys (#1073).
_FRONTEND_STEP_ALIAS: dict[str, str] = {
    "tutor": "live_tutor",
    "full-reading": "full_reading",
    "reading-annotation": "intro",
}


def _normalize_step_key(key: str) -> str:
    """Map a frontend step ID to the canonical backend STEP_NAMES key."""
    return _FRONTEND_STEP_ALIAS.get(key, key)


# ── Helper functions ──────────────────────────────────────────────────────────

def _compute_step_completion(session: LearningSession) -> dict[str, str]:
    """Derive per-step status from a LearningSession record.

    Returns a dict mapping step key -> 'completed' | 'in_progress' | 'not_started'.

    Priority: use step_progress.steps_completed[] (string array) as the source
    of truth when available, since the frontend writes this field directly.
    Falls back to current_step (integer) for older sessions without step_progress.
    (#1073)
    """
    # Try to read steps_completed from step_progress JSONB first.
    # parse_step_progress logs a WARNING if the value is malformed instead of
    # swallowing the error silently (Issue #1180).
    sp = parse_step_progress(
        session.step_progress,
        session_id=session.id,
        context="learning_progress._compute_step_completion",
    )
    sp_completed: list[str] | None = None
    if sp is not None:
        sp_completed = sp.steps_completed  # already validated as list[str]

    statuses: dict[str, str] = {}

    if sp_completed is not None:
        # Source of truth: step_progress.steps_completed[] (#1073)
        # Normalize frontend step IDs to backend keys for comparison
        completed_set = {_normalize_step_key(s) for s in sp_completed}
        sp_current = sp.current_step if sp is not None else None
        normalized_current = _normalize_step_key(sp_current) if sp_current else None
        for _step_num, key in STEP_NAMES.items():
            if key in completed_set:
                statuses[key] = "completed"
            elif key == normalized_current and session.status == "in_progress":
                statuses[key] = "in_progress"
            elif session.status == "completed":
                # Completed session: treat all steps as completed even if
                # steps_completed[] is incomplete (#1073 review)
                statuses[key] = "completed"
            else:
                statuses[key] = "not_started"
    elif session.status == "completed":
        # ⛔ 上面那條分支（step_progress 有值）寫著「completed 的 session 全部算完成」，
        #    這條 fallback 原本**沒有**同一條規則 —— 於是同一個語意有兩種答案：
        #    有 step_progress 的完成課顯示 100%，沒有的顯示 17%（只算到第 1 步）。
        #    學生自己的學習歷程頁看到的就是那個 17%。(#2964)
        for _step_num, key in STEP_NAMES.items():
            statuses[key] = "completed"
    else:
        # Fallback: step_progress absent (legacy sessions or fresh session).
        # Use current_step_derived (which itself falls back to 1 when no data). (#1182)
        derived = session.current_step_derived
        for step_num, key in STEP_NAMES.items():
            if step_num < derived:
                statuses[key] = "completed"
            elif step_num == derived and session.status == "in_progress":
                statuses[key] = "in_progress"
            else:
                statuses[key] = "not_started"

    return statuses


def _recommend_next_step(session: LearningSession) -> dict:
    """Apply rule-based logic to suggest the student's next action.

    Rules (priority order):
    1. Session complete -> suggest a new text
    2. Full reading score < 70 -> re-do full reading
    3. >= 3 character errors -> do vocab practice first
    4. LiveTutor accuracy < 70 -> re-read paragraphs
    5. Default -> continue from current step
    """
    if session.status == "completed":
        return {"action": "new_text", "step": None, "reason": "本課已完成！挑戰新課文吧。"}

    error_count = 0
    if session.reading_result and isinstance(session.reading_result, dict):
        errors = session.reading_result.get("error_chars", [])
        error_count = len(errors) if isinstance(errors, list) else 0

    accuracy = session.accuracy or 0.0

    # Use derived step (single source of truth via step_progress) for all
    # rule comparisons.  (#1182)
    current_step = session.current_step_derived

    if current_step >= 5 and session.full_reading_result:
        full_score = 0.0
        if isinstance(session.full_reading_result, dict):
            full_score = session.full_reading_result.get("match_rate", 0) or 0.0
        if full_score < 70:
            return {
                "action": "retry_step",
                "step": "full_reading",
                "step_label": STEP_LABELS[5],
                "reason": f"全文朗讀正確率 {full_score:.0f}%，建議再練習一次。",
            }

    if error_count >= 3 and current_step < 4:
        return {
            "action": "retry_step",
            "step": "vocab",
            "step_label": STEP_LABELS[4],
            "reason": f"發現 {error_count} 個錯字，建議先做生字練習。",
        }

    if accuracy > 0 and accuracy < 70 and current_step <= 2:
        return {
            "action": "retry_step",
            "step": "live_tutor",
            "step_label": STEP_LABELS[2],
            "reason": f"朗讀正確率 {accuracy:.0f}%，建議重練逐段朗讀。",
        }

    current_key = STEP_NAMES.get(current_step, "intro")
    return {
        "action": "continue",
        "step": current_key,
        "step_label": STEP_LABELS.get(current_step, ""),
        "reason": "繼續未完成的學習步驟。",
    }


def _is_station_done(
    step_sequence: list[str],
    index: int,
    steps_completed_raw: list[str],
    has_session: bool,
) -> bool:
    """`step_sequence[index]` 這一站算不算完成——**跟前端
    `islandTemplate.ts` 的 `isStationDone()` 共用同一套規則**，兩邊都讀
    `fixtures/island-station-completion.json` 鎖同一組案例，數字不能對
    不起來（PRD §5.6，產品負責人 2026-10-26 明令兩邊要一致）。

    `lesson-intro` 永遠不會寫進 `steps_completed`（平台設計如此，§5.2），
    只能靠 `has_session` 判斷。其餘站先比對 `step_sequence` 裡這個完整
    字串（含錨點，例如 `full-text-annotate#dcavv`）是否整個出現在
    `steps_completed`——命中就算完成。沒命中時，**只有這個型態在整份
    `step_sequence` 裡只出現一次**，才退而接受 `steps_completed` 裡出現
    「不帶錨點的型態字串」也算完成（真實 preview 資料截到的情況：
    `knowledge-station#uxwy3` 這站，伺服器卻存成沒帶錨點的
    `knowledge-station`，見 fixture 案例 1）。這個退讓只有在沒有「哪一
    輪」疑慮時才安全——多篇課文同型態出現兩次以上（例如兩輪各自的
    `full-text-annotate#A`／`full-text-annotate#B`，見 fixture 案例 2、3）
    不能套用，否則會把 A 輪完成誤判成 B 輪也完成。
    """
    entry = step_sequence[index]
    step_type = entry.split("#")[0]
    if step_type == "lesson-intro":
        return has_session
    if entry in steps_completed_raw:
        return True
    occurrences = sum(1 for s in step_sequence if s.split("#")[0] == step_type)
    return occurrences == 1 and step_type in steps_completed_raw


def _count_stations_done(
    step_sequence: list[str],
    steps_completed_raw: list[str],
    has_session: bool,
) -> int:
    """整份 `step_sequence` 完成了幾站——我的群島頁「探索中 x/y 站」的 x。"""
    return sum(
        1 for i in range(len(step_sequence))
        if _is_station_done(step_sequence, i, steps_completed_raw, has_session)
    )


def _island_progress_for_lesson(
    step_sequence: list[str] | None,
    steps_completed_raw: list[str],
    has_session: bool,
) -> tuple[bool, int, int]:
    """回傳 `(is_occupied, stations_done, stations_total)`（PRD §5.3／§5.6）。
    `step_sequence` 是這堂課真正的站點清單，來源跟 `/api/stories/{id}`
    一樣，都是 `get_lesson_by_id()` 回傳的記憶體索引（零額外查詢成本）。

    `step_sequence` 是 `None`（查無這堂課，例如非島嶼課文的舊資料，或
    `story_slug` 根本不是數字 id——見呼叫端的 `int()` fail-closed 處理）
    或是空清單，都 fail-closed 回 `(False, 0, 0)`——沒有站點清單就沒有
    「全部站點都完成」這回事，不可能誤判成 `True`。
    """
    if not step_sequence:
        return False, 0, 0
    stations_total = len(step_sequence)
    stations_done = _count_stations_done(step_sequence, steps_completed_raw, has_session)
    return stations_done == stations_total, stations_done, stations_total


# ── Stuck-Point Detection (Issue #91) ─────────────────────────────────────────

class StoryStuckItem(BaseModel):
    story_slug: str
    attempt_count: int
    best_accuracy: float
    last_attempt: str


class CharacterStuckItem(BaseModel):
    character: str
    error_count: int
    last_error_date: str | None


class StuckPointsResponse(BaseModel):
    story_stuck: list[StoryStuckItem]
    character_stuck: list[CharacterStuckItem]
    is_declining: bool
    accuracy_trend: list[float]


@router.get(
    "/learning/students/{student_id}/stuck-points",
    response_model=StuckPointsResponse,
)
def get_stuck_points(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect learning stuck-points for a student.

    Accessible by the student themselves or their teacher.

    Returns:
    - story_stuck: stories attempted 3+ times without >=5% accuracy improvement
    - character_stuck: characters with 3+ errors across sessions (last 30 days)
    - is_declining: True if last 3 sessions show strictly declining accuracy
    - accuracy_trend: list of accuracy values (oldest to newest, last 10 sessions)
    """
    verify_student_access(student_id, current_user, db)
    data = detect_stuck_points(student_id, db)
    logger.info(
        "Stuck-point detection for student %d: %d story stuck, %d char stuck, declining=%s",
        student_id,
        len(data["story_stuck"]),
        len(data["character_stuck"]),
        data["is_declining"],
    )
    return StuckPointsResponse(**data)


# ── Student Progress ──────────────────────────────────────────────────────────

class StepStatusItem(BaseModel):
    step_key: str
    step_label: str
    status: str  # not_started | in_progress | completed


class TextProgressItem(BaseModel):
    story_slug: str
    story_title: str | None  # human-readable title, e.g. "第六課 牛頓的故事"
    latest_session_id: int
    status: str  # in_progress | completed | abandoned
    steps: list[StepStatusItem]
    completion_pct: int  # 0-100
    overall_score: float | None
    accuracy: float | None
    started_at: datetime
    completed_at: datetime | None
    next_step: dict
    # #3780 D2（PRD §5.6）：給「喝采島」範本模式用的原始動態清單，不經過上面
    # 那個舊 6 步模型正規化——範本模式的站點 id 是 `type#錨點` 格式（例如
    # `full-text-annotate#dcavv`），舊模型的 `STEP_NAMES` 認不得，前端要自己
    # 用 `.split('#')[0]` 比對。`has_session` 對應 PRD §5.2 的課程簡介特例
    # （平台設計上 lesson-intro 永遠不會寫進 steps_completed，只能靠「這一課
    # 有學習紀錄」判斷完成）——這個端點本來就是從既有 session 聚合出來的，
    # 出現在 `texts[]` 裡就代表有 session，欄位的意義是讓前端不用去猜。
    steps_completed: list[str]
    has_session: bool
    # #3780 D（PRD §5.6）：這堂課在喝采島上是不是「佔領」了（§5.3——所有站都
    # 完成）。伺服器端算，不是前端猜——理由見 PRD §5.6 的「工頭判斷」段：
    # 故事模式完成最後一站時不會觸發舊的 session.status=completed 流程，且
    # `/api/stories` 清單不含 step_sequence，前端兩條路都算不出來。
    is_occupied: bool
    # 產品負責人 2026-10-26 加碼要求：給我的群島頁顯示「探索中 x/y 站」。
    # 跟 `is_occupied` 同一次計算、同一套規則（見 `_is_station_done`）；
    # 查無課文時兩者皆為 0。
    stations_done: int
    stations_total: int


class StudentProgressResponse(BaseModel):
    student_id: int
    texts_attempted: int
    texts_completed: int
    average_score: float | None
    texts: list[TextProgressItem]


@router.get(
    "/learning/students/{student_id}/progress",
    response_model=StudentProgressResponse,
)
def get_student_progress(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return per-text completion progress for a student.

    Aggregates all learning sessions grouped by story_slug, keeping the
    most-recent session per text to compute step completion status and
    a rule-based next-step recommendation.

    Access: student themselves, or a teacher of their classroom.
    """
    verify_student_access(student_id, current_user, db)

    sessions = (
        db.query(LearningSession)
        .options(joinedload(LearningSession.text))
        .filter(LearningSession.student_id == student_id)
        .order_by(LearningSession.started_at.desc(), LearningSession.id.desc())
        .all()
    )

    # Keep only the most recent session per story_slug
    seen: set[str] = set()
    latest_per_text: list[LearningSession] = []
    for s in sessions:
        slug = s.story_slug or f"session-{s.id}"
        if slug not in seen:
            seen.add(slug)
            latest_per_text.append(s)

    texts: list[TextProgressItem] = []
    scores: list[float] = []

    for s in latest_per_text:
        slug = s.story_slug or f"session-{s.id}"
        step_statuses = _compute_step_completion(s)
        completed_count = sum(1 for v in step_statuses.values() if v == "completed")
        completion_pct = round(completed_count / 6 * 100)

        # #3780 D2：raw steps_completed（不經過上面 STEP_NAMES 正規化）。
        # 重新 parse 一次而不是從 `_compute_step_completion` 內部把它傳出來，
        # 是因為那支函式的回傳型別（`dict[str, str]`）是舊 6 步模型的介面，
        # 改它的簽章會動到其他呼叫端；這裡單獨、原地再 parse 一次成本很低。
        sp = parse_step_progress(
            s.step_progress,
            session_id=s.id,
            context="learning_progress.get_student_progress.steps_completed",
        )
        steps_completed_raw: list[str] = list(sp.steps_completed) if sp is not None and sp.steps_completed else []

        # #3780 D：`is_occupied`/`stations_done`/`stations_total`——記憶體查
        # 這堂課真正的 step_sequence（跟 `/api/stories/{id}` 同一份索引，
        # 零額外查詢成本）。`slug` 不一定是數字（例如 `session-{id}`
        # fallback、舊的 "L05" 這類代碼）——`int(slug)` 對這些輸入會丟
        # `ValueError`，一筆壞資料不能讓整支 API 對這個學生的其他課也一起
        # 回 500，所以包 try/except，查不到／轉換失敗都 fail-closed 當作
        # 這堂課不在喝采島範本模式範圍內（`_island_progress_for_lesson`
        # 收到 `None` 會回 `(False, 0, 0)`）。
        lesson = None
        try:
            lesson = get_lesson_by_id(int(slug))
        except (TypeError, ValueError):
            lesson = None
        is_occupied, stations_done, stations_total = _island_progress_for_lesson(
            lesson.get("step_sequence") if lesson else None,
            steps_completed_raw,
            has_session=True,  # 這個迴圈本來就只處理「已有 session」的課
        )

        step_items = [
            StepStatusItem(
                step_key=key,
                step_label=STEP_LABELS[num],
                status=step_statuses[key],
            )
            for num, key in STEP_NAMES.items()
        ]

        next_step = _recommend_next_step(s)

        if s.overall_score is not None:
            scores.append(s.overall_score)

        # Resolve human-readable title from the related Text record if available
        story_title: str | None = None
        if s.text is not None:
            story_title = s.text.title

        texts.append(TextProgressItem(
            story_slug=slug,
            story_title=story_title,
            latest_session_id=s.id,
            status=s.status,
            steps=step_items,
            completion_pct=completion_pct,
            overall_score=s.overall_score,
            accuracy=s.accuracy,
            started_at=s.started_at,
            completed_at=s.completed_at,
            next_step=next_step,
            steps_completed=steps_completed_raw,
            has_session=True,
            is_occupied=is_occupied,
            stations_done=stations_done,
            stations_total=stations_total,
        ))

    # Use canonical query for the aggregate count (Issue #981)
    texts_completed = get_completed_story_count(db, student_id)
    average_score = round(sum(scores) / len(scores), 1) if scores else None

    logger.info(
        "Progress for student %d: %d texts, %d completed",
        student_id, len(texts), texts_completed,
    )

    return StudentProgressResponse(
        student_id=student_id,
        texts_attempted=len(texts),
        texts_completed=texts_completed,
        average_score=average_score,
        texts=texts,
    )
