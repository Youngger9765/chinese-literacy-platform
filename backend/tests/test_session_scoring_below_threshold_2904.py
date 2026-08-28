"""閱讀理解沒達標的學生，也該拿到分數（#2904）。

## 現況（2026-08-28 對 prod 量到的）

561 課完成，只有 9 筆有 `overall_score`。

根因不在寫入路徑 —— `test_session_scoring_write_1063.py` 是綠的，
它先用 SQL 把三個欄位塞好再呼叫，證明「有輸入時寫得進去」。
問題在**輸入**：

    gamification_service.py
        elif comprehension_passed:
            scores.append(80.0)      # ← 只有 True 才加分

`comprehension_passed` 是個 bool。前端在 ReportPage.tsx:81 算出了真正的百分比，
第 89 行卻把它壓成 `pct >= 60` 一個布林 —— **60 分以下的學生不是拿低分，
是整段 `if scores` 不成立，完全沒有分數**。不報錯、不寫、沒有痕跡。

## 修法

前端把實際百分比一起送上來（`comprehension_score`），後端有值就用它。
`comprehension_passed` 保留給舊 client，行為不變。

⛔ 後端不自己從 bool 猜分數 —— 那等於編一個數字出來。
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
import app.models  # noqa: F401


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _seed(db, *, session_id=1, student_id=1):
    """用 ORM 建，不手寫 INSERT —— 手寫的話每加一個 NOT NULL 欄位就要跟著改，
    而且會一欄一欄撞 IntegrityError（我就撞了三次）。"""
    from app.models.user import User
    from app.models.session import LearningSession
    db.add(User(id=student_id, email=f"s{student_id}@t.com", password_hash="x",
                name="S", is_active=True))
    db.flush()
    db.add(LearningSession(id=session_id, student_id=student_id))
    db.commit()


def _score(db, session_id=1):
    row = db.execute(text("SELECT overall_score FROM learning_sessions WHERE id=:i"),
                     {"i": session_id}).fetchone()
    return row[0] if row else None


def test_below_threshold_still_gets_a_score(db_session):
    """⭐ 這張票的核心：38% 的學生該拿到 38 分，不是沒有分數。"""
    from app.services.gamification_service import process_session_completion
    _seed(db_session)
    process_session_completion(
        db_session, student_id=1, session_id=1,
        comprehension_score=38.0, comprehension_passed=False)
    got = _score(db_session)
    assert got is not None, (
        "閱讀理解 38% 的學生沒有拿到任何分數 —— "
        "`elif comprehension_passed:` 讓 False 什麼都不加，於是 scores 是空的、整段跳過")
    assert got == pytest.approx(38.0, abs=0.05), f"預期 38 分，實得 {got}"


def test_passing_score_is_the_real_number_not_a_flat_80(db_session):
    """達標的也要用真實分數，不是一律 80。

    原本 `elif comprehension_passed: scores.append(80.0)` 對 95 分和 61 分
    都給 80 —— 那是編出來的數字。
    """
    from app.services.gamification_service import process_session_completion
    _seed(db_session)
    process_session_completion(
        db_session, student_id=1, session_id=1,
        comprehension_score=95.0, comprehension_passed=True)
    assert _score(db_session) == pytest.approx(95.0, abs=0.05)


def test_old_clients_still_work(db_session):
    """沒送 comprehension_score 的舊 client，行為完全不變（仍是 80）。

    少了這條，修法就變成「順便把舊行為也改掉」，而線上還有跑舊 build 的頁面。
    """
    from app.services.gamification_service import process_session_completion
    _seed(db_session)
    process_session_completion(
        db_session, student_id=1, session_id=1, comprehension_passed=True)
    assert _score(db_session) == pytest.approx(80.0, abs=0.05)


def test_nothing_at_all_still_writes_nothing(db_session):
    """負向對照：三個來源都沒有時，不該憑空生一個分數出來。

    沒有這條，上面三條可以靠「一律給預設分」通過 —— 那是另一種錯。
    """
    from app.services.gamification_service import process_session_completion
    _seed(db_session)
    process_session_completion(db_session, student_id=1, session_id=1)
    assert _score(db_session) is None


def test_finishing_is_recorded_even_without_a_score(db_session):
    """⭐ 完成是事實，分數是量測 —— 兩件事不可以綁在一起。

    原本 `learning_session.status = "completed"` 那三行縮在
    `if scores and weights:` 裡面，於是三個來源都空的 session 連「完成」
    都不會被記錄。接著 get_completed_story_count() 回 0，
    first_session / first_story 徽章就永遠發不出來。

    ⛔ 這條跟上面那條「三個來源皆空時不准憑空生分數」不衝突：
       分數仍然是 None，但 status 要變成 completed。
    """
    from app.services.gamification_service import process_session_completion
    _seed(db_session)
    process_session_completion(db_session, student_id=1, session_id=1)

    from sqlalchemy import text as _t
    row = db_session.execute(
        _t("SELECT status, overall_score FROM learning_sessions WHERE id=1")).fetchone()
    assert row[0] == "completed", (
        f"沒有分數的 session 沒有被標成 completed（實得 {row[0]}）—— "
        "標記完成被關在 `if scores` 裡面了")
    assert row[1] is None, "分數仍然應該是 None —— 不可以為了標完成就編一個分數"

