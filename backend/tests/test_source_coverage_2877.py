"""原稿有多少內容沒被任何 yml 收走（#2877）。

## 這道門補的洞

第九道門問「大題有沒有著落」，這一道問「那個大題**裡面的東西**抽全了嗎」。
見證對帳只覆蓋 6 種題號型模組（490 / 1844 份），
其餘 **1354 份沒有任何門在問「該有的都抽進去了嗎」**。

## 🔴 量法踩過的兩個坑

**① 整段比對 → 涵蓋率假低到 49%。** 原稿一行是 `(10)鷹眼：在網球…`，
而 yml 拆成 `word` + `definition` 兩欄 —— 整段當然找不到。改成貪婪吃片段
之後是 85%。⚠️ 49% 很接近一半，第一反應是「XML 重複了兩次」，
查過才知道重複只佔 12–14%。**先驗工具再下判斷。**

**② 不去重** → 文字方塊的內容在 `<w:t>` 流裡出現兩次，會被算兩份。

## ⛔ 為什麼是棘輪不是門檻

剩下的 15% 混著真缺口（老師的題目解析、聚光燈引導語）與量法雜訊
（語詞框存 list、原稿是頓號串）。訂 90% 會對一半的課誤報，
而**會誤報的門最後會被關掉**。棘輪擋的是「某個改動讓抽取收得更少」。
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
GATE = REPO / "scripts" / "source_coverage_gate.py"
BASE = REPO / "specs" / "modules" / "source-coverage-baseline.json"


def test_gate_is_wired_into_ci():
    """⛔ 門建了沒插電比沒有門更糟。查完整呼叫行，不只查檔名。"""
    ci = (REPO / "specs" / "run-ci.sh").read_text(encoding="utf-8")
    called = [ln.strip() for ln in ci.split("\n")
              if "source_coverage_gate.py" in ln and not ln.strip().startswith("#")]
    assert called, "run-ci.sh 沒有跑這道門"
    assert any(ln.endswith("source_coverage_gate.py") for ln in called), \
        f"這道門被加了參數，可能沒有真的在驗：{called}"


def test_baseline_exists_and_covers_the_corpus():
    """用**數量**斷言 —— 基準只有幾課跟有 175 課長得一樣綠。"""
    assert BASE.is_file(), "沒有基準檔，棘輪就不存在"
    base = json.loads(BASE.read_text(encoding="utf-8"))
    lessons = {p.parent.parent.name
               for p in (REPO / "backend" / "data" / "lessons").glob("L*/v3/lesson.yml")}
    assert len(base) >= 174, f"基準只有 {len(base)} 課，語料庫有 {len(lessons)} 課"
    assert not (lessons - set(base)), f"這些課不在基準裡：{sorted(lessons - set(base))[:6]}"


def test_gate_says_it_did_not_verify_when_the_source_is_missing():
    """CI 沒有 private/ 時要**明講沒驗到**，⛔ 不可以只印一個綠燈。"""
    src = GATE.read_text(encoding="utf-8")
    assert "這不是通過，是沒驗到" in src, "沒有『讀不到原稿 ≠ 通過』的說明"
    assert "一課都沒量到" in src, "沒有『0 課不算通過』的護欄"


def test_gate_uses_a_ratchet_not_a_threshold():
    """⛔ 不可以改成絕對門檻。

    剩下的未涵蓋字裡混著真缺口與量法雜訊，訂 90% 會對一半的課誤報 ——
    而會誤報的門最後會被關掉。
    """
    src = GATE.read_text(encoding="utf-8")
    assert "棘輪" in src, "沒寫它是棘輪"
    assert "不用絕對門檻" in src or "不能拿一個絕對門檻" in src, \
        "沒寫明為什麼不用門檻"


def test_greedy_fragment_matching_not_whole_paragraph():
    """🔴 整段比對會把「欄位拆分」誤判成「沒抽到」。

    這是把涵蓋率從 49% 修到 85% 的那一步。改回整段比對，
    數字會掉一半而資料完全沒變。
    """
    # ⚠️ 只查「原始碼裡有沒有 MIN_RUN / 貪婪」太寬 —— 把賦值改名照樣命中
    #    （mutation 實測沒咬。今天判準太寬第六次）。改成**驗行為**。
    import importlib.util
    spec = importlib.util.spec_from_file_location("scg", GATE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    # 原稿一行 = 題號 + 語詞 + 定義；yml 拆成兩欄分別存
    para = "(10)鷹眼:在網球、羽球等球類運動中,用以追蹤記錄球的路徑的電腦輔助系統。"
    blob = "鷹眼\n在網球、羽球等球類運動中,用以追蹤記錄球的路徑的電腦輔助系統。"
    un = m._uncovered(para, blob)
    assert un <= 10, (   # (10) 與冒號這些結構標記本來就不在 yml，約 7 字
        f"欄位拆分的內容被算成 {un} 字未涵蓋 —— 不是貪婪片段比對了。"
        "整段比對會讓涵蓋率從 85% 假掉到 49%。"
    )

    # ⚠️ 上面那個案例其實**分不出**整段比對與片段比對 —— 吃掉 `(10)鷹眼:`
    #    之後剩下的尾巴剛好整段命中，兩種做法等價（mutation 實測是無效的）。
    #    這一個才分得出來：內容被拆成兩塊、中間隔著別的東西，
    #    **只有片段比對接得回來**。
    para2 = "捶打胸膛以腳跺地形容極為悲憤或悔恨"
    blob2 = "捶打胸膛以腳跺地\n完全無關的另一個欄位\n形容極為悲憤或悔恨"
    un_split = m._uncovered(para2, blob2)
    assert un_split == 0, (
        f"被拆成兩塊的內容算了 {un_split} 字未涵蓋 —— 不是片段比對了。"
        "yml 幾乎每個模組都把一行原稿拆成多欄，這會讓涵蓋率整體假掉一半。"
    )

    # 反向：真的沒抽到的內容要算得出來
    un2 = m._uncovered("這一整段原稿上有但是任何一個 yml 裡都沒有的內容", "完全無關的東西")
    assert un2 >= 20, f"真的沒抽到的內容只算了 {un2} 字 —— 這道門會漏"

    assert "49%" in GATE.read_text(encoding="utf-8"), \
        "沒有記下那個坑（下一個人會再踩一次）"


@pytest.mark.skipif(not (REPO.parent / "chinese-literacy-platform" / "private").is_dir()
                    and not (REPO / "private").is_dir(),
                    reason="讀不到原稿（CI 沒有 private/）")
def test_gate_currently_passes():
    r = subprocess.run([sys.executable, str(GATE)], cwd=REPO,
                       capture_output=True, text=True, timeout=1800)
    assert r.returncode == 0, f"涵蓋率棘輪紅了：\n{r.stdout[-1500:]}"
