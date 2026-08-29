"""帳本說有的，那一輪就要有資料（#2930）。

覆蓋邏輯只覆蓋「這一輪真的有的模組」——缺的那一格會靜默退回頂層，
也就是第 1 篇。畫面正常、型別正確、沒有錯誤，只是內容是別篇。

所以要對帳：帳本裡屬於第 N 篇的每一節，`repeat_rounds[第N篇]` 就要有
那個模組的資料。
"""
import pytest
from app.services.lesson_loader import get_lesson_by_id

MULTI = [20029, 20063, 20111, 20137, 20144]
# 課文那一節本身不需要另外的模組資料（它就是 paragraphs）
SELF = {"full_text_annotate"}
# 帳本有、線上還沒做的大題（已具名登記，不是漏掉）
NOT_BUILT = {"integrated_practice"}


def _article_of(lesson, sec):
    ref = sec.get("text_ref")
    if isinstance(ref, str) and ref:
        return ref
    if isinstance(ref, list):
        return None  # 跨篇的節，維持頂層
    return sec["slug"] if sec.get("module") in SELF else None


def reconcile(lesson: dict):
    """回 (缺口清單, 對到的節數, 跨篇的節數)。抽成函式才驗得到它會不會抓。"""
    rounds = lesson.get("repeat_rounds") or {}
    gaps = []
    checked = 0
    cross = 0   # 跨篇的節（`text_ref` 是清單）→ 本來就該維持頂層
    for sec in lesson.get("manifest_sections") or []:
        mod = sec.get("module")
        if not mod or mod in SELF or mod in NOT_BUILT:
            continue
        if isinstance(sec.get("text_ref"), list):
            cross += 1
            continue
        article = _article_of(lesson, sec)
        if article is None or article not in rounds:
            continue
        checked += 1
        if not (rounds[article] or {}).get(mod):
            gaps.append(f"{sec.get('no')} {sec.get('name')}（{mod}）→{article}")
    # 正向對照：兩者都是 0 = 對帳邏輯壞了，不是資料乾淨。
    # 有些課（如 L0137）只有課文分兩篇，其餘大題全是跨篇的「綜合」——
    # 那些維持頂層是刻意的，不算缺資料。
    return gaps, checked, cross


@pytest.mark.parametrize("lesson_id", MULTI)
def test_every_ledger_section_has_data_in_its_round(lesson_id):
    lesson = get_lesson_by_id(lesson_id)
    assert lesson is not None, f"找不到 {lesson_id}"
    assert lesson.get("repeat_rounds"), f"{lesson_id} 沒有 repeat_rounds —— 它不是多篇課？"
    gaps, checked, cross = reconcile(lesson)
    # 正向對照：兩者都是 0 = 對帳邏輯壞了，不是資料乾淨。
    # 有些課（如 L0137）只有課文分兩篇，其餘大題全是跨篇的「綜合」——
    # 那些維持頂層是刻意的，不算缺資料。
    assert checked + cross > 0, (
        f"{lesson_id} 一節都沒對到也沒有跨篇節 —— 對帳邏輯壞了，不是資料乾淨"
    )
    assert not gaps, (
        f"{lesson_id}：{len(gaps)}/{checked} 節在自己那一輪沒有資料，"
        f"會顯示第 1 篇：\n  " + "\n  ".join(gaps[:8])
    )


def test_the_reconcile_actually_catches_a_gap():
    """注入一個缺口，對帳必須抓到 —— 否則上面五個綠什麼都不證明。"""
    fake = {
        "repeat_rounds": {"aaaaa": {"paragraphs": ["篇一"]}, "bbbbb": {"paragraphs": ["篇二"], "keypoints": {"x": 1}}},
        "manifest_sections": [
            {"no": "一", "name": "讀全文-做記號", "module": "full_text_annotate", "slug": "aaaaa"},
            {"no": "一", "name": "讀全文-做記號", "module": "full_text_annotate", "slug": "bbbbb"},
            {"no": "二", "name": "文章重點整理", "module": "keypoints", "slug": "c1", "text_ref": "aaaaa"},
            {"no": "二", "name": "文章重點整理", "module": "keypoints", "slug": "c2", "text_ref": "bbbbb"},
        ],
    }
    gaps, checked, cross = reconcile(fake)
    assert checked == 2 and cross == 0, f"對到 {checked} 節、跨篇 {cross}"
    assert len(gaps) == 1 and "aaaaa" in gaps[0], f"該抓到第 1 篇缺重點表，實際：{gaps}"
