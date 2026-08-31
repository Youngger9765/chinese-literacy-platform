"""同一份 skill 不可以同時說「還沒驗」和「已量到 X」（#2858 盤點時發現）。

`lesson-overview-scan/SKILL.md` 有九天的時間同時寫著：

    **還沒驗的：跑兩次的一致率。** 這條最重要（LLM 會 run-to-run 飄），下次補。
    ...
    **重跑一致率已量（2026-08-22，L0072 × 3 次）**：大題集合 3/3 完全相同...

兩句在同一份檔案裡、相隔幾行。讀的人拿到哪一句全看他從哪裡開始讀 ——
而「還沒驗」那句會讓人以為這支不能用。

⛔ 這條只擋**同一份檔案內**的直接矛盾，不做語意判斷。
   判準要窄到不會誤擋，否則它會先變成雜訊然後被關掉。
"""
import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
SKILLS = sorted((REPO / ".claude" / "skills").rglob("SKILL.md"))

#: 「還沒做」的講法
_PENDING = re.compile(r"還沒驗|尚未量|還沒量|待補數字|沒有量過")
#: 「已經做了」的講法（要帶具體數字，否則抓不到真矛盾）
_DONE = re.compile(r"已量[^\n]{0,30}\d|已補[^\n]{0,30}\d|實測[^\n]{0,30}\d")


def _topic(line: str) -> str | None:
    """抽出那句在講什麼主題 —— 只有同主題才算矛盾。"""
    for t in ("一致率", "human-agreement", "退件率", "命中率", "貼合率", "涵蓋率"):
        if t in line:
            return t
    return None


@pytest.mark.parametrize("p", SKILLS, ids=lambda p: p.parent.name)
def test_no_skill_says_both_pending_and_measured_about_the_same_thing(p):
    """⛔ 同一份檔案裡，同一個主題不可以既「還沒驗」又「已量到 N」。"""
    lines = p.read_text(encoding="utf-8", errors="ignore").split("\n")
    pending = {t for ln in lines if _PENDING.search(ln) and (t := _topic(ln))}
    done = {t for ln in lines if _DONE.search(ln) and (t := _topic(ln))}
    clash = sorted(pending & done)
    assert not clash, (
        f"{p.parent.name}/SKILL.md 對「{', '.join(clash)}」同時寫著還沒驗與已量到 —— "
        "把過期那句改掉，不要讓讀的人賭他從哪裡開始讀")


def test_the_detector_can_actually_fire():
    """正向對照：偵測器對一段合成的矛盾要抓得到，否則上面那條恆真。"""
    fake = ["**還沒驗的：跑兩次的一致率。** 下次補。",
            "**重跑一致率已量（L0072 × 3 次）**：3/3 相同。"]
    pending = {t for ln in fake if _PENDING.search(ln) and (t := _topic(ln))}
    done = {t for ln in fake if _DONE.search(ln) and (t := _topic(ln))}
    assert pending & done, "偵測器抓不到合成的矛盾 —— 上面那條是恆真的"


def test_it_does_not_fire_on_a_normal_pending_line():
    """反向對照：只說「還沒驗」而沒有對應數字的，不可以紅（那是誠實，不是矛盾）。"""
    fake = ["**還沒驗的：human-agreement。** 要人工標註 20 個樣本。"]
    pending = {t for ln in fake if _PENDING.search(ln) and (t := _topic(ln))}
    done = {t for ln in fake if _DONE.search(ln) and (t := _topic(ln))}
    assert not (pending & done), "把單純的「還沒驗」誤判成矛盾 —— 那會逼人刪掉誠實的話"


def test_there_are_skills_to_scan():
    assert len(SKILLS) >= 10, f"只掃到 {len(SKILLS)} 份 SKILL.md"
