"""朗讀的句子對照表要跟著篇次走（#2930）。

一課印好幾篇課文時，`GET /api/tts/mapping/{lesson_id}` 回的是**頂層**
（＝第 1 篇）的句子。前端拿 `lesson_id + 段落序號` 去對照，於是第 3 篇的
第 0 段被換成第 1 篇的第 0 段 —— 畫面是第 3 篇、聲音是第 1 篇。

沒有錯誤、沒有 404、音檔正常播出，只是唸錯篇。
"""
import pytest
from app.services.lesson_loader import get_lesson_by_id
from app.services.tts.lesson_mapping import build_lesson_tts_mapping

LESSON = 20063  # G6-L22：一份學習單三篇課文


def _rounds(lesson):
    return lesson.get("repeat_rounds") or {}


def test_lesson_has_three_rounds():
    """正向對照：這一課真的有三篇，否則下面兩條測不到東西。"""
    lesson = get_lesson_by_id(LESSON)
    assert lesson is not None, f"找不到 {LESSON}"
    assert len(_rounds(lesson)) == 3, f"預期三篇，實際 {list(_rounds(lesson))}"


def test_mapping_follows_the_round():
    """每一篇的對照表首句，要等於那一篇自己的首段開頭。"""
    lesson = get_lesson_by_id(LESSON)
    firsts = []
    for slug in _rounds(lesson):
        mapping = build_lesson_tts_mapping(lesson, round_slug=slug)
        paras = mapping.get("paragraphs") or []
        assert paras, f"{slug} 的對照表是空的"
        got = paras[0]["sentences"][0]["text"].strip()
        want = _rounds(lesson)[slug]["paragraphs"][0].strip()
        assert want.startswith(got[:8]), (
            f"{slug} 的對照表首句來自別篇：對照表={got[:20]!r} 該篇首段={want[:20]!r}"
        )
        firsts.append(got)
    assert len(set(firsts)) == 3, f"三篇的首句撞在一起：{[f[:12] for f in firsts]}"


def test_no_round_still_returns_top_level():
    """單篇課／不帶篇次時維持原行為，不可回空。"""
    lesson = get_lesson_by_id(LESSON)
    assert (build_lesson_tts_mapping(lesson).get("paragraphs") or []), "不帶篇次時不可回空"


def test_any_section_slug_resolves_to_its_article():
    """前端傳「這一節自己的代號」就好，不必自己換算成課文代號（#2930）。

    念順順那一節的代號（如 yprak）不是 `repeat_rounds` 的 key，
    它靠帳本的 `text_ref` 指向課文。解析放後端一處，
    比讓每個呼叫點各自記規則好 debug —— 漏一處就是靜默唸錯篇。
    """
    lesson = get_lesson_by_id(LESSON)
    rounds = _rounds(lesson)
    sections = lesson.get("manifest_sections") or []
    refs = [s for s in sections if isinstance(s.get("text_ref"), str) and s.get("text_ref")]
    # 正向對照：要涵蓋不只一篇，否則「解不開就退回第 1 篇」也會通過 ——
    # 取前幾個剛好都指向第 1 篇時，這條測試什麼都不證明。
    assert len({s["text_ref"] for s in refs}) >= 2, f"引用型的節只指向 {len(refs)} 篇，測不出差異"
    bad = []
    for sec in refs:
        mapping = build_lesson_tts_mapping(lesson, round_slug=sec["slug"])
        got = (mapping.get("paragraphs") or [{}])[0].get("sentences", [{}])[0].get("text", "")
        want = rounds[sec["text_ref"]]["paragraphs"][0].strip()
        if not (got and want.startswith(got[:8])):
            bad.append(f"{sec['slug']}（{sec.get('name')}）→{sec['text_ref']}: 得到 {got[:14]!r} 該是 {want[:14]!r}")
    assert not bad, f"{len(bad)}/{len(refs)} 個節解不開自己的課文：\n  " + "\n  ".join(bad[:6])


def test_each_round_carries_its_own_cloze_and_bank():
    """語詞應用也要跟著篇次走（#2930 續）。

    模組在帳本裡叫 `vocab_application`，送到前端的欄位卻叫 `fill_in_blank`
    ——名字對不上，覆蓋那一層就漏掉它，於是三篇的語詞應用長得一模一樣。
    後端三篇的題目本來就不同（題數 9/8/8），是這一步把它們抹平的。
    """
    import json as _json
    from app.services.lesson_indexes import _rounds_with_flat_paragraphs

    lesson = get_lesson_by_id(LESSON)
    rounds = _rounds_with_flat_paragraphs(lesson)
    assert len(rounds) == 3, f"預期三輪，實際 {list(rounds)}"  # 正向對照

    # 來源本來就不同 —— 若這裡就相同，那是資料問題不是這一步的問題
    src = {k: _json.dumps(v.get("vocab_application"), ensure_ascii=False, sort_keys=True)
           for k, v in rounds.items()}
    assert len(set(src.values())) == 3, "來源的三輪語詞應用就已經一樣了"

    got = {k: _json.dumps(v.get("fill_in_blank"), ensure_ascii=False, sort_keys=True)
           for k, v in rounds.items()}
    missing = [k for k, v in got.items() if v in ("null", "[]")]
    assert not missing, f"這幾輪沒有 fill_in_blank，前端會退回頂層（三篇共用）：{missing}"
    assert len(set(got.values())) == 3, f"三輪的語詞應用被抹成同一份：{[v[:40] for v in got.values()]}"
