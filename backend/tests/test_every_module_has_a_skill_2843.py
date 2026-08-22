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

#: 別人負責的區域 —— 不是我方漏寫。改動這份名單要有人真的接手了才行。
OWNED_ELSEWHERE = {
    "key_reading",    # 靖杭 @if-else-master
    "keypoints",      # 啟翔 @stgst
    "spotlight",      # 啟翔 @stgst
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
    missing = sorted(_corpus_modules() - _skills() - OWNED_ELSEWHERE)
    assert not missing, (
        f"{len(missing)} 種模組沒有自己的抽取 skill：{missing}\n"
        "   缺的時候沒有任何症狀 —— 派工單照樣產、形狀門照樣綠。"
    )


def test_the_known_gaps_are_still_other_peoples_and_still_missing():
    """known gap 名單要跟現實對得上。

    ⛔ 兩個方向都要擋：
      · 名單上的其實已經有人寫了 → 該從名單移除，否則它會遮住未來的真缺口
      · 名單上的模組語料庫已經沒有了 → 名單過期
    """
    mods, skills = _corpus_modules(), _skills()
    for m in sorted(OWNED_ELSEWHERE):
        assert m in mods, f"{m} 已不在語料庫裡 —— known gap 名單過期了"
        assert m not in skills, (
            f"{m} 已經有 skill 了 —— 從 OWNED_ELSEWHERE 移除，"
            "否則它會遮住未來真的缺口"
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
