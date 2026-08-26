"""閱讀理解：抽取器兩種容器名都要接得住（#2922）。

27 課的 `comprehension.*.yml` 把題目放在 **`items`**，另外 144 課放在
**`questions`**。兩邊的每一題結構一模一樣（`index` / `answer` / `stem` /
`options` 字典），只有外面那個 key 不同。

`_mcq_from` 只讀 `questions`，於是那 27 課的 `multiple_choice` 是空的 ——
**題目抽出來了，學生看不到**。沒有錯誤、頁面打得開、十道門全綠。
跟 #2683 那批（options 是 dict、欄名叫 videos 不叫 items）同一個病：
來源全對、東西到不了學生面前。

⛔ 這條不是「讓那 27 課變綠」——它問的是**帳本記著閱讀理解的每一課，
   服務端都要拿得到題目**。將來抽取器再發明第三個容器名，這條會紅。
"""
from __future__ import annotations

import pathlib

import pytest
import yaml

from app.services.lesson_indexes import build_all_lessons

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"


@pytest.fixture(scope="module")
def rows():
    return {r["lesson_uid"]: r for r in build_all_lessons()}


def test_both_container_names_exist_in_the_corpus():
    """先證明這條測的是真的存在的兩種形狀，不是我想像的。"""
    seen = {"questions": [], "items": []}
    for f in LESSONS.glob("L*/v3/comprehension.*.yml"):
        b = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("comprehension") or {}
        for k in seen:
            if b.get(k):
                seen[k].append(f.parts[-3])
    assert seen["questions"], "語料裡沒有 `questions` —— 這條測不到東西"
    assert seen["items"], "語料裡沒有 `items` —— 這條測不到東西"
    assert len(seen["items"]) >= 20, f"只有 {len(seen['items'])} 課用 items"


def test_every_lesson_whose_ledger_prints_comprehension_serves_questions(rows):
    """帳本印了閱讀理解的每一課，服務端都要拿得到題目。"""
    want = [uid for uid, r in rows.items()
            if any(s.get("module") == "comprehension" for s in (r.get("manifest_sections") or []))]
    assert len(want) > 150, f"只有 {len(want)} 課帳本印了閱讀理解 —— 這條測不到東西"
    empty = [uid for uid in want if not rows[uid].get("multiple_choice")]
    assert not empty, (
        f"{len(empty)} 課的閱讀理解在服務端是空的（學生看不到題目）: {empty[:8]}")


@pytest.mark.parametrize("uid", ["L0055", "L0076", "L0135", "L0167"])
def test_the_items_lessons_serve_the_same_shape_as_the_questions_ones(rows, uid):
    """`items` 那批送出來的形狀，要跟 `questions` 那批一模一樣。

    只是「不是空的」不夠 —— 形狀不同的話前端一樣渲染不出來。
    """
    mcq = rows[uid].get("multiple_choice") or []
    assert mcq, f"{uid} 沒有題目"
    ref = (rows["L0001"].get("multiple_choice") or [])[0]
    assert ref, "對照課 L0001 沒有題目 —— 這條測不到東西"
    for q in mcq:
        assert set(q) == set(ref), f"{uid} 的欄位跟對照不同: {sorted(set(q) ^ set(ref))}"
        assert isinstance(q["options"], list), f"{uid} options 不是清單"
        assert q["question"], f"{uid} 有題目沒有題幹"


def test_no_answer_letter_points_past_the_options(rows):
    """答案不可以指到不存在的選項 —— 那會讓學生怎麼選都是錯的。"""
    bad = []
    for uid, r in rows.items():
        for i, q in enumerate(r.get("multiple_choice") or []):
            a = q.get("answer")
            if a and (ord(a) - ord("A")) >= len(q.get("options") or []):
                bad.append((uid, i, a, len(q.get("options") or [])))
    total = sum(len(r.get("multiple_choice") or []) for r in rows.values())
    assert total > 500, f"只驗到 {total} 題 —— 這條測不到東西"
    assert not bad, f"答案指到不存在的選項: {bad[:6]}"
