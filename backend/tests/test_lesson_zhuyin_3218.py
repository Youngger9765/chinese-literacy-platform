"""注音改成查表 —— 後端不再自己選讀音（#3218）

## 這條鎖守什麼

注音本來有兩套選擇器，實測全庫 7,682 / 65,754 個破音字位置（11.7%）不一致。
而「讓兩邊規則一致」走不通 —— 後端結構上無法重現前端那套引擎（第一/第二 pass
優先序、`skipPrev` 狀態機、`SPECIAL_DOUBLE_CHARACTERS`），#3215 移植過一次吐出
`不 → ㄈㄨ`。所以改成兩邊讀同一份表。

這條鎖守的是「後端真的在查表，而不是又自己算了一次」。

## ⚠️ 為什麼一定要有第三個 class

「查表結果 == 表」這種斷言有一個很隱蔽的空轉方式：**它恆為真**。
所以 `TestTheLockHasTeeth` 會把表的內容換掉，那時斷言**必須紅**。
沒有那一組，這整支測試什麼都不證明。
（同 feedback_my_headline_evidence_was_vacuous：前後對照不足以證明一把尺有鑑別力。）
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.lesson_zhuyin import lesson_zhuyin_table, zhuyin_for_text

LESSONS = Path(__file__).resolve().parents[1] / "data" / "lessons"
PILOT = "L0001"


def _table_path(uid: str) -> Path:
    vdir = max((c for c in (LESSONS / uid).iterdir()
                if c.is_dir() and c.name.startswith("v")), key=lambda c: c.name)
    return vdir / "zhuyin.json"


@pytest.fixture(scope="module")
def raw() -> dict:
    return json.loads(_table_path(PILOT).read_text(encoding="utf-8"))


class TestTableIsWellFormed:
    """表本身沒壞 —— 這是下面斷言能算數的前提"""

    def test_reading_authority_is_the_shipped_frontend(self, raw):
        # 若權威變成後端自己算，下面的比對就恆為真
        assert "polyphonicProcessor" in raw["_provenance"]["reading_authority"]

    def test_每段的槽位陣列與字數對齊(self, raw):
        """#3175 的形狀：一旦錯位，拿到的是整串位移但看起來合理的答案"""
        for t in raw["texts"]:
            assert len(t["ss"]) == t["n"] == len(t["text"]), (
                f"{t['section']} idx={t['idx']} 槽位 {len(t['ss'])} vs 字數 {t['n']}"
            )

    def test_每個破音字位置都指到真的那個字(self, raw):
        for t in raw["texts"]:
            for r in t["poly"]:
                assert t["text"][r["i"]] == r["c"], (
                    f"{t['section']} i={r['i']} 表說是「{r['c']}」實際是「{t['text'][r['i']]}」"
                )
                assert r["b"], f"{r['c']} 沒有注音"


class TestBackendReadsTheTable:
    """⭐ 主斷言：後端對 L0001 每一段的讀音逐字等於表"""

    def test_每一段都查得到而且逐字相符(self, raw):
        checked = 0
        for t in raw["texts"]:
            got = zhuyin_for_text(PILOT, t["text"])
            assert got is not None, f"查不到 {t['section']} idx={t['idx']}"
            for r in t["poly"]:
                checked += 1
                assert got.get(r["i"]) == r["b"], (
                    f"{t['section']} i={r['i']}「{r['c']}」表={r['b']} 後端={got.get(r['i'])}"
                )
        assert checked > 0, "一個位置都沒比到 —— 測試空轉"

    def test_單音字也要有注音(self, raw):
        """表只收破音字位置；單音字由字型的 single 表補上，不能整段只剩破音字有注音"""
        t = raw["texts"][0]
        got = zhuyin_for_text(PILOT, t["text"])
        poly_idx = {r["i"] for r in t["poly"]}
        single_hits = [i for i in got if i not in poly_idx]
        assert len(single_hits) > len(poly_idx), (
            f"只拿到 {len(single_hits)} 個單音字注音 vs {len(poly_idx)} 個破音字 —— single 表沒接上"
        )

    def test_不在表裡的文字回_None(self):
        """老師臨時打的字沒有表 → 回 None 讓呼叫端決定 fallback，不要亂猜"""
        assert zhuyin_for_text(PILOT, "這段文字不在任何一課裡面") is None

    def test_沒有這一課回_None(self):
        assert lesson_zhuyin_table("L9999") is None


class TestTheLockHasTeeth:
    """負向對照：表的內容換掉，主斷言必須紅"""

    def test_改掉表之後查表結果會跟著變(self, raw, monkeypatch):
        t = raw["texts"][0]
        first = t["poly"][0]
        真 = zhuyin_for_text(PILOT, t["text"])[first["i"]]
        assert 真 == first["b"]

        # 把表換成一份把該位置改成別的讀音的版本
        假 = json.loads(json.dumps(raw))
        假["texts"][0]["poly"][0]["b"] = "ㄅㄚ˙˙"
        monkeypatch.setattr("app.services.lesson_zhuyin._read_table", lambda uid: 假)
        lesson_zhuyin_table.cache_clear()
        變 = zhuyin_for_text(PILOT, t["text"])[first["i"]]
        assert 變 == "ㄅㄚ˙˙", "改了表但查表結果沒變 —— 後端根本沒在讀表"
        lesson_zhuyin_table.cache_clear()
