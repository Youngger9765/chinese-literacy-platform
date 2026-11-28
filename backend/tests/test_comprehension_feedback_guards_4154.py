"""#4154 審查補強：沒登入不送說明、壞資料不炸、依據句不洩漏正解。

來源：code-reviewer 對抗式審查，三個擋合併的發現各一條鎖。
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import lesson_indexes as li  # noqa: E402
from tests.test_live_quiz_engine import auth_header, client, setup_db, student1  # noqa: F401, E402

FB_KEYS = ("option_explanations", "evidence_sentence", "evidence_paragraph")


# ── 1. 沒登入不能拿到說明（正解那句以「正確」開頭，等於洩漏答案）────────────────
def test_anonymous_detail_has_no_feedback_fields(client):
    r = client.get("/api/stories/20011")  # 20011 = 有說明資料的那課
    assert r.status_code == 200
    mcqs = r.json().get("multiple_choice") or []
    assert mcqs
    leaked = [(i, k) for i, q in enumerate(mcqs) for k in FB_KEYS if q.get(k)]
    assert not leaked, f"沒登入不該有：{leaked}"


def test_logged_in_student_gets_feedback_fields(client, student1):
    """正向對照：登入的學生要拿得到，否則上一條空過。"""
    r = client.get("/api/stories/20011", headers=auth_header(student1["token"]))
    mcqs = r.json().get("multiple_choice") or []
    assert mcqs and all(q.get("option_explanations") for q in mcqs)


# ── 2. 資料層：依據句不能把正解的詞標出來 ────────────────────────────────────
@pytest.mark.parametrize("uid", ["L0011", "L0010", "L0016"])
def test_evidence_sentence_does_not_contain_the_correct_options_quoted_term(uid):
    import re

    detail = next(l for l in li.build_all_lessons() if l.get("lesson_uid") == uid)
    for q in detail["multiple_choice"]:
        ev = q.get("evidence_sentence")
        if not ev:
            continue
        correct = q["options"][ord(q["answer"]) - ord("A")]
        # 選項裡用「」括起來的詞（例：「勸誡」）就是這題在問的東西
        for term in re.findall(r"「([^」]+)」", correct):
            assert term not in ev, f"{uid}：依據句含正解詞「{term}」，答錯時標黃等於公布答案"


# ── 3. 載入器對壞資料的反應：整組略過，不拋例外 ─────────────────────────────
def test_option_explanations_rejects_count_mismatch_and_blank():
    assert li._option_explanations({"option_explanations": ["a", "b", "c"]}, 4) is None
    assert li._option_explanations({"option_explanations": ["a", "", "c", "d"]}, 4) is None
    assert li._option_explanations({"option_explanations": ["a", 1, "c", "d"]}, 4) is None
    assert li._option_explanations({"option_explanations": "abcd"}, 4) is None
    assert li._option_explanations({}, 4) is None
    assert li._option_explanations({"option_explanations": ["a", "b", "c", "d"]}, 4) == ["a", "b", "c", "d"]


def test_option_explanations_returns_a_copy():
    src = {"option_explanations": ["a", "b"]}
    out = li._option_explanations(src, 2)
    out.append("x")
    assert src["option_explanations"] == ["a", "b"], "快取的清單不能被下游改到"


def test_evidence_for_requires_sentence_inside_a_paragraph():
    l = {"full_text_annotate": {"paragraphs": [{"idx": 1, "text": "第一句。第二句。"}]}}
    assert li._evidence_for(l, "第二句") == {"evidence_sentence": "第二句", "evidence_paragraph": "第一句。第二句。"}
    none = {"evidence_sentence": None, "evidence_paragraph": None}
    assert li._evidence_for(l, "不在課文裡") == none
    assert li._evidence_for(l, None) == none
    assert li._evidence_for(l, 123) == none, "依據句不是字串也不能炸"


def test_feedback_not_applied_to_repeat_rounds():
    l = {"lesson_uid": "L0011"}
    out = li._feedback_fields(l, {"index": 1}, 4, use_feedback=False)
    assert out == {"option_explanations": None, "evidence_sentence": None, "evidence_paragraph": None}


@pytest.mark.parametrize("bad", ["- just\n- a list\n", "questions: not-a-dict\n", "questions:\n  1: oops\n", ": : :\n  [", "questions:\n  1:\n    evidence_sentence: 5\n    option_explanations: x\n"])
def test_bad_feedback_file_never_raises(tmp_path, monkeypatch, bad):
    d = tmp_path / "comprehension_feedback"
    d.mkdir()
    (d / "L9999.yml").write_text(bad, encoding="utf-8")
    monkeypatch.setattr(li, "FEEDBACK_DIR", d)
    li._feedback_file.cache_clear()
    try:
        out = li._feedback_fields({"lesson_uid": "L9999", "full_text_annotate": {"paragraphs": []}}, {"index": 1}, 4, use_feedback=True)
    finally:
        li._feedback_file.cache_clear()
    assert out["option_explanations"] is None
    assert out["evidence_sentence"] is None


# ── 4. 多文本輪次（section 不為 None）不套用回饋：題號會在每一輪重複 ─────────────
def _synthetic_lesson():
    q = {"index": 1, "answer": "C", "stem": "請問「勢均力敵」可以用哪個詞語替換？",
         "options": {"A": "天差地遠", "B": "揚眉吐氣", "C": "不分上下", "D": "寡不敵眾"}}
    fta = {"paragraphs": [{"idx": 1, "text": "這場小戴與陳雨菲的龍爭虎鬥，戰況勢均力敵，全臺觀眾守在電視前。"}]}
    return {"lesson_uid": "L0011", "comprehension": {"questions": [q]}, "full_text_annotate": fta}, q


def test_main_text_gets_feedback_but_repeat_round_section_does_not():
    l, q = _synthetic_lesson()
    main = li._mcq_from(l)
    assert main and main[0]["option_explanations"], "主文有題號 1 的資料，要送"
    rnd = li._mcq_from(l, section={"questions": [q]})
    assert rnd and rnd[0]["option_explanations"] is None
    assert rnd[0]["evidence_sentence"] is None and rnd[0]["evidence_paragraph"] is None


# ── 4. 注音端點是公開的：它回傳每段原文，說明檔不可以從那裡漏出去 ────────────────
# 資安掃描發現（2026-11-27）：產生器遞迴收服務端整份 dict，option_explanations
# 被收進注音表；而該端點不需登入、回傳 text，正解那句以「正確」開頭 = 公布答案。
@pytest.mark.parametrize("lesson_id,uid", [(20011, "L0011"), (20010, "L0010"), (20016, "L0016")])
def test_anonymous_zhuyin_endpoint_has_no_answer_bearing_text(client, lesson_id, uid):
    r = client.get(f"/api/lessons/{uid}/zhuyin")
    assert r.status_code == 200, r.text
    texts = r.json()["texts"]
    assert len(texts) > 50, "對照：端點要真的有回內容，否則下面兩條空過"
    bad = [t["section"] for t in texts if "option_explanations" in t["section"]]
    assert not bad, f"{uid} 注音端點漏出說明：{bad[:3]}"
    assert not [t for t in texts if t["text"].startswith("正確")], f"{uid} 有以「正確」開頭的字串"


def test_zhuyin_collector_skips_option_explanations():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "gen_zhuyin", os.path.join(os.path.dirname(__file__), "..", "scripts", "generate_lesson_zhuyin.py"))
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    sections = [t["section"] for t in gen.collect_served_texts("L0011")]
    assert sections, "對照：收集器要真的收到東西"
    assert not [s for s in sections if "option_explanations" in s]
