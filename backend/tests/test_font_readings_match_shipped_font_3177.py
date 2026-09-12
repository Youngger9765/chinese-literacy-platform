"""前端斷言用的那張讀音表，必須跟**出貨的字型**一致。(#3177)

## 為什麼需要這一道

`frontend/src/components/zhuyin/__fixtures__/fontReadings.generated.json` 是
`polyphonicReadings.test.ts` 全部斷言的**真值來源**。它從
`frontend/public/fonts/BpmfZihiSerif-Regular.ttf` 抽出來。

如果那份 fixture 跟字型漂掉（換字型、有人手改、產生器改了沒重生），
前端那支會**照樣全綠，但鎖住的是一張過期的表** —— 那正是 #3177 的病本身：
`bopomoConstants.ts` 的註解宣稱 `行` 的字型預設是 háng，字型說是 xing2，
而 44 條測試綠著幫那個錯誤信念背書了半年。

**所以這道門不驗注音對不對，只驗「那張表是不是真的從這支字型來的」。**

⛔ 不要把這支改成「比對一份寫死的期望值」—— 那又是一張會過期的表。
   它每次都真的去讀 TTF。
"""

from __future__ import annotations

import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FONT = ROOT / "frontend/public/fonts/BpmfZihiSerif-Regular.ttf"
FIXTURE = ROOT / "frontend/src/components/zhuyin/__fixtures__/fontReadings.generated.json"
POYIN_DB = ROOT / "frontend/public/data/poyin_db.json"

sys.path.insert(0, str(ROOT / "backend" / "scripts"))


@pytest.fixture(scope="module")
def font_table() -> dict[str, dict[str, str]]:
    from extract_font_readings import build_reading_table

    assert FONT.exists(), f"出貨字型不在了：{FONT}"
    return build_reading_table(str(FONT))


@pytest.fixture(scope="module")
def fixture_table() -> dict[str, dict[str, str]]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_the_extractor_actually_reads_something(font_table) -> None:
    """正向對照。少了這條，下面每一條都會在空 dict 上通過。"""
    assert len(font_table) > 10000, f"只抽到 {len(font_table)} 個字 —— 抽取器壞了"
    # 五個手工核對過的字，直接寫死當 canary：抽取器若換了解讀方式，這裡會叫。
    assert font_table["行"] == {
        "0000": "xing2",
        "ss01": "hang2",
        "ss02": "xing4",
        "ss03": "hang4",
    }
    assert font_table["著"] == {
        "0000": "zhe5",
        "ss01": "zhu4",
        "ss02": "zhao1",
        "ss03": "zhao2",
        "ss04": "zhuo2",
    }
    assert font_table["了"] == {"0000": "le5", "ss01": "liao3"}
    assert font_table["難"] == {"0000": "nan2", "ss01": "nan4", "ss02": "nuo2"}
    assert font_table["得"] == {"0000": "de2", "ss01": "de5", "ss02": "dei3"}


def test_fixture_matches_the_shipped_font(font_table, fixture_table) -> None:
    """fixture 的每一格都要跟字型現在說的一樣。"""
    drifted = [
        f"{ch}: fixture={slots} 字型={font_table.get(ch)}"
        for ch, slots in fixture_table.items()
        if font_table.get(ch) != slots
    ]
    assert not drifted, (
        f"{len(drifted)} 個字的讀音表跟出貨字型對不上（前 5 筆）：\n  "
        + "\n  ".join(drifted[:5])
        + "\n\n重生：python3 backend/scripts/extract_font_readings.py --write-fixture"
    )


def test_fixture_covers_every_polyphonic_char_in_poyin_db(fixture_table) -> None:
    """poyin_db 裡每一個有變體的字都要在表裡，否則前端會查到 undefined。

    查不到讀音時 `readingOf()` 回 null，而 `expect(null).not.toBe(x)` 是恆真的 ——
    少了這條，覆蓋率破洞會偽裝成通過。
    """
    db = json.loads(POYIN_DB.read_text(encoding="utf-8"))["data"]
    with_variants = {
        ch for ch, e in db.items() if isinstance(e, dict) and e.get("v")
    }
    assert len(with_variants) > 500, f"只找到 {len(with_variants)} 個有變體的字 —— 解析壞了"
    missing = sorted(with_variants - set(fixture_table))
    assert not missing, f"這些字有變體卻不在讀音表裡：{missing[:20]}"


def test_variant_count_matches_the_font(fixture_table) -> None:
    """`v[]` 的格數必須等於字型給的變體數。

    對不上就代表 `v[]` 的第 N 格會對到不存在的槽（或漏掉一個真的讀音），
    而 styleSet 的對應是照索引算的 —— 那就是 #3177 那種「讀音跑到別格」的形狀。
    """
    db = json.loads(POYIN_DB.read_text(encoding="utf-8"))["data"]
    mismatched = [
        f"{ch}: poyin_db 有 {len(db[ch]['v'])} 格、字型有 {len(fixture_table[ch])} 個讀音"
        for ch in fixture_table
        if isinstance(db.get(ch), dict)
        and db[ch].get("v")
        and len(db[ch]["v"]) != len(fixture_table[ch])
    ]
    assert not mismatched, "\n  ".join(mismatched[:10])
