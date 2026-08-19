"""「8 題只有 7 個選項」—— 查證後**不是缺陷**，但值得鎖住。

Young 2026-08-19 在 `/learn/20001/vocab-application` 第 7 題問：
為什麼 8 題只有七個選項？？？？？？

查證結果：L0001 有 8 題、7 個**相異**答案 —— D（血脈賁張）出現兩次
（第 1 題「這精采的比賽看得大家（　），緊張萬分」與第 7 題「電影最後的追逐場面…
讓觀眾看得（　），目不轉睛」）。7 個選項全部有用到，沒有答案指向不存在的選項。
前端預設 `FILLBLANK_OPTION_MODE = 'all'`，七個選項一直都在，用過只變灰。

**所以那一題是可以作答的。**

過程中我一度以為是「用過就移除」把答案吃掉，寫了測試才發現那條路
（`disappear`）是關著的 feature flag。記在這裡，因為下一個人會走同一條冤枉路。

真正該守的兩件事
----------------
1. 每個答案都指得到 option_bank 裡存在的選項 —— 指到不存在的才是真的無解
2. **如果哪天 `FILLBLANK_OPTION_MODE` 切成 `disappear`**，這 4 課
   （L0001 / L0029 / L0046 / L0071，答案有重複使用）就會真的出現
   「正確答案已經被吃掉」。L0029 最嚴重：16 題 10 選項，5 個答案各用兩次。
   那個 flag 一旦要打開，得先處理這 4 課。
"""
from __future__ import annotations

import collections
import pathlib
import sys

import pytest
import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data" / "lessons"
FLAGS = (pathlib.Path(__file__).resolve().parent.parent.parent
         / "frontend" / "src" / "config" / "featureFlags.ts")
MIN_SCANNED = 100


def _exercises():
    scanned = 0
    for d in sorted(LESSONS.iterdir()):
        f = d / "v3" / "vocab_application.yml"
        if not (d.is_dir() and d.name.startswith("L") and f.exists()):
            continue
        va = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("vocab_application") or {}
        items, bank = va.get("items") or [], va.get("option_bank") or {}
        if not (items and bank):
            continue
        scanned += 1
        yield d.name, items, bank
    if scanned < MIN_SCANNED:
        pytest.fail(f"只掃到 {scanned} 課（下限 {MIN_SCANNED}）—— 這條在測空氣")


def test_every_served_answer_points_at_an_option_that_exists():
    """**送到前端的**答案代號要對得上選項。指不到 = 那一題永遠答不對。

    ⚠️ 斷言打在服務層輸出，不是原始 yml。原始資料是忠實的 ——
    學習單上寫的就是全形 `Ｂ` 和手寫的 `A/B`，抽取沒有錯。
    要修的是「這一層認不認得」，所以要驗的也是這一層送出什麼。

    第一版斷言打在 yml 上，於是修好服務層之後它照樣紅 —— 測的是沒壞的東西。

    ⚠️ 第二版打對了層、打錯了函式：`_vocabulary_from` 回的是語詞理解的
    word/definition，那些 row 根本沒有 `answer`，於是每一筆都被跳過，
    兩個 mutation 都不咬。填空句在 `_cloze_from`。
    **測試裡的資料走不到你要測的那個分支時，綠是必然的。**
    """
    from app.services.lesson_indexes import _cloze_from, _vocab_bank_from
    from app.services.lesson_uid_loader import load_lesson

    dangling = []
    for uid, items, _ in _exercises():
        lesson = load_lesson(uid)
        bank = _vocab_bank_from(lesson)
        for row in _cloze_from(lesson):
            a = str(row.get("answer") or "")
            if a and bank and a not in bank:
                dangling.append((uid, row.get("sentence", "")[:20], a, sorted(bank)[:6]))
    assert not dangling, (
        f"{len({d[0] for d in dangling})} 課的答案指向不存在的選項：\n"
        + "\n".join(f"  {u} 「{i}…」答案={a} 但選項是 {b}" for u, i, a, b in dangling[:6])
    )


def test_option_mode_default_still_shows_every_option():
    """接線鎖：預設模式必須是「全部顯示」。

    切成 `disappear` 會讓下面那 4 課的重複答案被吃掉 —— 學生走到第二次用到
    那個詞的題目時，正確答案已經不在選項裡，而畫面上沒有任何異常。
    這條在 flag 被改掉的那一刻就會紅。
    """
    src = FLAGS.read_text(encoding="utf-8")
    assert "'all'" in src, "featureFlags.ts 找不到 'all' —— 這條在測空氣"
    assert "_rawOptMode" in src or "FILLBLANK_OPTION_MODE" in src
    # 預設值那一行
    # 預設值散在幾行（env / localStorage / fallback），取宣告之後那一段來看
    idx = src.index("export const FILLBLANK_OPTION_MODE")
    block = src[idx: idx + 400]
    assert "'all'" in block, (
        f"預設模式不是 'all'：\n{block[:200]}\n—— 先處理下方 4 課的重複答案再切"
    )


def test_lessons_that_reuse_an_answer_are_known():
    """哪幾課的答案重複使用 —— 只能減少，不能增加。

    這不是缺陷清單，是**切換 flag 之前要先處理的清單**。
    新增一課代表教材端又出現同樣形狀，那個 flag 就更難打開。
    """
    reusing = {}
    for uid, items, _ in _exercises():
        c = collections.Counter(str(i.get("answer")) for i in items if i.get("answer"))
        dup = {k: v for k, v in c.items() if v > 1}
        if dup:
            reusing[uid] = dup
    assert set(reusing) <= {"L0001", "L0029", "L0046", "L0071"}, (
        f"多了會重複使用答案的課：{sorted(set(reusing) - {'L0001','L0029','L0046','L0071'})}"
    )
