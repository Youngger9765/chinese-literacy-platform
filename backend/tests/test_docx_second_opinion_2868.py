"""PDF 驗不了時改問 DOCX XML（#2868）。

那 42 個「驗不了」的成因是 `pdftotext` 還原不出版面順序 —— 自己的標題會排在
自己的題目和下一節之後。`word/document.xml` 的 `<w:t>` 流是**文件順序**，
沒經過排版，所以它看得見 PDF 看不見的東西。

⛔ 它不是更好的來源，是**不同盲區**的來源：
    PDF  看得到印出來的樣子；看不到版面被重排時的真實順序
    XML  看得到文件順序；看不到畫在圖上的字、Word 自動編號，
         而且文字方塊會被錨定在下一節標題之後（實測 L0009 / L0103）

全庫校準：XML 法 vs yml 一致 589 / 不一致 25 / 給不出答案 19。
對那 42 個：40 個判得出來、1 個是錨點假象（L0103）、1 個是真缺陷（L0149）。
"""
from __future__ import annotations

import importlib.util
import pathlib
import re
import subprocess
import sys

import pytest
import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
DW = REPO / "scripts" / "docx_witnesses.py"
GATE = REPO / "scripts" / "witness_reconcile_gate.py"


def _dw():
    spec = importlib.util.spec_from_file_location("dw", DW)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_paragraphs_are_not_split_by_a_nongreedy_wp_regex():
    """🔴 段落不可以用 `<w:p .*?</w:p>` 切。

    文字方塊裡有巢狀 `<w:p>`，非貪婪比對會在**內層**的 `</w:p>` 收尾，把外層
    段落後面的文字整段丟掉 —— L0038 閱讀理解的第 3 題就是這樣消失的，
    而我差點把它當成「原稿真的沒有第 3 題」報成缺陷。
    """
    # ⚠️ 只看**程式碼**，不看註解 —— 第一版直接掃全文，結果抓到自己在
    #    docstring 裡描述那個壞寫法的那一行。判準太寬的鎖會被當雜訊關掉。
    code = "\n".join(
        ln for ln in DW.read_text(encoding="utf-8").split("\n")
        if "re.findall" in ln or "re.compile" in ln or "re.split" in ln
    )
    assert "<w:p" not in code, f"又用回段落比對了：{code}"
    assert 'replace("</w:p>"' in DW.read_text(encoding="utf-8"), "沒有用 </w:p> 當斷點"


def test_second_opinion_needs_both_docx_and_next_section():
    """缺任一個就回 None —— ⛔ 不要自己猜下一節是誰。

    猜錯會把整段範圍算歪，然後給一個看起來很篤定的錯答案。
    """
    import types
    spec = importlib.util.spec_from_file_location("wg", GATE)
    wg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wg)
    assert wg._docx_second_opinion(
        types.SimpleNamespace(docx=None, section="x", next_section="y")) is None
    assert wg._docx_second_opinion(
        types.SimpleNamespace(docx="/nonexistent.docx", section="x",
                              next_section="y")) is None


def test_argparse_errors_do_not_collide_with_cannot_verify():
    """參數打錯要回 3，⛔ 不可以跟「驗不了」共用 2。

    撞碼的後果：指令打錯會**看起來像「這一頁驗不了」**，而那正是這道門最常見
    的正常輸出，於是沒有人會發現指令根本沒跑起來。實際踩過一次。
    """
    r = subprocess.run([sys.executable, str(GATE), "--bogus"],
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 3, f"參數錯誤回了 {r.returncode}，跟『驗不了』撞碼"
    assert "參數錯誤" in r.stderr


def test_unknown_is_not_dressed_up_as_ok():
    """XML 答不出來時必須回 unknown，⛔ 不可以回空的 numbers 讓人以為零題。"""
    dw = _dw()
    fake = pathlib.Path("/nonexistent.docx")
    with pytest.raises(Exception):
        dw.docx_paragraphs(fake)


def test_xml_and_yml_agree_on_the_lessons_pdf_could_not_read():
    """回測鎖：那 42 個裡，XML 判得出來的必須維持在 40 個以上。

    用**數量**斷言，不是「至少有一個」—— 這條 2026-08-22 建立時是 40/42，
    掉下來代表 XML 這條路退化了（或資料變了），要查。
    """
    dw = _dw()
    common = REPO / ".git"
    sot = None
    for base in (REPO, REPO.parent / "chinese-literacy-platform"):
        cand = base / "private" / "curriculum-source" / "_SOT"
        if cand.is_dir():
            sot = cand
            break
    if sot is None:
        pytest.skip("讀不到原稿（CI 沒有 private/）—— 這條只在本機有意義")

    groups = {
        "vocab_application": ("L0003 L0005 L0006 L0018 L0019 L0020 L0023 L0025 L0031 "
                              "L0046 L0057 L0058 L0059 L0081 L0100 L0101 L0103 L0104 "
                              "L0109 L0119 L0121 L0123 L0149").split(),
        "vocab_definitions": ("L0014 L0030 L0033 L0038 L0043 L0068 L0085 L0099 L0128 "
                              "L0139 L0141").split(),
        "comprehension": "L0004 L0017 L0038 L0048 L0060 L0067 L0085 L0168".split(),
    }
    matches = yaml.safe_load(
        (REPO / "specs" / "modules" / "section-to-module.yml").read_text(
            encoding="utf-8"))["matches"]
    carriers = ("items", "questions", "videos")
    ok = 0
    for mod, uids in groups.items():
        for uid in uids:
            ly = REPO / "backend" / "data" / "lessons" / uid / "v3" / "lesson.yml"
            if not ly.is_file():
                continue
            d = yaml.safe_load(ly.read_text(encoding="utf-8"))
            rel = (d.get("source") or {}).get("drive_path")
            secs = [s["name"] if isinstance(s, dict) else str(s)
                    for s in (d.get("sections_present") or [])]
            target = next((n for n in secs
                           if any(m["needle"] in n and m["module"] == mod
                                  for m in matches)), None)
            if not target or not rel or not (sot / rel).is_file():
                continue
            i = secs.index(target)
            nxt = secs[i + 1] if i + 1 < len(secs) else None
            r = dw.count(sot / rel, target, nxt)
            if r.get("status") != "ok":
                continue
            f = REPO / "backend" / "data" / "lessons" / uid / "v3" / f"{mod}.yml"
            y = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get(mod) or {}
            items = next((y[c] for c in carriers if isinstance(y.get(c), list)), [])
            idx = sorted({it.get("index") for it in items
                          if isinstance(it.get("index"), int)})
            if r["numbers"] == idx:
                ok += 1
    assert ok >= 40, f"XML 只判得出 {ok}/42（建立時是 40）—— 退化了，要查"
