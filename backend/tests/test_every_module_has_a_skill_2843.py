"""每一種模組都要有一支自己的抽取 skill（#2843 的「一對一」）。

## 為什麼要鎖

「航空母艦派飛機」那個設計的前提是**一個模組一架飛機**。少一支的話，
那個模組就只能回到「一個 skill 打遍天下」——而那正是要離開的做法。

⛔ 而且缺的時候**沒有任何症狀**：派工單照樣產得出來（它列的是大題不是 skill）、
形狀門照樣綠（那些 yml 是先前用別的方式抽出來的）。
不數一次就不會知道。2026-08-23 第一次數：17/23。

## 刻意不算的

`key_reading` / `keypoints` / `spotlight` —— 那三個是實習生負責的區域，
skill 由他們寫。這裡列成 known gap 而不是失敗，**但仍然要列出來**，
否則「別人的」跟「忘了寫」在清單上長得一樣。
"""
from __future__ import annotations

import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
SKILLS = REPO / ".claude" / "skills"
LESSONS = REPO / "backend" / "data" / "lessons"

#: 這三個模組的**內容規格寫在別的名字底下**，`extract-*` 只是轉接。
#:
#: 🔴 第一版我把它們列成「別人負責、還沒寫」的 known gap —— **那是錯的**。
#:    三份規格都存在而且很完整（305 / 241 / 174 行），只是不叫 `extract-*`：
#:    我掃的時候只看了 `extract-` 前綴，於是把「命名不同」誤判成「沒有」。
#:    查得太窄 → 回報成缺口。
#:
#: 所以現在三支 `extract-*` 都在（轉接），但它們**不可以自己長出內容** ——
#: 抄一份就會漂，而漂掉的那一份不會報錯。
POINTER_ONLY = {
    "key_reading": "lesson-reading-pipeline",  # 靖杭 @if-else-master（重點朗讀那個 PR）
    "keypoints": "build-keypoints",            # 啟翔 @stgst
    "spotlight": "build-spotlight",            # 啟翔 @stgst
}

#: 不是模組，是骨架 / 舊的整包抽取器
NOT_A_MODULE = {"module", "lesson_multimodal"}


def _corpus_modules() -> set[str]:
    out = set()
    for p in LESSONS.glob("L*/v3/*.yml"):
        stem = p.stem
        if stem == "lesson" or stem.startswith("_"):
            continue
        out.add(stem)
    return out


def _skills() -> set[str]:
    return {d.name[len("extract-"):].replace("-", "_")
            for d in SKILLS.glob("extract-*") if d.is_dir()}


def test_every_corpus_module_has_an_extraction_skill():
    """用**數量**斷言，不是「至少有一支」。

    只驗「skills 目錄非空」的話，1 支跟 20 支長得一樣綠。
    """
    missing = sorted(_corpus_modules() - _skills())
    assert not missing, (
        f"{len(missing)} 種模組沒有 extract-<module> skill：{missing}\n"
        "   派工單印的是「跑 extract-<module>」，名字解不到就等於沒有。\n"
        "   缺的時候沒有任何症狀 —— 派工單照樣產、形狀門照樣綠。"
    )


def test_pointer_skills_point_somewhere_real_and_stay_thin():
    """轉接就是轉接，⛔ 不可以自己長出內容。

    抄一份規格過來就會漂，而漂掉的那一份**不會報錯** ——
    只會讓下一個人照著舊的做（`build-key-reading` 就是這樣變成 #2712 的成因）。
    """
    for mod, target in POINTER_ONLY.items():
        d = SKILLS / f"extract-{mod.replace('_', '-')}"
        assert d.is_dir(), f"{mod} 的轉接不見了"
        src = (d / "SKILL.md").read_text(encoding="utf-8")
        assert target in src, f"extract-{mod} 沒有指向 {target}"
        assert (SKILLS / target / "SKILL.md").is_file(), \
            f"extract-{mod} 指向 {target}，但那份不存在 —— 懸空引用"
        n = len(src.split("\n"))
        assert n <= 90, (
            f"extract-{mod} 長到 {n} 行 —— 轉接不該有這麼多內容，"
            f"真規格在 {target}"
        )


