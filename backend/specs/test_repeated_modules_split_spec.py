"""重複模組必須在**前後台都**明確切分（#2916）。

一份學習單印了好幾篇課文時，念順順／語詞／重點表這些大題會各印一次。
線上如果只給一份，學生做完第 1 篇就沒有第 2、3 篇了 ——
而畫面上完全看不出來：有內容、走得完、不報錯，只是少了兩篇。

這份鎖住**具名的五課**，不是「至少有幾課」：
- 數字會漂移，而漂移時「少了一課」跟「門檻訂太鬆」分不出來
- 教材增減時這條會紅，那正是要人來看一眼的時候

⚠️ 前台那一半在 `frontend/src/config/__tests__/repeatedModulesSplit.test.ts`。
   兩邊要一起看：後端拆了而前端沒接，症狀跟兩邊都沒拆一模一樣。
"""
from __future__ import annotations

import collections

import pytest

from app.services.lesson_indexes import build_all_lessons

#: 2026-08-25 全庫實測。{uid: (課碼, {模組: 份數}, 總步驟數)}
#: ⛔ 改這裡之前先確認是**教材真的變了**，不是抽取或拆分壞了。
EXPECTED = {
    "L0029": ("G5-L17", {"full_text_annotate": 2, "key_reading": 2, "vocab_definitions": 2,
                         "vocab_application": 2, "keypoints": 2, "comprehension": 3}, 18),
    "L0063": ("G6-L22", {"full_text_annotate": 3, "key_reading": 3, "vocab_definitions": 3,
                         "vocab_application": 3, "keypoints": 3}, 21),
    "L0111": ("G8-L13", {"full_text_annotate": 2, "spotlight": 2}, 8),
    "L0137": ("G9-L16", {"full_text_annotate": 2}, 10),
    "L0144": ("G9-L23", {"full_text_annotate": 3, "vocab_definitions": 3,
                         "keypoints": 3, "comprehension": 3}, 17),
}

MODULE_TO_STEP = {
    "full_text_annotate": "full-text-annotate", "key_reading": "key-passage-reading",
    "vocab_definitions": "vocab-definition", "vocab_application": "vocab-application",
    "keypoints": "keypoints-table", "comprehension": "comprehension",
    "spotlight": "spotlight", "vocab_review": "vocab-review", "resources": "knowledge-station",
}


@pytest.fixture(scope="module")
def rows():
    return {r.get("lesson_uid"): r for r in build_all_lessons()}


def test_the_five_lessons_are_still_the_five(rows):
    """有重複模組的課就是這五課 —— 多一課少一課都要有人看一眼。"""
    found = {}
    for uid, r in rows.items():
        c = collections.Counter(s.get("module") for s in (r.get("manifest_sections") or [])
                                if s.get("module"))
        dup = {m: n for m, n in c.items() if n > 1}
        if dup:
            found[uid] = dup
    assert len(rows) > 150, f"只載到 {len(rows)} 課 —— 這條測不到東西"
    assert set(found) == set(EXPECTED), (
        f"有重複模組的課變了。\n  多出來: {sorted(set(found) - set(EXPECTED))}"
        f"\n  不見了: {sorted(set(EXPECTED) - set(found))}")


@pytest.mark.parametrize("uid", sorted(EXPECTED))
def test_each_repeated_module_becomes_its_own_step(rows, uid):
    """每一份重複模組都要在 `step_sequence` 佔一個位置，而且各帶各的代號。"""
    code, dup, total = EXPECTED[uid]
    r = rows[uid]
    seq = r.get("step_sequence") or []
    assert len(seq) == total, f"{code} 步驟數 {len(seq)} ≠ {total}"

    by_step = collections.Counter(k.split("#", 1)[0] for k in seq)
    for mod, n in dup.items():
        step = MODULE_TO_STEP[mod]
        assert by_step.get(step) == n, (
            f"{code} 的 {mod} 應該有 {n} 步，實得 {by_step.get(step, 0)}")

    # 每一步的代號互不相同 —— 共用代號的話兩步會指到同一份內容
    slugs = [k.split("#", 1)[1] for k in seq if "#" in k]
    assert len(slugs) == len(set(slugs)), f"{code} 有步驟共用代號: {slugs}"


@pytest.mark.parametrize("uid", sorted(EXPECTED))
def test_each_repeated_module_has_its_own_content(rows, uid):
    """拆了步驟還不夠 —— 每一輪要真的有**自己的**內容。

    只拆步驟不換內容的話，三個念順順會唸同一段：三個入口、一份內容，
    而且每一個都會動、都有字、都不報錯。
    """
    code, dup, _ = EXPECTED[uid]
    rounds = rows[uid].get("repeat_rounds") or {}
    if "full_text_annotate" not in dup:
        pytest.skip(f"{code} 沒有重複的讀全文")
    assert len(rounds) == dup["full_text_annotate"], (
        f"{code} 應該有 {dup['full_text_annotate']} 輪內容，實得 {len(rounds)}")
    paras = [tuple(m.get("paragraphs") or []) for m in rounds.values()]
    assert all(paras), f"{code} 有輪次沒有段落: {[len(p) for p in paras]}"
    assert len(set(paras)) == len(paras), f"{code} 有兩輪的課文一模一樣 —— 拆了步驟沒換內容"


@pytest.mark.parametrize("uid", sorted(EXPECTED))
def test_each_part_carries_its_own_qr_codes(rows, uid):
    """後台一篇一列，每一篇的碼互不相同（前台那半見 frontend 的同名測試）。"""
    code, dup, _ = EXPECTED[uid]
    parts = rows[uid].get("part_rounds") or []
    assert len(parts) == dup.get("full_text_annotate", 1), (
        f"{code} part_rounds {len(parts)} 筆，應該一篇一筆")
    codes = [c for p in parts for c in (p.get("full_slug"), p.get("key_slug")) if c]
    assert codes, f"{code} 一個代號都沒有"
    assert len(codes) == len(set(codes)), f"{code} 有代號重複: {codes}"
