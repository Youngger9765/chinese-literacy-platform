"""閱讀理解的兩個形狀陷阱（#2843，extract-comprehension 的回歸鎖）。

寫這支是因為 `extract-comprehension` SKILL 裡的兩條專屬紀律，
如果沒有測試守著，下一個人「順手正規化」就會全庫爆掉而且沒有症狀。

## 陷阱一：`options` 是 dict 不是 list

172 課全部是 dict，`answer` 對應的是 **key**（"C"）不是索引（2）。
2026-08-19 那批 bug 就是有 code 把它當 list 讀 —— `.get()` 回 None，
不報錯、其他門全綠、學生看不到題目。

## 陷阱二：題目載體有兩個 key，不要統一

`questions` 144 課、`items` 27 課，兩種都在服務中。
統一任何一邊都會讓那批課的消費端讀不到。真要統一是另一張票，
要先查所有消費端 —— 這條鎖擋的就是「順手統一」。
"""
from __future__ import annotations

import collections
import pathlib

import pytest
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"


@pytest.fixture(scope="module")
def bodies() -> list[tuple[str, dict]]:
    out = []
    for path in sorted(LESSONS.glob("L*/v3/comprehension.yml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        body = data.get("comprehension")
        if isinstance(body, dict):
            out.append((path.parent.parent.name, body))
    return out


def test_the_scan_found_lessons(bodies):
    """掃描前提 —— 掃不到課時下面全部恆綠。"""
    assert len(bodies) >= 150, f"只掃到 {len(bodies)} 課"


def test_options_are_dicts_not_lists(bodies):
    """🔴 options 必須是 dict。用數量斷言，不是「至少有一課是對的」。"""
    offenders = []
    checked = 0
    for uid, body in bodies:
        for q in (body.get("questions") or body.get("items") or []):
            if not isinstance(q, dict) or "options" not in q:
                continue
            checked += 1
            if not isinstance(q["options"], dict):
                offenders.append((uid, q.get("index"), type(q["options"]).__name__))
    assert checked >= 500, f"只檢查到 {checked} 題，掃描壞了"
    assert not offenders, (
        f"{len(offenders)} 題的 options 不是 dict：\n"
        + "\n".join(f"  {u} 第 {i} 題 → {t}" for u, i, t in offenders[:10])
        + "\n\n⛔ answer 對應的是 dict 的 key（\"C\"）不是索引。"
          "\n   改成 list 會讓消費端 .get() 回 None —— 不報錯、門全綠、學生看不到題目。"
    )


def test_answers_are_single_letter_keys(bodies):
    """answer 必須是單一字母，且要真的是該題 options 的 key。

    只驗「是單字母」不夠 —— 指向不存在的選項一樣是壞的，而且更難發現。
    """
    bad_shape, dangling = [], []
    for uid, body in bodies:
        for q in (body.get("questions") or body.get("items") or []):
            if not isinstance(q, dict):
                continue
            a = q.get("answer")
            if a is None:
                continue  # needs_review 的情形，由骨架 §2.1 管
            if not (isinstance(a, str) and len(a) == 1):
                bad_shape.append((uid, q.get("index"), repr(a)))
            elif isinstance(q.get("options"), dict) and a not in q["options"]:
                dangling.append((uid, q.get("index"), a, sorted(q["options"])))
    assert not bad_shape, (
        "answer 不是單一字母：\n"
        + "\n".join(f"  {u} 第 {i} 題 = {a}" for u, i, a in bad_shape[:10])
    )
    assert not dangling, (
        "answer 指向不存在的選項：\n"
        + "\n".join(f"  {u} 第 {i} 題 answer={a} 但 options 只有 {o}" for u, i, a, o in dangling[:10])
    )


def test_both_carrier_keys_survive(bodies):
    """🔴 questions 與 items 兩種載體都要還在 —— 擋「順手統一」。

    數量斷言：任一邊掉到 0 就是有人統一掉了，那批課的消費端會讀不到。
    """
    carrier = collections.Counter()
    for _, body in bodies:
        for key in ("questions", "items"):
            if key in body:
                carrier[key] += 1
    assert carrier["questions"] >= 140, (
        f"用 questions 的課從 144 掉到 {carrier['questions']}"
    )
    assert carrier["items"] >= 25, (
        f"用 items 的課從 27 掉到 {carrier['items']} —— 有人把載體統一掉了？\n"
        "⛔ 兩種都在服務中，統一任何一邊都會讓那批課讀不到。\n"
        "真要統一請先查所有消費端，並另開票。"
    )