def test_the_real_specs_are_not_deprecated():
    """轉接指到的那份必須是活的。

    ⚠️ `build-key-reading` 現在整份是「已停用」說明 —— 它明文寫的規則正是
    #2712（朗讀範圍比教授畫的多一倍）的成因。指到一份停用的規格
    比沒有轉接更糟：名字解得到，內容是有害的。
    """
    for mod, target in POINTER_ONLY.items():
        head = (SKILLS / target / "SKILL.md").read_text(encoding="utf-8")[:600]
        assert "已停用" not in head, (
            f"extract-{mod} 指向 {target}，而那份已停用 —— 要改指到取代它的那份"
        )


def test_no_skill_points_at_a_module_that_does_not_exist():
    """反向：有 skill 卻沒有對應模組 = 指向不存在的東西。"""
    orphan = sorted(_skills() - _corpus_modules() - NOT_A_MODULE)
    assert not orphan, f"這些 skill 沒有對應的模組：{orphan}"


@pytest.mark.parametrize("name", ["errata", "metadata", "multi_text_parts"])
def test_the_three_new_skills_state_their_measured_scale(name):
    """新寫的三支要寫出**實測**規模，⛔ 不可以只寫做法。

    沒有數字的 skill 讀的人無從判斷「我這課算不算特例」，
    而這三個模組的特例比例分別是 40% / 100% / 2%。
    """
    d = SKILLS / f"extract-{name.replace('_', '-')}"
    src = (d / "SKILL.md").read_text(encoding="utf-8")
    assert "實測" in src, f"{name} 沒寫實測"
    assert "尚未實跑" in src, f"{name} 沒有誠實標明還沒真的跑過"
    assert "/ 175 課" in src or "/ 175" in src or "175 課" in src, \
        f"{name} 沒寫涵蓋幾課"


def test_the_first_real_run_is_recorded():
    """⑤ 的洞：這套 skill 從來沒真的抽過一課，而 skill 裡的數字全是
    「對現有語料的統計」不是「我用它抽出來的結果」。

    2026-08-23 拿 L0011 對 `extract-vocab-definitions` 實跑第一次 ——
    11 題全中，但撞出四個那份沒寫的東西，其中一個是**真的抽錯**
    （兩欄折行處掉了一個頓號，逐字門抓到）。

    這條鎖住那份紀錄不被改回「尚未實跑」。⛔ 一支 skill 標著實跑過、
    內容卻沒有任何實跑撞出來的東西，比標「尚未實跑」更糟 ——
    讀的人會以為它驗證過了。
    """
    src = (SKILLS / "extract-vocab-definitions" / "SKILL.md").read_text(encoding="utf-8")
    assert "首次實跑紀錄" in src, "實跑紀錄不見了"
    assert "L0011" in src, "沒寫是拿哪一課跑的"
    assert "頓號" in src, "沒寫實跑撞出來的那個真錯誤"
    assert "尚未實跑" not in src, "又標回尚未實跑了"


def test_skills_that_claim_a_real_run_say_which_lesson():
    """標了實跑就要寫出**拿哪一課跑的**。

    ⛔ 「已實跑」三個字本身不是證據 —— 沒有課號就沒有人能重跑確認。
    """
    import re
    for d in sorted(SKILLS.glob("extract-*")):
        src = (d / "SKILL.md").read_text(encoding="utf-8")
        if "尚未實跑" in src or "本身沒有實跑紀錄" in src:
            continue
        # ⚠️ 判準收窄過兩次，兩次都是**太寬**：
        #    ① 「檔案裡有沒有任何 L####」—— 這些 skill 本文常引用一堆課號
        #       當例子，把實跑那一段的課號拿掉，斷言照樣綠（mutation 沒咬）
        #    ② 「提到『實跑』就算宣稱跑過」—— 骨架 extract-module 只是在
        #       註解裡提到「第一次實跑才發現」，被判成宣稱，基線就紅
        #    現在的規則：**寫了實跑紀錄段，就要在那一段裡寫出課號。**
        idx = src.find("實跑紀錄")
        if idx < 0:
            continue
        # ⚠️ 只查「檔案裡有沒有任何 L####」太寬 —— 這些 skill 本文常引用一堆
        #    課號當例子（L0083 / L0137 …），於是把實跑那一段的課號拿掉，
        #    斷言照樣綠（mutation 實測沒咬）。收窄到**實跑那一段之內**。
        section = src[idx:]
        assert re.search(r"L\d{4}", section), (
            f"{d.name} 宣稱實跑過，但實跑那一段裡沒有課號 —— 無法重跑確認"
        )
