"""表格格子裡的 ☑ 沒有被讀出來 —— 全庫真值只讀到 31%（#2735 後續）。

`checked_box_positions` 已經接在段落層（`extract_raw` 的 `kind="p"`），
但**表格完全沒有**：`table_cells()` 每個 cell 只帶 `text`，那份 text 又是
`_cell_text()` 產的、勾早就被正規化成 `□`。

實測（19 課教師版原稿）：

    ☑ 真值      183 個
    抽取器讀到   57 個   （31%）
    🔴 漏掉      126 個   幾乎全在 table block 裡

重點表那類題目的答案就住在表格裡，所以這一段不補，#2735 只修好三分之一。
"""
import sys, os, pathlib, importlib.util

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

DOCX_ROOT = pathlib.Path("/Users/young/project/kist-curriculum/教材原檔")

import pytest


def _bls():
    spec = importlib.util.spec_from_file_location("bls", ROOT / "scripts" / "build_lesson_schema.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules["bls"] = m
    spec.loader.exec_module(m)
    return m


def _teacher_docx():
    if not DOCX_ROOT.is_dir():
        pytest.skip("L2 教師版原稿不在這台機器上")
    best = {}
    import re
    for f in DOCX_ROOT.rglob("*.docx"):
        mm = re.search(r"(G\d+)-S?L(\d+)", f.name)
        if not mm:
            continue
        c = f"{mm.group(1)}-L{int(mm.group(2))}"
        if c not in best or f.stat().st_size > best[c].stat().st_size:
            best[c] = f
    if not best:
        pytest.skip("找不到任何教師版 DOCX")
    return best


class TestTableCellsCarryTheTick:
    def test_a_cell_whose_box_is_ticked_reports_it(self):
        """表格 cell 要跟段落一樣帶 `checked`。"""
        bls = _bls()
        docs = _teacher_docx()
        f = docs.get("G4-L10") or next(iter(docs.values()))
        raw = bls.extract_raw(str(f))

        tables = [r for r in raw if r.get("kind") == "table"]
        assert tables, f"{f.name} 抽不到任何 table block —— 這條在測空氣"

        cells = [c for t in tables for row in t["rows"] for c in row["cells"]]
        assert cells, "table 裡沒有 cell —— 這條在測空氣"
        assert any("checked" in c for c in cells), (
            "沒有任何 cell 帶 checked 欄位 —— 表格層完全沒讀勾"
        )

    def test_the_corpus_wide_catch_rate_is_not_a_third(self):
        """數量斷言：全庫讀到的勾要接近真值，不是「有一個讀到了」。

        修正前是 57 / 183（31%）。表格補上之後應該大幅提高。
        """
        sys.path.insert(0, "/tmp/gt2735")
        try:
            from truth import checked_options
        except ImportError:
            pytest.skip("真值讀取腳本不在（scripts/issue_2735 的 /tmp 副本）")

        bls = _bls()
        docs = _teacher_docx()
        truth = caught = lessons = 0
        for code, f in sorted(docs.items())[:20]:
            try:
                raw = bls.extract_raw(str(f))
            except Exception:
                continue
            t = len(checked_options(f))
            if not t:
                continue
            lessons += 1
            truth += t
            caught += sum(len(r.get("checked") or []) for r in raw)
            for tb in (r for r in raw if r.get("kind") == "table"):
                caught += sum(
                    len(c.get("checked") or [])
                    for row in tb["rows"] for c in row["cells"]
                )

        assert lessons >= 10, f"只比對到 {lessons} 課 —— 這條在測空氣"
        rate = caught / truth if truth else 0
        assert rate >= 0.80, (
            f"全庫只讀到 {caught}/{truth} 個 ☑（{rate:.0%}）—— 修正前是 31%，"
            "低於 80% 表示還有一整類位置沒被讀到"
        )


class TestTheCatchRateAgainstAbsoluteTruth:
    """用 XML 裡 F0FE 的**總數**當真值，而不是我自己那支 reader 的輸出。

    reader 也可能漏（它只讀段落），拿它當分母會把「兩邊一起漏」算成滿分。
    直接數 `w:char="F0FE"` 出現幾次才是絕對上限。
    """

    def test_catch_rate_and_the_known_over_count(self):
        import zipfile, re

        bls = _bls()
        docs = _teacher_docx()
        truth = caught = 0
        over = []
        for code, f in sorted(docs.items()):
            xml = zipfile.ZipFile(f).read("word/document.xml").decode("utf-8", "ignore")
            t = xml.count('w:char="F0FE"')
            if not t:
                continue
            try:
                raw = bls.extract_raw(str(f))
            except Exception:
                continue
            c = sum(len(r.get("checked") or []) for r in raw)
            for tb in (r for r in raw if r.get("kind") == "table"):
                for row in tb["rows"]:
                    for cell in row["cells"]:
                        if not cell.get("dup"):      # 合併儲存格會重複出現
                            c += len(cell.get("checked") or [])
            truth += t
            caught += c
            if c > t:
                over.append((code, t, c))

        assert truth >= 300, f"絕對真值只有 {truth} 個 —— 這條在測空氣"
        rate = caught / truth
        assert rate >= 0.95, f"只讀到 {caught}/{truth}（{rate:.0%}），修正前是 31%"

        # ⚠️ 目前有 2 課讀超過真值（巢狀表格重複計數，多 10 個）。
        # 鎖住現況：不准變壞，也不假裝已經是 100%。
        assert len(over) <= 2, (
            f"讀超過真值的課從 2 變成 {len(over)}，重複計數擴大了：{over}"
        )
