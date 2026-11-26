"""Regression lock: 領 XP 不可以順便把自學 session 標成「已完成」。

背景：學習紀錄頁把清單裡每一筆都顯示成「已完成」，清單本身用 status=completed 過濾。
POST /api/gamification/session-complete 以前一律把 session 標成 completed，
所以自主練習只做一關、打開報告頁領了 XP，學習紀錄就出現「已完成 11/11」，
而報告卡片只有 1/10。

規格：前端送 lesson_finished
  - False：領 XP 照發，但 status 不變
  - True ：標成 completed（就算 XP 之前已結算過）
  - 沒送（舊 client）：維持舊行為，標成 completed
"""
from __future__ import annotations

import pytest

from tests.test_gamification import _make_session, _make_user, db_session  # noqa: F401


def _status(db, session_id: int) -> str:
    from sqlalchemy import text

    return db.execute(
        text("SELECT status FROM learning_sessions WHERE id = :i"), {"i": session_id}
    ).scalar_one()


def _setup(db):
    _make_user(db, 1)
    _make_session(db, 1, 1, status="in_progress")


def test_xp_without_finishing_keeps_session_in_progress(db_session):
    from app.services.gamification_service import process_session_completion

    _setup(db_session)
    result = process_session_completion(
        db_session, student_id=1, session_id=1, lesson_finished=False
    )
    assert result["xp_earned"] > 0  # XP 仍然照發
    assert _status(db_session, 1) == "in_progress"


def test_finishing_marks_completed(db_session):
    from app.services.gamification_service import process_session_completion

    _setup(db_session)
    process_session_completion(db_session, student_id=1, session_id=1, lesson_finished=True)
    assert _status(db_session, 1) == "completed"


def test_old_client_without_flag_still_marks_completed(db_session):
    from app.services.gamification_service import process_session_completion

    _setup(db_session)
    process_session_completion(db_session, student_id=1, session_id=1)
    assert _status(db_session, 1) == "completed"


def test_finishing_after_xp_already_settled_still_marks_completed(db_session):
    """先看報告領了 XP（沒做完），之後做完再開報告：XP 結算會走『已處理』的提早返回，
    完成狀態不可以因此被跳過。"""
    from app.services.gamification_service import process_session_completion

    _setup(db_session)
    process_session_completion(db_session, student_id=1, session_id=1, lesson_finished=False)
    assert _status(db_session, 1) == "in_progress"
    again = process_session_completion(
        db_session, student_id=1, session_id=1, lesson_finished=True
    )
    assert _status(db_session, 1) == "completed"
    assert "已處理" in "".join(again["notes"])  # XP 沒有重複發


def test_not_finished_never_downgrades_a_completed_session(db_session):
    from app.services.gamification_service import process_session_completion

    _make_user(db_session, 1)
    _make_session(db_session, 1, 1, status="completed")
    process_session_completion(db_session, student_id=1, session_id=1, lesson_finished=False)
    assert _status(db_session, 1) == "completed"


def test_late_finish_awards_first_session_badge(db_session):
    """沒做完時領 XP（status 不變，first_session 徽章還發不出來）；
    之後做完，提早返回路徑也要把徽章補發。"""
    from app.services.gamification_service import process_session_completion

    _setup(db_session)
    first = process_session_completion(
        db_session, student_id=1, session_id=1, lesson_finished=False
    )
    assert "first_session" not in [b if isinstance(b, str) else b.get("key") for b in first["badges_unlocked"]]
    late = process_session_completion(
        db_session, student_id=1, session_id=1, lesson_finished=True
    )
    keys = [b if isinstance(b, str) else b.get("key") for b in late["badges_unlocked"]]
    assert "first_session" in keys, keys


def test_late_finish_recomputes_overall_score(db_session):
    """沒做完時領 XP，總分用當時的進度算（沒有資料＝沒有分數）；之後做完，
    提早返回路徑要重算，否則 overall_score 會停在只做一關時的值。"""
    from sqlalchemy import text

    from app.services.gamification_service import process_session_completion

    _setup(db_session)
    process_session_completion(db_session, student_id=1, session_id=1, lesson_finished=False)
    score = lambda: db_session.execute(  # noqa: E731
        text("SELECT overall_score FROM learning_sessions WHERE id = 1")
    ).scalar_one()
    assert score() is None

    # 之後學生真的做了朗讀（DB 上有了正確率）
    db_session.execute(text("UPDATE learning_sessions SET accuracy = 80 WHERE id = 1"))
    db_session.commit()
    process_session_completion(db_session, student_id=1, session_id=1, lesson_finished=True)
    assert score() == 80.0
