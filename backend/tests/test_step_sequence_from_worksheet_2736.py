"""「下一關」跳過文章重點表。

Young 2026-08-19 在 `/learn/20001/spotlight` 按下一關 → 直接到閱讀理解，
略過中間的文章重點表。

> 下一關按鈕為什麼不是按照側欄順序？？？？

因為那是兩個來源：

    側欄        照學習單的章節順序畫
    下一關      查 `STEP_FINISH_TRANSITIONS` 這張靜態表

而學習單自己就寫著順序 —— `lesson.yml` 的 `sections_present`：

    五 文章重點表 → 六 閱讀聚光燈 → 七 閱讀理解

靜態表寫的是 `keypoints-table → spotlight → comprehension`，順序其實一樣，
但**每一課的學習單可以不一樣**，靜態表一視同仁。而且服務端只給文言文課
`step_sequence`（`CLASSICAL_STEP_SEQUENCE`），一般課一律 `None` ⇒ 前端
`lessonAwareNextStep` 拿不到序列，只能退回靜態表。

抽取抽出了 `sections_present`，沒有人把它接成 `step_sequence` ——
今天反覆出現的同一個形狀。
"""
from __future__ import annotations

import pathlib
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.lesson_loader import search_lessons  # noqa: E402

LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data" / "lessons"


def test_lessons_declare_the_order_their_worksheet_prints():
    """每一課都要把自己的章節順序送出去，前端才不用去猜。"""
    lessons = search_lessons()
    assert len(lessons) >= 150, f"只讀到 {len(lessons)} 課 —— 這條在測空氣"
    # L0124 的 `sections_present` 是空的、L0136 只有「會考圖文題實戰」——
    # 對照表涵蓋不到，給不出順序時就該是 None，前端退回預設。
    # 硬湊一份出來等於把猜測當成那一課的流程。
    ALLOWED_WITHOUT = {"L0124", "L0136"}
    missing = [l.get("lesson_uid") for l in lessons
               if not l.get("step_sequence") and l.get("lesson_uid") not in ALLOWED_WITHOUT]
    assert not missing, (
        f"{len(missing)} 課沒有 step_sequence，「下一關」只能查靜態表："
        f"{missing[:10]}"
    )


def test_the_sequence_matches_the_worksheet_sections():
    """送出去的順序要真的來自那一課的學習單，不是一份通用清單。

    ⚠️ 一份寫死的順序也能讓上面那條變綠 —— 那正是現在文言文課的做法
    （`CLASSICAL_STEP_SEQUENCE`）。這條分辨得出來：拿 `sections_present`
    的章節名逐課比對。
    """
    # ⚠️ 原本這裡自己複製了一份對照表，而且**沒有破折號正規化** ——
    #    於是 36 課的「讀全文—做記號」（EM DASH）對不上，
    #    再加上缺「品格聚光燈」等別名，154 課被判成「順序不符」。
    #    ⛔ 複製品上犯的錯跟被測對象無關，但看起來一模一樣。
    #    改成直接用生產端那一份 + 它的正規化器，兩邊不可能再漂移。
    from app.services.lesson_indexes import resolve_section_step, _SECTION_TO_STEP
    _KNOWN_STEPS = set(_SECTION_TO_STEP.values())
    checked = 0
    wrong = []
    classical: list[str] = []
    for l in search_lessons():
        uid = l.get("lesson_uid")
        f = LESSONS / uid / "v3" / "lesson.yml"
        if not f.exists():
            continue
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        sections = [str(s.get("name") or "").strip()
                    for s in (doc.get("sections_present") or [])]
        # 去重且保留首次出現的順序。L0029 是兩份學習單合併成一課，章節整組重複
        # （讀全文-做記號…出現兩次）——線上流程只走一次，所以比對的也是去重後的順序。
        want: list[str] = []
        for n in sections:
            step = resolve_section_step(n)
            if step and step not in want:
                want.append(step)
        if len(want) < 3:
            continue
        checked += 1
        # ⚠️ #2916 之後 step id 帶篇次：`full-text-annotate#dcavv`。
        #    不切掉 `#slug` 的話這裡濾出來是空的 —— 154 課全部報「順序不符」，
        #    而真正的原因是比對用的 key 對不上，不是順序錯。
        #    同一篇的重複步驟去重，因為 `want` 也是去重後的順序。
        # 文言文課吃寫死的 CLASSICAL_STEP_SEQUENCE —— 這條 docstring 明講要偵測
        # 的就是這件事。⛔ 不默默豁免：收集起來，下面斷言「就是這幾課、不准長大」。
        if l.get("classical_text"):
            classical.append(uid)
            continue
        got: list[str] = []
        for s in (l.get("step_sequence") or []):
            base = s.partition("#")[0]
            if base in _KNOWN_STEPS and base not in got:
                got.append(base)
        if got != want:
            wrong.append((uid, want[:6], got[:6]))
    assert checked >= 100, f"只比對到 {checked} 課 —— 這條在測空氣"

    # 文言文那批：順序來自寫死的清單而不是它自己的學習單。
    # 這不是「通過」，是**已知且被數住的缺口** —— 數字變大就會紅。
    assert len(classical) <= 12, (
        f"{len(classical)} 課吃寫死的 CLASSICAL_STEP_SEQUENCE（上限 12）：{classical[:6]}\n"
        "文言文的順序還沒有從它自己的學習單推導。多出來的課代表這條捷徑在擴散。")
    assert sum(1 for _, _, g in wrong if g) or not wrong, (
        "所有不符的課送出的順序都是空的 —— 那是比對用的 key 對不上（例如沒切掉 "
        "`#slug`），不是順序錯。先修比對再看結果。")
    assert not wrong, (
        f"{len(wrong)} 課送出的順序跟它自己的學習單不符：\n"
        + "\n".join(f"  {u}\n    學習單 {w}\n    送出   {g}" for u, w, g in wrong[:4])
    )
