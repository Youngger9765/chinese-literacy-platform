"""#4154 作答後回饋：每個選項一句說明 + 原文依據句。

先寫（紅）：資料與 API 都還沒有 option_explanations / evidence_sentence。
自動檢查三條（沒有人工審稿後台，所以全靠機器擋）：
  1. 說明數量等於選項數，每句非空
  2. 正解那句以「正確」開頭、錯誤選項那句不以「正確」開頭（說明跟答案鍵一致）
  3. 原文依據句必須逐字出現在該課課文裡
"""
from __future__ import annotations

import glob
from pathlib import Path

import pytest
import yaml

from app.services.lesson_indexes import build_all_lessons

ROOT = Path(__file__).resolve().parent.parent / "data" / "lessons"
SAMPLE_UIDS = ["L0011", "L0010", "L0016"]


def _detail(uid: str) -> dict:
    for l in build_all_lessons():
        if l.get("lesson_uid") == uid:
            return l
    raise AssertionError(f"{uid} not found")


def _full_text(uid: str) -> str:
    path = glob.glob(str(ROOT / uid / "v3" / "full_text_annotate.*.yml"))[0]
    body = yaml.safe_load(open(path, encoding="utf-8"))["full_text_annotate"]
    return "".join(p["text"] for p in body["paragraphs"])


@pytest.mark.parametrize("uid", SAMPLE_UIDS)
def test_every_question_has_one_explanation_per_option(uid):
    mcq = _detail(uid).get("multiple_choice") or []
    assert len(mcq) == 5
    for q in mcq:
        exps = q.get("option_explanations")
        assert isinstance(exps, list), f"{uid} 缺 option_explanations"
        assert len(exps) == len(q["options"])
        assert all(isinstance(e, str) and e.strip() for e in exps)


@pytest.mark.parametrize("uid", SAMPLE_UIDS)
def test_explanation_matches_answer_key(uid):
    for q in _detail(uid)["multiple_choice"]:
        ans_idx = ord(q["answer"]) - ord("A")
        for i, e in enumerate(q["option_explanations"]):
            if i == ans_idx:
                assert e.startswith("正確"), f"{uid} 正解說明要以「正確」開頭：{e}"
            else:
                assert not e.startswith("正確"), f"{uid} 錯誤選項說明不能說正確：{e}"


@pytest.mark.parametrize("uid", SAMPLE_UIDS)
def test_evidence_sentence_is_verbatim_in_lesson_text(uid):
    text = _full_text(uid)
    hit = 0
    for q in _detail(uid)["multiple_choice"]:
        ev = q.get("evidence_sentence")
        if ev is None:
            continue  # 詞語題之類沒有課文依據，允許為空
        hit += 1
        assert ev in text, f"{uid} 依據句不在課文：{ev}"
    assert hit >= 3, f"{uid} 至少 3 題要有依據句（命中 {hit}）"


@pytest.mark.parametrize("uid", SAMPLE_UIDS)
def test_api_ships_the_paragraph_that_contains_the_evidence(uid):
    """前端要靠這整段來畫螢光：有依據句就一定要有包含它的整段。"""
    hit = 0
    for q in _detail(uid)["multiple_choice"]:
        ev, para = q.get("evidence_sentence"), q.get("evidence_paragraph")
        assert (ev is None) == (para is None), f"{uid} 句與段要一起有或一起沒有"
        if ev:
            hit += 1
            assert ev in para
    assert hit >= 3
