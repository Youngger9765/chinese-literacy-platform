"""重複輪次要真的到得了學生面前（#2916）。

⚠️ 這一條擋的不是「抽得對不對」，是**抽對了卻沒人接**。
`{module}.{slug}.yml` 被 loader 讀進 `repeat_rounds` 之後，還要穿過
`StoryDetail` 這層 response_model 才會出現在 API 回應裡。Pydantic 預設把
沒宣告的欄位**靜默丟掉** —— 沒有例外、沒有紅燈，只是學生永遠看不到第二輪。

2026-08-19 已經踩過同一個形狀（options 是 dict / 欄名叫 videos 不叫 items /
sections_present 沒接）：來源 yml 全對，九道門全綠，學生看不到。
那批門檢查「抽對了沒」，沒有一道問「到得了學生面前嗎」。這一條就是問後者。
"""
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.schemas.story import StoryDetail  # noqa: E402
from app.services.lesson_uid_loader import load_all  # noqa: E402


def _lessons_with_rounds() -> dict:
    return {
        l["lesson_uid"]: l["repeat_rounds"]
        for l in load_all()
        if l.get("repeat_rounds")
    }


def test_the_scan_found_repeat_rounds_at_all():
    """正向對照 —— 少了這條，語料裡一份 slug 檔都沒有時下面每條都恆綠。"""
    rounds = _lessons_with_rounds()
    assert rounds, (
        "語料裡沒有任何 repeat_rounds。若這是預期的（還沒拆檔），"
        "刪掉這整支測試比讓它恆綠好 —— 恆綠的門會讓人以為有在守。"
    )


def test_response_model_declares_repeat_rounds():
    """StoryDetail 沒宣告 repeat_rounds → 回應層會靜默丟掉，學生看不到第二輪。"""
    assert "repeat_rounds" in StoryDetail.model_fields, (
        "StoryDetail 沒有 repeat_rounds 欄位。loader 讀得到，但 FastAPI 的 "
        "response_model 只留宣告過的欄位 —— 第二輪起的所有模組會靜默消失。"
    )


def test_repeat_rounds_survives_serialisation():
    """真的丟一份語料進去序列化，斷言它出得來（不是只看欄位有沒有宣告）。"""
    rounds = _lessons_with_rounds()
    uid, payload = sorted(rounds.items())[0]
    out = StoryDetail(
        id=1, title="t", grade_code="G6", paragraphs=["a"], repeat_rounds=payload
    ).model_dump()
    assert out.get("repeat_rounds"), f"{uid} 的 repeat_rounds 序列化後不見了"
    assert sorted(out["repeat_rounds"]) == sorted(payload), (
        f"{uid} 的輪次 slug 對不上：進去 {sorted(payload)}，出來 {sorted(out['repeat_rounds'])}"
    )


@pytest.mark.parametrize("uid", sorted(_lessons_with_rounds()))
def test_each_round_carries_real_content(uid):
    """每一輪都要有真內容 —— 空的 slug 檔比沒有更糟（看起來有第二輪，點進去是空的）。"""
    for slug, mods in sorted(_lessons_with_rounds()[uid].items()):
        assert mods, f"{uid} 的 {slug} 這一輪沒有任何模組"
        for name, body in sorted(mods.items()):
            assert body, f"{uid} 的 {slug}.{name} 是空的"
