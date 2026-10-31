"""Step Progress routes (Issue #660).

Provides two endpoints to persist and retrieve per-step learning progress
from the `step_progress` JSONB column on LearningSession.

    PUT  /api/learning/sessions/{session_id}/progress  — save
    GET  /api/learning/sessions/{session_id}/progress  — load
"""
import logging
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ._helpers import get_owned_session
from ...database import get_db
from ...models.session import LearningSession
from ...models.user import User
from ...schemas.session import StepProgressResponse, StepProgressSaveRequest, parse_step_progress
from ...services.assignment_session_service import maybe_auto_submit_assignment_session
from ...services.lesson_loader import get_lesson_by_id
from ...services.reading_baby_service import record_station_evidence
from ...utils.slug import normalize_story_slug
# DEPRECATED (#1182): _STEP_KEY_TO_NUM / _MAX_STEP_NUM / _normalize_step_key were used
# to sync the integer current_step column. Sync removed; imports no longer needed here.

router = APIRouter()
logger = logging.getLogger(__name__)


@router.put(
    "/learning/sessions/{session_id}/progress",
    response_model=StepProgressResponse,
    summary="Save step progress for a learning session (Issue #660)",
)
def save_step_progress(
    session_id: int,
    payload: StepProgressSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist the frontend step-progress object to the DB.

    The payload mirrors the localStorage schema:
    - current_step: active step path key
    - steps_completed: list of completed step path keys
    - step_data: dict keyed by step path containing serialised progress

    Overwrites any previously stored step_progress for this session.
    Non-completed sessions only — completed sessions are read-only.
    """
    session = get_owned_session(session_id, current_user, db)

    # parse_step_progress logs a WARNING when the stored value is malformed
    # instead of silently discarding it (Issue #1180).
    existing_sp = parse_step_progress(
        session.step_progress,
        session_id=session_id,
        context="learning_step_progress.save_step_progress",
    )
    existing_meta: dict = dict(existing_sp.meta) if existing_sp is not None else {}
    stored_version: int | None = existing_sp.version if existing_sp is not None else None

    # Optimistic concurrency check (#1187): reject stale writes.
    # Prevents overwriting newer progress when a previous save failed and the
    # client retries with an older snapshot.
    if payload.version is not None and stored_version is not None:
        if payload.version < stored_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "stale_version",
                    "stored_version": stored_version,
                    "incoming_version": payload.version,
                    "message": "Incoming progress is older than stored version; refresh and retry.",
                },
            )

    # Bump version: max(stored, incoming) + 1, or start at 1 if none.
    next_version = max(
        stored_version or 0,
        payload.version or 0,
    ) + 1
    existing_meta["last_synced_at"] = datetime.now(tz=timezone.utc).isoformat()

    # Issue #3682 跟進（production root cause）：這裡本來是整段 overwrite——
    # 一次 PUT 帶 steps_completed=[] 就會把先前已完成的步驟全部清空。真實發生
    # 過的案例：重新打開課程時，畫面在「GET 載入舊進度」完成並套用進 state
    # 之前，就先用初始（空）的本地 state 打了一次 PUT；那個版本號仍然比目前
    # 存的新，樂觀鎖擋不住，就這樣把已完成的步驟真的洗掉了。
    #
    # 修法：steps_completed 只能增加、不能減少——跟已存的做聯集，不直接採信
    # incoming 這個值本身（不管它是漏了、還是真的想清空，都不可信任客戶端
    # 那一局部的 state 代表全部真相）。step_data 逐 step key 合併：incoming
    # 裡有的 key 蓋過去，incoming 沒帶到的 key 保留舊的——同一個理由，用戶端
    # 一次只會完整帶著「目前這一步」的資料，不代表其他步驟的資料不存在了。
    # Issue #3682 follow-up (team-lead review): a blind union can't tell a
    # DELIBERATE un-complete apart from the premature-empty-save race this
    # fix exists to guard against — e.g. useStepProgressPersistence
    # .resetTutorStep's 「再讀一次」 redo flow (#2532/#2533), which removes
    # 'paragraph-reading' from steps_completed on purpose. `reset_steps`
    # names exactly which step ids to drop; everything else still only
    # ever grows via the union below.
    reset_steps = set(payload.reset_steps or [])
    existing_steps_completed = existing_sp.steps_completed if existing_sp is not None else []
    base_steps_completed = [s for s in existing_steps_completed if s not in reset_steps]
    merged_steps_completed = list(base_steps_completed)
    for step_id in payload.steps_completed:
        if step_id not in merged_steps_completed:
            merged_steps_completed.append(step_id)

    existing_step_data = existing_sp.step_data if existing_sp is not None else {}
    merged_step_data = {**existing_step_data, **payload.step_data}

    # Version is stored at the top level so the frontend can read it directly
    # from StepProgressData.version. __meta keeps other metadata (source, etc.).
    session.step_progress = {
        "current_step": payload.current_step,
        "steps_completed": merged_steps_completed,
        "step_data": merged_step_data,
        "version": next_version,
        "__meta": existing_meta,
    }

    # DEPRECATED (#1182): integer current_step sync removed.
    # step_progress.steps_completed is now the single source of truth;
    # session.current_step_derived computes the step number on the fly.
    # Do NOT add writes to session.current_step here.

    # Bug C fix (#1378): Append full-reading attempt to full_reading_attempts array.
    # When step_data contains 'full-reading'.result, extract it and append as a new
    # attempt snapshot (capped at 4).  Also update full_reading_result for backward compat.
    _maybe_append_full_reading_attempt(session, payload.step_data)

    # Issue #3024 — award step_complete XP (+ check badges) for any step that
    # is newly present in steps_completed vs. what was already stored. This is
    # the ONE place every step completion already flows through, so no new
    # endpoint or DB migration is needed. Runs in the SAME transaction as the
    # step_progress save (award_xp/check_and_award_badges only flush; the
    # db.commit() below covers both).
    previously_completed = existing_sp.steps_completed if existing_sp is not None else []
    xp_awarded, badges_unlocked = _award_step_complete_xp(
        db,
        student_id=current_user.id,
        session_id=session_id,
        previously_completed=previously_completed,
        newly_reported=payload.steps_completed,
    )

    # Issue #3780 第一階段 — 閱讀寶貝：同一個「每個 step 完成都會流經這裡」的
    # 位置順便寫一筆能力指標證據，取代文字寶貝 v1 的 `_award_word_baby_rewards`
    # （v1 整套刪除，見 docs/design/reading-babies/game-design.md §5）。道理跟
    # 上面的 XP 一樣（同一個 transaction，不另開端點、不另外加前端呼叫）。
    #
    # 沿用 v1 已經驗證過的兩個教訓：
    #   (1) 逐站獨立 SAVEPOINT——一站判定失敗不能牽連同一次存檔裡其他已經成功
    #       寫入的站（code-reviewer finding，2026-10-26 第二輪）
    #   (2) `record_station_evidence` 本身的冪等保證已經處理「這格通過過沒」，
    #       這裡只單純呼叫它，不重複判斷
    # classroom_id 在這個掛點不嘗試解析——一個 session 跟「教學現場的哪個班級」
    # 沒有穩定的 1:1 關係（可能是自學、可能是被指派到多個班級的其中一個）。
    # 寫 None（自學語意）不影響老師端熱力表：`compute_classroom_indicator_heatmap`
    # 是用班級名冊 join 學生 id 去查，不是用這裡寫的 classroom_id 篩選
    # （見 reading_baby_service.py 的 docstring）。
    reading_baby_events = _record_reading_baby_evidence(
        db,
        student_id=current_user.id,
        session=session,
        step_data=merged_step_data,
        previously_completed=previously_completed,
        newly_reported=payload.steps_completed,
    )

    db.commit()
    db.refresh(session)
    logger.info(
        "Saved step_progress for session %d (user %d): current=%s completed=%d xp_awarded=%d badges=%s",
        session_id, current_user.id, payload.current_step, len(payload.steps_completed),
        xp_awarded, badges_unlocked,
    )

    # Issue #3682 — auto-submit a linked assignment the moment every required
    # step is reported complete, without relying on the frontend's sessionStorage
    # still knowing this is an assignment session (that's exactly what goes
    # missing in a new tab / browser restart / resuming days later — the
    # bug this fixes). Safe no-op for self-practice sessions and for sessions
    # already submitted/graded — see maybe_auto_submit_assignment_session.
    if payload.assignment_ready_for_submit:
        maybe_auto_submit_assignment_session(session_id, db)

    return StepProgressResponse(
        session_id=session.id,
        step_progress=session.step_progress,
        xp_awarded=xp_awarded,
        badges_unlocked=badges_unlocked,
        reading_baby_events=reading_baby_events,
    )


# ── Mid-session step-complete XP + badge check (Issue #3024) ──────────────────

#: 'report' is the results page itself (ReportPage marks it complete on mount
#: for teacher-dashboard visibility), not a step the student practiced. It
#: must never earn step_complete XP — that would double-count against the
#: session_complete settlement (POST /gamification/session-complete) that
#: fires at essentially the same moment.
_STEP_COMPLETE_XP_EXCLUDED_STEP_IDS = frozenset({"report"})


def _award_step_complete_xp(
    db: Session,
    *,
    student_id: int,
    session_id: int,
    previously_completed: list[str],
    newly_reported: list[str],
) -> tuple[int, list[str]]:
    """Award step_complete XP for steps newly present in `newly_reported`.

    Idempotent per (session_id, step_id): a step already present in
    `previously_completed` is skipped, so re-saving the same list (component
    remount, debounced re-sync) never double-awards. Returns (total XP
    awarded by this call, badge keys newly unlocked by this call) so the
    caller can surface both to the frontend for immediate feedback.
    """
    from ...services.gamification_service import award_xp, check_and_award_badges

    already = set(previously_completed)
    newly_completed = [
        step_id for step_id in newly_reported
        if step_id not in already and step_id not in _STEP_COMPLETE_XP_EXCLUDED_STEP_IDS
    ]
    if not newly_completed:
        return 0, []

    xp_awarded = 0
    for step_id in newly_completed:
        award_xp(
            db,
            student_id=student_id,
            event_type="step_complete",
            session_id=session_id,
            note=f"完成大題：{step_id}",
        )
        xp_awarded += 3  # XP_REWARDS["step_complete"]

    # Badges that can genuinely be judged from data available mid-session
    # (XP totals, level, distinct-event-type count) are checked here too —
    # this is what makes "達成目標的當下就跑出來" (issue #3024) literally true
    # for those badges. Badges that need full-session data (accuracy/streak/
    # story counts) simply won't satisfy their condition yet and are left for
    # the real session-complete settlement, which is unaffected by this call
    # (see the (session_id, event_type="session_complete") idempotency fix in
    # gamification_service.py).
    newly_unlocked = check_and_award_badges(db, student_id, session_id=session_id)
    return xp_awarded, newly_unlocked


# ── 閱讀寶貝：能力指標證據紀錄觸發點（Issue #3780 第一階段） ─────────────

#: 跟 XP 用同一條排除理由：'report' 是結果頁掛載時自動標完成的，不是學生真的
#: 做了什麼——如果讓它也能記成長，等於「打開結果頁」這個被動動作就能拿到，
#: 違反 PRD §2「學得會 > 看得下去 > 好看」的優先序。另外 `station_indicator_map`
#: 裡 "report" 本來就是 `signal: none`，`record_station_evidence` 查不到這個站
#: 會自己回 None——這裡的排除清單是第二道防線，講清楚「為什麼」，不是唯一防線。
_READING_BABY_EXCLUDED_STEP_IDS = frozenset({"report"})


def _record_reading_baby_evidence(
    db: Session,
    *,
    student_id: int,
    session: "LearningSession",
    step_data: dict[str, Any],
    previously_completed: list[str],
    newly_reported: list[str],
) -> list[dict]:
    """完成一個站（steps_completed 新增一個 step_id）時，寫一筆能力指標證據——
    取代文字寶貝 v1 的 `_award_word_baby_rewards`（v1 整套刪除，見
    docs/design/reading-babies/game-design.md §5）。跟 `_award_step_complete_xp`
    共用同一個「每個 step 完成都會流經這裡」的位置（issue #3024 的先例已經
    證實這裡是唯一入口，不需要新端點）。

    **回傳值**：這次呼叫真的新寫入的成長事件清單，每筆
    `{"station", "ability_id", "quality_passed"}`，給呼叫端填進
    `StepProgressResponse.reading_baby_events`，讓島上 HUD 能顯示「這一站
    成長了」的小提示（game-design.md §3.3）。**冪等靠
    `reading_baby_service.record_station_evidence` 自己的兩道檢查**——計分型
    態的站用 `has_passed_evidence`（一旦通過就不再重記），completion 型態的
    站用 `has_any_evidence`（存在過一筆就不再重記，因為它永遠不會通過）；
    同一格之後再呼叫一律回 `None`，不會重複出現在這個清單裡。

    **lesson-intro 的特例**（game-design.md §1.1）：這個步驟設計上永遠不會
    出現在 `steps_completed`（課程簡介頁不會回報「完成」），定義為「進入
    這一課即是遇見」。這裡的處理方式跟 v1 一樣：**只要這一課有任何一次
    step_progress 儲存**，就嘗試記一次 lesson-intro 的證據——
    `record_station_evidence` 本身冪等，「每次儲存都嘗試」是安全的。

    **逐站獨立 SAVEPOINT**（沿用 v1 已驗證過的教訓，code-reviewer 2026-10-26
    第二輪 finding）：一次存檔可能同時涵蓋好幾個新完成的站。如果整個迴圈包在
    同一層 SAVEPOINT 裡，其中一站判定時炸掉會連其他站**已經成功**的判定一起
    回滾——而這些站已經寫進 steps_completed，以後不會再被當成「新完成」重新
    嘗試，成長紀錄就永久遺失了。這裡每一站各自一層 SAVEPOINT：一站出錯只
    回滾那一站自己的部分寫入，記 log 後繼續下一站，不影響其他站、也不影響
    外層已經準備要存的 step_progress／XP（PRD §9「寫入失敗不能讓學生的
    成長悄悄消失」的具體落地）。

    **站必須真的在這一課裡才量**：靠 `reading_baby_config.get_lesson_indicator
    (lesson_uid)["stations"]` 本身就是逐課精算出來的對照（見
    `scripts/build_reading_baby_lesson_indicators.py`），不是一份跨課共用的
    扁平白名單——對沒有這個站的課回報該站，`record_station_evidence` 查
    不到對應的 `ability_id` 會直接回 `None`，等於沿用 v1「站必須真的在這一課
    的 step_sequence 裡」那條安全防線，只是防線現在長在設定檔的資料結構
    裡，不需要另外比對一次。
    """
    lesson = _resolve_lesson(session)
    if lesson is None:
        return []  # 找不到對應的內容樹課程（如測試用的假 slug），不嘗試記錄
    lesson_uid = lesson.get("lesson_uid")
    if lesson_uid is None:
        return []

    events: list[dict] = []

    def _try_record(step_id: str) -> None:
        station = step_id.split("#", 1)[0]
        step_payload = step_data.get(step_id)
        if step_payload is None:
            step_payload = step_data.get(station)
        try:
            # `record_station_evidence` 已經自己管理寫入的 SAVEPOINT／重試
            # （見 reading_baby_service.py），這裡的 try/except 是給它內部
            # 也攔不到的例外（例如判定邏輯本身炸掉）當最後一道防線，不重複
            # 包一層 begin_nested()。
            row = record_station_evidence(
                db,
                student_id=student_id,
                lesson_uid=lesson_uid,
                station=station,
                session_id=session.id,
                step_payload=step_payload if isinstance(step_payload, dict) else None,
            )
        except Exception:
            logger.exception(
                "reading-baby evidence recording failed for station %s (lesson %s, user %d) — "
                "skipped, other stations in this save are unaffected, step-progress + XP unaffected",
                station, lesson_uid, student_id,
            )
            return
        if row is None:
            return  # 不量這個站／已經通過過／寫入失敗（見 record_station_evidence）
        events.append({
            "station": station,
            "ability_id": row.indicator_code,
            "quality_passed": row.quality_passed,
        })

    # lesson-intro：每次儲存都嘗試記一次，冪等保證不會重複出現在 events 裡。
    _try_record("lesson-intro")

    already = set(previously_completed)
    newly_completed = [
        step_id for step_id in newly_reported
        if step_id not in already and step_id not in _READING_BABY_EXCLUDED_STEP_IDS
    ]
    for step_id in newly_completed:
        _try_record(step_id)

    return events


def _resolve_lesson(session: "LearningSession") -> dict | None:
    """session.story_slug_derived（如 "6"）→ 內容樹的完整 lesson dict（含
    "lesson_uid" 跟 "step_sequence"）。

    這是兩個不同的編號系統（#3780 探路時發現）：`story_slug` 是這個平台
    session/路由用的編號，`lesson_uid` 是 `backend/data/lessons/` 內容樹的
    課程 id，閱讀寶貝的設定檔（`app/data/reading_baby/lesson_indicators.json`）
    全部用後者。回傳完整 dict（不只 lesson_uid 字串）是因為呼叫端還需要
    `step_sequence`（沿用 v1 時代 security review 的既有理由，2026-10-27）。
    """
    slug = session.story_slug_derived
    if not slug:
        return None
    try:
        lesson_id = int(normalize_story_slug(slug))
    except (ValueError, TypeError):
        return None
    return get_lesson_by_id(lesson_id)


# ── Bug C fix helpers ─────────────────────────────────────────────────────────

_MAX_FULL_READING_ATTEMPTS = 4


def _maybe_append_full_reading_attempt(
    session: "LearningSession",  # type: ignore[name-defined]
    step_data: dict[str, Any] | None,
) -> None:
    """If step_data includes a full-reading result, append it to full_reading_attempts.

    Rules:
    - Extract from step_data['full-reading']['result']
    - Build attempt snapshot with attempt_index, timestamp, cpm, accuracy, match_rate,
      duration_ms, audio_url
    - Append to session.full_reading_attempts (capped at _MAX_FULL_READING_ATTEMPTS)
    - Also update full_reading_result (scalar, backward compat) = latest attempt result
    - If the incoming result is identical to the last stored attempt (same cpm + duration_ms),
      skip to avoid duplicates from page reloads
    """
    if not step_data:
        return

    full_reading_data = step_data.get("full-reading")
    if not isinstance(full_reading_data, dict):
        return

    result = full_reading_data.get("result")
    if not isinstance(result, dict):
        return

    # Read current attempts (default to [] if missing/None/malformed)
    existing: list = session.full_reading_attempts  # type: ignore[assignment]
    if not isinstance(existing, list):
        existing = []

    # Deduplicate: skip if identical to the last attempt (prevent page-reload duplicates)
    if existing:
        last = existing[-1]
        if (
            last.get("cpm") == result.get("cpm")
            and last.get("duration_ms") == result.get("durationMs")
        ):
            return  # same attempt — no-op

    attempt_index = len(existing) + 1
    now_iso = datetime.now(tz=timezone.utc).isoformat()

    snapshot: dict[str, Any] = {
        "attempt_index": attempt_index,
        "timestamp": now_iso,
        "cpm": result.get("cpm"),
        "accuracy": result.get("accuracy"),
        "match_rate": result.get("matchRate"),
        "duration_ms": result.get("durationMs"),
        "audio_url": result.get("audioUrl") or result.get("audio_url"),
    }

    updated = existing + [snapshot]

    # Cap at 4 (per learning design: 超過 4 次只是背起來)
    if len(updated) > _MAX_FULL_READING_ATTEMPTS:
        updated = updated[-_MAX_FULL_READING_ATTEMPTS:]
        # Re-index attempt_index fields
        for i, attempt in enumerate(updated, start=1):
            attempt["attempt_index"] = i

    session.full_reading_attempts = updated

    # Backward compat: keep full_reading_result as the latest attempt's raw result
    session.full_reading_result = result


@router.get(
    "/learning/sessions/{session_id}/progress",
    response_model=StepProgressResponse,
    summary="Load step progress for a learning session (Issue #660)",
)
def get_step_progress(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the stored step_progress for a session.

    Returns step_progress: null when no progress has been saved yet
    (frontend should fall back to localStorage in that case).
    """
    session = get_owned_session(session_id, current_user, db)
    reading_baby_events = _load_reading_baby_events_for_lesson(db, student_id=current_user.id, session=session)
    return StepProgressResponse(
        session_id=session.id,
        step_progress=session.step_progress,
        reading_baby_events=reading_baby_events,
    )


def _load_reading_baby_events_for_lesson(
    db: Session, *, student_id: int, session: "LearningSession"
) -> list[dict]:
    """讀出這個學生、這一課**目前已經存在**的全部閱讀寶貝成長證據（取代 v1
    的 `_load_word_baby_rewards_for_lesson`，同一個理由延續下來）。

    這不是 `_record_reading_baby_evidence` 的重複——那支是 PUT handler 專用的
    「判定 + 寫入」，這支純粹是 SELECT，沒有冪等或 SAVEPOINT 的顧慮。

    **為什麼回傳「這一課全部」而不是「這次 save 新增的」**（v1 時代已經驗證
    過的理由，原樣沿用）：原本的設計讓島靠 PUT 回應的欄位（透過 postMessage
    推給島）顯示提示，但 ISLAND_STEP_DONE 會同步拆掉裝著學習頁的 iframe，
    而那個 PUT 的回應常常還沒回來——真實網路延遲下提示幾乎不會顯示。改成
    回島後由島自己向這個 GET 端點「拉」，不依賴任何訊息時序；GET 本來就會
    在回島時被 `refreshProgress()` 呼叫。
    """
    lesson = _resolve_lesson(session)
    if lesson is None:
        return []
    lesson_uid = lesson.get("lesson_uid")
    if lesson_uid is None:
        return []
    from ...models.reading_baby import StudentIndicatorEvidence

    rows = (
        db.query(StudentIndicatorEvidence)
        .filter_by(student_id=student_id, lesson_uid=lesson_uid)
        .all()
    )
    return [
        {
            "station": row.station,
            "ability_id": row.indicator_code,
            "quality_passed": row.quality_passed,
        }
        for row in rows
    ]
