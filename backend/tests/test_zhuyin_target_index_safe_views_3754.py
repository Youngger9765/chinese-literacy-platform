"""讀音題「目標字位置」要忠實傳到四個遊戲模式 (#3754).

## 根因

#3754 的實際 bug 不是注音抽題器算錯 `target_index`
（`live_quiz/sources/zhuyin.py` 的 `generate_items` 從來沒壞過），是迷城密室
自己重寫了一份跟 PK／團隊擂台／課堂搶答（live_quiz）各自獨立的「安全視圖」
欄位白名單（`escape_room/engine.py::_safe_question`），而這份白名單漏寫了
`extra` —— 於是學生在迷城密室看到的讀音題只剩一句話（例如「你覺得這明明就
是特權；」），不知道在問哪個字，只能瞎猜選項（ㄐㄧㄠˋ／ㄐㄩㄝˊ）。

## 這條鎖守什麼（Young 的「bug 要有整類掃描測試」規定）

- **Part A**：抽題器本身，對**全部真實課文**掃一遍，確認每一題讀音題的
  `target_index` 都落在 `stem` 範圍內 —— 這是四個遊戲共用的唯一出題來源
  （`live_quiz/sources/zhuyin.py`），PK／team_arena／live_quiz／escape_room
  的 `choice.generate_rounds` 全部呼叫它。
- **Part B**：四個遊戲各自的「安全視圖」函式，各餵一題真實讀音題，斷言
  `extra.target_index` 原封不動地被傳出去 —— 這才是 #3754 真正壞掉的那一層。
  四個遊戲各自維護自己的白名單／投影函式，所以要分別釘住每一個，不能只鎖
  共用的抽題器（它本身從來沒壞過）。未來任何一個遊戲的白名單再漏寫一次
  `extra`，這裡就會紅，不必等到學生回報才發現。
"""
from __future__ import annotations

import random

import pytest

from app.services.lesson_loader import get_all_lessons
from app.services.live_quiz.round_types import choice
from app.services.live_quiz.sources import zhuyin as zhuyin_source
from app.services.live_quiz.sources.base import QuizItem


@pytest.fixture()
def db_session():
    """只有 `TestEveryGameSafeViewKeepsTargetIndex.test_pk` 用得到 —— PK 的
    安全視圖是內嵌在 `build_match_state` 裡的邏輯，沒有獨立函式可以不經過
    DB 直接呼叫（同 `test_pk_engine.py` 的 fixture）。"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.models.base import Base
    import app.models  # noqa: F401

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


# ---------------------------------------------------------------------------
# Part A — 全課 × 共用抽題器
# ---------------------------------------------------------------------------

def test_zhuyin_target_index_valid_across_all_lessons():
    lessons = get_all_lessons()
    assert len(lessons) > 100, "課程目錄看起來被截斷了 —— 這不是真的全課掃描"

    checked_lessons = 0
    checked_items = 0
    for entry in lessons:
        uid = entry.get("lesson_uid")
        if not uid:
            continue
        items = zhuyin_source.generate_items(uid, entry, random.Random(0))
        if not items:
            continue
        checked_lessons += 1
        for item in items:
            checked_items += 1
            assert item.extra is not None, f"{uid}: 讀音題沒有 extra（{item.stem!r}）"
            target = item.extra.get("target_index")
            assert isinstance(target, int), f"{uid}: target_index 不是整數：{target!r}"
            assert 0 <= target < len(item.stem), (
                f"{uid}: target_index={target} 超出 stem 範圍 {item.stem!r}"
                f"（長度 {len(item.stem)}）"
            )

    # 空轉防呆：#3754 的教訓之一就是「比對的兩邊有一邊沒資料」會讓斷言恆真。
    assert checked_lessons > 50, f"只掃到 {checked_lessons} 課有讀音題 —— 懷疑抽題器本身壞了"
    assert checked_items > 1000, f"只掃到 {checked_items} 題讀音題 —— 懷疑抽題器本身壞了"


# ---------------------------------------------------------------------------
# Part B — 四個遊戲各自的安全視圖都要忠實轉傳 extra.target_index
# ---------------------------------------------------------------------------

def _sample_zhuyin_item() -> QuizItem:
    """固定種子、固定抽一題真實讀音題，給下面四個投影函式各自餵食。"""
    for entry in get_all_lessons():
        uid = entry.get("lesson_uid")
        if not uid:
            continue
        items = zhuyin_source.generate_items(uid, entry, random.Random(0))
        if items:
            return items[0]
    raise AssertionError("fixture 本身壞了 —— 連一課都沒有產生讀音題，Part A 應該也會紅")


class TestEveryGameSafeViewKeepsTargetIndex:
    def test_escape_room(self):
        """#3754 的實際根因所在 —— `_safe_question` 曾經漏寫 `extra`。"""
        from app.services.escape_room import engine as er_engine

        item = _sample_zhuyin_item()
        question = {"payload": item.to_payload(seconds=30)}
        safe = er_engine._safe_question(question, chamber_index=0)
        assert safe["extra"] == item.extra

    def test_live_quiz_classroom_quick_answer(self):
        """課堂搶答 —— `round_types.choice.player_view`。"""
        item = _sample_zhuyin_item()
        payload = item.to_payload(seconds=30)
        view = choice.player_view(payload, revealed=False)
        assert view["extra"] == item.extra

    def test_team_arena(self):
        """團體擂台 —— `team_arena.engine._public_round_view`。

        `db`/`viewer` 只在 `call_teammate_active=True` 時才被用到（收集隊友
        建議），這裡刻意不設該欄位以避免需要真的 DB session／成員物件。
        """
        from app.services.team_arena import engine as ta_engine

        item = _sample_zhuyin_item()
        round_state = {
            "payload": item.to_payload(seconds=30),
            "revealed": False,
            "turn_no": 1,
            "reading_seconds": 0,
            "answer_seconds": 30,
        }
        view = ta_engine._public_round_view(
            round_state, db=None, viewer=None, is_active=True, show_options=True,
        )
        assert view["extra"] == item.extra

    def test_pk(self, db_session):
        """PK —— `pk.engine.build_match_state`（安全視圖是內嵌邏輯，沒有獨立
        函式可直接呼叫，所以用一場真實 AI 對戰驗證端到端的輸出）。"""
        from app.services.pk import engine as pk_engine
        from league_factories import make_student

        student = make_student(db_session)
        match = pk_engine.create_ai_match(
            db_session, student, scope_type="lesson", scope_ref="L0125", bot_tier=1,
        )
        zhuyin_index = next(
            i for i, r in enumerate(match.rounds_snapshot)
            if r["payload"]["source_module"] == "zhuyin"
        )
        match.current_round_index = zhuyin_index
        db_session.commit()

        state = pk_engine.build_match_state(db_session, match, student)

        expected = match.rounds_snapshot[zhuyin_index]["payload"]["extra"]
        assert state["round"]["extra"] == expected
