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
from ...services.word_baby_service import award_station_rewards, reward_log_exists
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

    # Issue #3780 — 文字寶貝養成系統：同一個「每個 step 完成都會流經這裡」的
    # 位置順便觸發碎片/遭遇判定，道理跟上面的 XP 一樣（同一個 transaction，
    # 不另開端點、不另外加 DB migration 讓前端自己呼叫）。
    #
    # code-reviewer finding（2026-10-26，第二輪）：第一版把整個
    # `_award_word_baby_rewards` 迴圈包在同一層 SAVEPOINT 裡——如果一次存檔
    # 涵蓋 3 個新完成的站，第 3 站判定時炸掉，會連第 1、2 站**已經成功**的
    # 判定一起回滾。這幾站已經寫進 steps_completed，以後不會再被當成「新完成」
    # 重新嘗試，碎片就永久遺失了。修法：SAVEPOINT 的範圍改成**逐站**，不是
    # 整批——這樣移進 `_award_word_baby_rewards` 自己的迴圈裡做（見下方），
    # 這裡只單純呼叫它，不另外包一層會牽連多站的 SAVEPOINT。
    word_baby_rewards = _award_word_baby_rewards(
        db,
        student_id=current_user.id,
        session=session,
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
        word_baby_rewards=word_baby_rewards,
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


# ── 文字寶貝養成系統：碎片/遭遇判定觸發點（Issue #3780） ──────────────────

#: 跟 XP 用同一條排除理由：'report' 是結果頁掛載時自動標完成的，不是學生真的
#:做了什麼——如果讓它也能掉碎片，等於「打開結果頁」這個被動動作就能拿獎勵，
#: 違反 PRD §2「學得會 > 看得下去 > 好看」的優先序（design.md §2）。
_WORD_BABY_EXCLUDED_STEP_IDS = frozenset({"report"})


def _award_word_baby_rewards(
    db: Session,
    *,
    student_id: int,
    session: "LearningSession",
    previously_completed: list[str],
    newly_reported: list[str],
) -> list[dict]:
    """完成一個站（steps_completed 新增一個 step_id）時，觸發文字寶貝的碎片/
    遭遇判定——跟 `_award_step_complete_xp` 共用同一個「每個 step 完成都會流經
    這裡」的位置（issue #3024 的先例已經證實這裡是唯一入口，不需要新端點）。

    **回傳值（#3780 接島上，team-lead 2026-10-27 授權新增回應欄位）**：這次呼叫
    「真的新發放」的獎勵清單，每筆 `{"station", "fragment_awarded",
    "fragment_flavor", "encounter_result", "encounter_baby_id"}`，給呼叫端填進
    `StepProgressResponse.word_baby_rewards`，讓島上 HUD 能顯示「這一站掉了
    什麼」的小提示。**「真的新發放」靠 `reward_log_exists` 在呼叫
    `award_station_rewards` 之前先查一次**——沒有這個 pre-check，lesson-intro
    （設計上每次 save 都會重新嘗試判定一次）會在同一個 session 裡的每次
    autosave 都讓這個清單再出現一次同一筆獎勵，變成「每 5 秒跳一次你拿到
    獎勵了」，而不是只在真正發放的那一次。

    **為什麼選這裡當觸發點**（工頭判斷，team-lead 要求說明）：
    1. `save_step_progress` 是平台上**唯一**一個「不管哪個步驟、哪種關卡類型，
       完成了都會呼叫這支」的端點——跟 XP 系統選的是同一個理由
    2. 跟 XP 在同一個 DB transaction 裡（`db.commit()` 統一處理），不需要
       額外的端點或 migration 讓前端自己另外呼叫一次
    3. `steps_completed` 的字串就是 PRD §5.1 的 15 種站 id（已跟
       `frontend/src/config/stepConfig.ts` 的 `id` 欄位核對過是同一套命名）

    **lesson-intro 的特例**（PRD §5.2）：這個步驟設計上永遠不會出現在
    `steps_completed`（課程簡介頁不會回報「完成」），定義為「這一課有學習
    紀錄就算完成」。這裡的處理方式：**只要這一課有任何一次 step_progress
    儲存**（代表 session 確實存在），就嘗試判定一次 lesson-intro 的獎勵——
    `award_station_rewards` 本身是冪等的（`student_station_reward_log` 的
    唯一鍵保證只判定一次），所以「每次儲存都嘗試」是安全的，不會重複發放。

    **逐站獨立 SAVEPOINT**（code-reviewer 第二輪 finding，2026-10-26）：
    一次存檔可能同時涵蓋好幾個新完成的站。如果把整個迴圈包在同一層
    SAVEPOINT 裡，其中一站判定時炸掉會連其他站**已經成功**的判定一起回滾——
    而這些站已經寫進 steps_completed，以後不會再被當成「新完成」重新嘗試，
    碎片就永久遺失了。這裡改成每一站各自一層 SAVEPOINT：一站出錯只回滾
    那一站自己的部分寫入（錢包/抓到的寶貝等），記 log 後繼續下一站，不影響
    其他站、也不影響外層已經準備要存的 step_progress／XP。

    **站必須真的在這一課的 step_sequence 裡**（security review finding，
    2026-10-27）：光是「station 字串長得像 15 種站之一」不夠——學生可以在
    任何一課回報一個合法但這一課根本沒有的站（例如對沒有 spotlight 的課回報
    "spotlight"），農到不屬於這一課內容的獎勵。這裡在呼叫 `award_station_
    rewards` 之前，先比對（slug 剝除後的）base station id 是否真的出現在
    這一課真實的 `step_sequence` 裡；不在的話直接跳過，連 `award_station_
    rewards` 都不呼叫——不只是讓它回傳 None（finding #3 的無效站本來就會這
    樣），因為「合法站但錯的課」跟「完全無效的站」是兩種不同的擋法：前者要
    靠課程內容本身的真相（step_sequence）才擋得住，後者靠設定檔的 15 站表
    就夠。
    """
    lesson = _resolve_lesson(session)
    if lesson is None:
        return []  # 找不到對應的內容樹課程（如測試用的假 slug），不嘗試判定
    lesson_uid = lesson.get("lesson_uid")
    if lesson_uid is None:
        return []

    # 多部分/多輪的站 id 會帶 "#slug" 後綴（如 "full-text-annotate#dcavv"）——
    # step_sequence 裡存的是帶 slug 的完整 id，但碎片/遭遇判定跟 reward_log
    # 的唯一鍵都用「去掉 slug 的 base id」，所以這裡兩邊都剝到 base 再比對。
    valid_stations_in_this_lesson = {
        raw_step_id.split("#", 1)[0] for raw_step_id in (lesson.get("step_sequence") or [])
    }

    rewards: list[dict] = []

    def _try_award(step_id: str) -> None:
        station = step_id.split("#", 1)[0]
        if station not in valid_stations_in_this_lesson:
            return  # 不是這一課真的有的站——跳過，不呼叫判定、不留任何紀錄
        # 發放前先查一次這格有沒有舊 log——這是「這次真的新發放」跟「只是
        # 重跑一次已經發過的冪等檢查」唯一的分界，見本函式 docstring。
        if reward_log_exists(db, student_id=student_id, lesson_uid=lesson_uid, station=station):
            return
        try:
            with db.begin_nested():
                log = award_station_rewards(db, student_id=student_id, lesson_uid=lesson_uid, station=station)
        except Exception:
            logger.exception(
                "word-baby reward award failed for station %s (lesson %s, user %d) — "
                "skipped, other stations in this save are unaffected, step-progress + XP unaffected",
                station, lesson_uid, student_id,
            )
            return
        if log is None:
            return  # 無效 station（長度超限或不在 15 站對照表）——沒有東西要呈現
        rewards.append({
            "id": log.id,
            "station": station,
            "fragment_awarded": log.fragment_awarded,
            "fragment_flavor": log.fragment_flavor,
            "encounter_result": log.encounter_result,
            "encounter_baby_id": log.encounter_baby_id,
        })

    # lesson-intro：每次儲存都嘗試判定一次，冪等保證不會重複發放（但上面的
    # reward_log_exists pre-check 保證只有「真的新發放」那一次會進 rewards）。
    _try_award("lesson-intro")

    already = set(previously_completed)
    newly_completed = [
        step_id for step_id in newly_reported
        if step_id not in already and step_id not in _WORD_BABY_EXCLUDED_STEP_IDS
    ]
    for step_id in newly_completed:
        _try_award(step_id)

    return rewards


def _resolve_lesson(session: "LearningSession") -> dict | None:
    """session.story_slug_derived（如 "6"）→ 內容樹的完整 lesson dict（含
    "lesson_uid" 跟 "step_sequence"）。

    這是兩個不同的編號系統（#3780 探路時發現）：`story_slug` 是這個平台
    session/路由用的編號，`lesson_uid` 是 `backend/data/lessons/` 內容樹的
    課程 id，文字寶貝的設定檔（`app/data/word_babies/*.json`）全部用後者。
    回傳完整 dict（不只 lesson_uid 字串）是因為呼叫端還需要 `step_sequence`
    來驗證站是不是真的屬於這一課（security review finding，2026-10-27）。
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
    word_baby_rewards = _load_word_baby_rewards_for_lesson(db, student_id=current_user.id, session=session)
    return StepProgressResponse(
        session_id=session.id,
        step_progress=session.step_progress,
        word_baby_rewards=word_baby_rewards,
    )


def _load_word_baby_rewards_for_lesson(
    db: Session, *, student_id: int, session: "LearningSession"
) -> list[dict]:
    """讀出這個學生、這一課**目前已經存在**的全部文字寶貝獎勵紀錄
    （Issue #3780 接島上二次修正，team-lead 2026-10-28）。

    這不是 `_award_word_baby_rewards` 的重複——那支是 PUT handler 專用的
    「判定 + 發放」，這支純粹是 SELECT，不碰 `award_station_rewards`，沒有
    冪等或 SAVEPOINT 的顧慮。

    **為什麼回傳「這一課全部」而不是「這次 save 新增的」**：原本的設計讓島
    靠 PUT 回應裡的 word_baby_rewards（透過 postMessage 推給島）顯示提示，
    但 ISLAND_STEP_DONE 會同步拆掉裝著學習頁的 iframe，而那個 PUT 的回應
    常常還沒回來——真實網路延遲下提示幾乎不會顯示。改成回島後由島自己向
    這個 GET 端點「拉」，不依賴任何訊息時序；GET 本來就會在回島時被
    `refreshProgress()` 呼叫。範圍限定在「這一課全部」而不是「這次新增」
    是刻意的：後者需要在這裡重新定義「這次」是什麼（用時間戳記？用
    session_id？），而前端已經用 reward id 配 sessionStorage 排重解決了
    「顯示過了沒」，範圍窄在這裡反而是多餘的複雜度。
    """
    lesson = _resolve_lesson(session)
    if lesson is None:
        return []
    lesson_uid = lesson.get("lesson_uid")
    if lesson_uid is None:
        return []
    from ...models.word_baby import StudentStationRewardLog

    rows = (
        db.query(StudentStationRewardLog)
        .filter_by(student_id=student_id, lesson_uid=lesson_uid)
        .all()
    )
    return [
        {
            "id": row.id,
            "station": row.station,
            "fragment_awarded": row.fragment_awarded,
            "fragment_flavor": row.fragment_flavor,
            "encounter_result": row.encounter_result,
            "encounter_baby_id": row.encounter_baby_id,
        }
        for row in rows
    ]
