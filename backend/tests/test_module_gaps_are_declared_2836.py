"""模組缺口必須是宣告，不是靠人翻原稿（#2836）。

## 這條門在守什麼

175 課裡有 46 課缺某些模組。**逐課開教師版原稿數過關鍵字，全部都是學習單本身
沒有那一節** —— 不是抽取器漏抓（證據見 `content_known_gaps.yaml` 的
`modules_absent_from_source.evidence`）。

沒有這條門的話，每次有人看到「這課沒有重點表」就得再翻一次原稿。
2026-08-21 就翻過一次，翻完的結論如果不落成宣告，下次還要再翻。

## 為什麼是「== 宣告數」而不是「== 0」

`== 0` 會恆紅 —— 那 46 課的缺口是真的、正確的、不該補的。
紅久了就沒人看，那條門等於死掉，真的有新缺口冒出來也不會有人發現。

所以門的形狀是：**實際缺口集合 == 宣告的缺口集合**。
- 冒出**沒宣告**的缺口 → 紅（可能是抽取器真的漏了）
- 宣告了但**已經補上** → 也紅（宣告過期，該清掉）

兩個方向都要紅，只擋一邊會讓宣告慢慢長成一份沒人整理的豁免清單。
"""
from __future__ import annotations

import pathlib

import pytest
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
GAPS = REPO_ROOT / "backend" / "data" / "curriculum_qa" / "content_known_gaps.yaml"

#: 逐課檢查這幾個模組。跟 content_known_gaps 產生時同一份清單 ——
#: 改這裡就要重產宣告，否則兩邊會漂開。
MODULES = [
    "comprehension", "spotlight", "full_text_annotate", "key_reading", "keypoints",
    "vocab_definitions", "vocab_review", "vocab_application", "resources",
]


def _actual_gaps() -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for lesson_dir in sorted(LESSONS.glob("L*")):
        v3 = lesson_dir / "v3"
        if not (v3 / "lesson.yml").is_file():
            continue
        # 檔名是 `{模組}.{slug}.yml`（#2916），一課可能有好幾份。
        # 寫死 `{m}.yml` 的話**每一課的每一個模組都算成缺** ——
        # 175 課全數「缺模組」，而檔案全都在。
        absent = {m for m in MODULES if not any(v3.glob(f"{m}.*.yml"))}
        if absent:
            out[lesson_dir.name] = absent
    return out


def _declared_gaps() -> dict[str, set[str]]:
    data = yaml.safe_load(GAPS.read_text(encoding="utf-8")) or {}
    block = data.get("modules_absent_from_source")
    assert block, "content_known_gaps.yaml 缺 modules_absent_from_source 區塊"
    return {
        entry["lesson_uid"]: set(entry["absent_modules"])
        for entry in block.get("lessons", [])
    }


@pytest.fixture(scope="module")
def actual():
    return _actual_gaps()


@pytest.fixture(scope="module")
def declared():
    return _declared_gaps()


def test_the_scan_found_lessons_at_all(actual):
    """掃描前提 —— 少了這條，掃不到課時下面每一條都會恆綠。"""
    total = len(list(LESSONS.glob("L*/v3/lesson.yml")))
    assert total >= 150, f"只掃到 {total} 課，掃描壞了"


def test_no_undeclared_gap(actual, declared):
    """冒出沒宣告的缺口 → 可能是抽取器真的漏了，要有人看一眼。"""
    surprises = {
        uid: sorted(mods - declared.get(uid, set()))
        for uid, mods in actual.items()
        if mods - declared.get(uid, set())
    }
    assert not surprises, (
        "以下模組缺口沒有登錄在 content_known_gaps.yaml：\n"
        + "\n".join(f"  {uid}: {mods}" for uid, mods in sorted(surprises.items()))
        + "\n\n先開教師版原稿確認是「學習單本來就沒有」還是「抽取器漏抓」，"
          "\n再決定要登錄還是要重抽。⛔ 不要為了讓門變綠就直接登錄。"
    )


def test_no_stale_declaration(actual, declared):
    """宣告了但其實已經補上 → 宣告過期，該清掉。

    只擋單邊會讓這份宣告慢慢長成一份沒人整理的豁免清單。
    """
    stale = {
        uid: sorted(mods - actual.get(uid, set()))
        for uid, mods in declared.items()
        if mods - actual.get(uid, set())
    }
    assert not stale, (
        "以下登錄的缺口其實已經有檔案了，宣告過期：\n"
        + "\n".join(f"  {uid}: {mods}" for uid, mods in sorted(stale.items()))
        + "\n\n從 content_known_gaps.yaml 的 modules_absent_from_source 移除。"
    )


def test_counts_match_the_declared_totals(actual, declared):
    """數量斷言 —— 用總數再對一次，防止上面兩條因集合運算寫錯而同時漏抓。"""
    data = yaml.safe_load(GAPS.read_text(encoding="utf-8"))
    block = data["modules_absent_from_source"]
    assert len(actual) == block["count_lessons"], (
        f"缺模組的課數 {len(actual)} 對不上宣告的 {block['count_lessons']}"
    )
    assert sum(len(v) for v in actual.values()) == block["count_gaps"], (
        f"缺口總數 {sum(len(v) for v in actual.values())} 對不上宣告的 {block['count_gaps']}"
    )
