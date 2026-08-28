"""學習單印的每一個大題都要有著落（#2876）。

## 這道門補的洞

前面的門問「抽出來的東西對不對」（形狀 / 逐字 / 題號），
沒有一道問「**該有的東西在不在**」—— 一整個大題被漏抽，前面全是綠的，
因為它們只檢查已經存在的東西。

## 建立時的實際狀態

1467 個大題全部有著落，但**建之前有 10 個沒有** ——
而那 10 個不是內容不見了，是**對照表少了名字**：

    「文章重點整理」 6 課 → 內容在 keypoints.yml（表裡只有「文章重點表」，差一個字）
    「閱讀接力」     3 課 → 住在 multi_text_parts[].reading_relay（跨篇，沒有頂層 yml）
    「綜合練習」     1 課 → 內容在 spotlight.yml（L0029 實測逐字確認）

⚠️ 差一個字就讓 6 課的那一節在完整性檢查眼裡消失，而**完全沒有症狀**。
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
GATE = REPO / "scripts" / "section_completeness_gate.py"
MAP = REPO / "specs" / "modules" / "section-to-module.yml"


def test_gate_passes_on_the_current_corpus():
    r = subprocess.run([sys.executable, str(GATE)], cwd=REPO,
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, f"大題完整性門紅了：\n{r.stdout}\n{r.stderr}"
    assert "SECTION_COMPLETENESS=PASS" in r.stdout


def test_gate_is_wired_into_ci():
    """⛔ 門建了沒插電比沒有門更糟。"""
    # ⚠️ 只查檔名太寬 —— 把那一行改成 `... --help` 照樣命中，門實際上沒在跑。
    #    （mutation 實測沒咬。今天判準太寬第五次。）查完整的呼叫行。
    ci = (REPO / "specs" / "run-ci.sh").read_text(encoding="utf-8")
    called = [ln.strip() for ln in ci.split("\n")
              if "section_completeness_gate.py" in ln and not ln.strip().startswith("#")]
    assert called, "run-ci.sh 沒有跑這道門"
    assert any(ln.endswith("section_completeness_gate.py") for ln in called), (
        f"這道門在 run-ci.sh 裡被加了參數，可能沒有真的在驗：{called}"
    )
    wf = (REPO / ".github" / "workflows" / "spec-check.yml").read_text(encoding="utf-8")
    assert "specs/run-ci.sh" in wf, "spec-check.yml 不再跑 run-ci.sh —— 上面那條就白鎖了"


def test_the_three_late_additions_are_still_mapped():
    """那 10 個缺口的三個名字要留在對照表裡。

    ⛔ 少一個字就會讓那幾課的大題再度消失，而**不會有任何症狀** ——
    內容還在，只是沒有人對得起來。
    """
    doc = yaml.safe_load(MAP.read_text(encoding="utf-8"))
    needles = {m["needle"]: m["module"] for m in doc["matches"]}
    assert needles.get("文章重點整理") == "keypoints", "「文章重點整理」的對應不見了"
    # ⚠️ 2026-08-28（#2964）改寫。原本斷言「綜合練習 → spotlight」——
    #    那條對應**是刻意刪掉的，因為它是錯的**：L0029 的 spotlight.yml
    #    `section_no_printed` 是「八」（品格聚光燈），綜合練習是「七」。
    #    接回去會讓同一份 spotlight 被兩列指到，看起來像「重複模組沒拆」，
    #    實際上是兩個不同大題被塞進同一個模組（對照表裡有完整說明）。
    #    改成鎖住「刻意不接」這個狀態，不准有人把它接回任何既有模組。
    assert "綜合練習" not in needles, (
        f"「綜合練習」又被接到 {needles.get('綜合練習')} 了 —— "
        "它的形狀跟現有 24 個模組都不一樣（連連看＋兩題單選＋一題跨篇單選），"
        "接回任何既有模組都會製造重複指向。見 section-to-module.yml 的說明。")
    unmapped = {x["needle"] for x in doc.get("no_match", []) or doc.get("unmapped", []) or []}
    if unmapped:
        assert "綜合練習" in unmapped, "「綜合練習」應該登記在「刻意無對應」那一區"
    inside = {x["needle"]: x for x in doc.get("lives_inside", [])}
    assert "閱讀接力" in inside, "「閱讀接力」的 lives_inside 登記不見了"
    assert "multi_text_parts" in inside["閱讀接力"]["inside"]


def test_lives_inside_entries_say_where_and_why():
    """`lives_inside` 不可以只寫名字 —— 要寫住在哪、為什麼沒有自己的 yml。

    否則下一個人看到它只會以為「這一節被跳過了」。
    """
    doc = yaml.safe_load(MAP.read_text(encoding="utf-8"))
    for x in doc.get("lives_inside", []):
        assert x.get("inside"), f"{x.get('needle')} 沒寫住在哪"
        assert x.get("why"), f"{x.get('needle')} 沒寫為什麼沒有自己的 yml"


def test_gate_refuses_to_pass_when_it_checked_nothing():
    """0 個大題被檢查不是通過。"""
    src = GATE.read_text(encoding="utf-8")
    assert "一個大題都沒檢查到" in src, "沒有『0 受檢不算通過』的護欄"


def test_gate_says_what_it_does_not_guarantee():
    """⛔ 「有對應的 yml」不等於「那一節的內容都抽進去了」。

    一節 8 題只抽了 6 題，這道門是綠的。要寫明白，否則
    「1467 個大題全部有著落」會被讀成「抽取完整」。
    """
    src = GATE.read_text(encoding="utf-8")
    assert "不保證什麼" in src or "不等於" in src, "沒寫明它不保證什麼"
