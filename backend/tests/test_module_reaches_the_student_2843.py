"""schema 過了，學生看得到嗎（#2843）。

Young 2026-08-22 問的那句：「schema 對的 yml 可以滿足 HTML render 嗎」

**答案是不保證，而且實測就有斷的。**

抽取 → schema → API → 前端，這條鏈上 schema 只管第二段。
一個模組可以完整抽出來、完全通過 schema、對帳門全綠，
然後 **API 根本不送它**、或前端根本不讀它 —— 學生什麼都看不到，而且沒有任何錯誤。

## 實測斷掉的兩個

| 模組 | 課數 | 現況 |
|---|---:|---|
| `vocab_review` | 150 | ✅ #2860 已接通：API 送出 143 課的教師版格子（10×10 grid + 每個詞的座標路徑），<br>`VocabWordSearch` 用它而不是自己生。7 課沒有 grid，維持生成並標記 `gridSource: 'generated'` |
| `resources` | 148 | 🔴 API 不送、前端不讀 |

這條鎖不修那兩個（那要改 API 與前端，是另一張票）。
它做的是**把現況釘住**：不准再多，而且修好一個就要更新基準。

⛔ 為什麼不寫 `== 0`：那兩個現在就是斷的，`== 0` 會恆紅，
紅久了沒人看 —— 那時第三個斷掉也不會有人發現。
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SCHEMAS = REPO_ROOT / "specs" / "modules" / "schemas"
FRONTEND = REPO_ROOT / "frontend" / "src"

#: 不是給學生看的模組 —— 版面家具或整課屬性，沒有 render 是正常的
NOT_RENDERED = {"lesson", "metadata", "errata", "goal_box", "notes"}

#: 🔴 已知斷掉的。修好一個就從這裡拿掉（並更新上面的說明）。
#: ⛔ 不要為了讓測試變綠而往這裡加東西 —— 加之前先確認它真的該斷。
KNOWN_UNREACHED: dict[str, str] = {
    # vocab_review 於 #2860 接通：API 送出 143 課的教師版格子，
    # VocabWordSearch 用它而不是自己生。移除這一項是這條反向鎖要求的
    # —— 它就是為了不讓豁免清單爛在這裡。
    #
    # resources 於 #2916 接通，這條反向鎖自己抓到的：前台的步驟順序改成
    # 照帳本（`manifest_sections`）走之後，147 課裡有 147 課的
    # `step_sequence` 帶著 `knowledge-station`，而 KnowledgeStationPage
    # 一直都在。它以前走不到不是因為沒有畫面，是因為沒有人把它排進序列。
    # 實測（2026-08-25）：147/147。
}


def _has_frontend_consumer(module: str) -> bool:
    pattern = re.compile(rf"\b{re.escape(module)}\b")
    for path in FRONTEND.rglob("*.ts*"):
        if "__tests__" in str(path):
            continue
        try:
            if pattern.search(path.read_text(encoding="utf-8")):
                return True
        except Exception:
            continue
    return False


@pytest.fixture(scope="module")
def modules() -> list[str]:
    return sorted(p.stem.replace(".schema", "") for p in SCHEMAS.glob("*.schema.json"))


def test_the_scan_found_schemas_and_frontend(modules):
    """掃描前提 —— 任一邊掃不到，下面都會恆綠。"""
    assert len(modules) >= 20, f"只載到 {len(modules)} 份 schema"
    assert len(list(FRONTEND.rglob("*.tsx"))) >= 50, "前端掃不到檔"


def test_no_new_module_becomes_unreachable(modules):
    """🔴 有 schema 的模組，前端要找得到消費端 —— 已知斷的除外。"""
    unreached = [
        m for m in modules
        if m not in NOT_RENDERED and m not in KNOWN_UNREACHED and not _has_frontend_consumer(m)
    ]
    assert not unreached, (
        "以下模組有 schema，但前端找不到任何消費端 —— 抽出來學生看不到：\n"
        + "\n".join(f"  {m}" for m in unreached)
        + "\n\n這是「抽到了但下游沒接」，schema 與對帳門都抓不到它。"
          "\n接上前端，或（確認它真的不該 render 後）加進 NOT_RENDERED 並寫明原因。"
    )


def test_known_gaps_are_still_actually_broken(modules):
    """反向：已知斷掉的若其實已經接好，這條要紅。

    少了它，KNOWN_UNREACHED 會變成一份沒人整理的豁免清單 ——
    接好了卻還掛在上面，下一個人會以為它還是壞的。
    """
    fixed = [m for m in KNOWN_UNREACHED if _has_frontend_consumer(m)]
    assert not fixed, (
        "以下模組已經有前端消費端了，請從 KNOWN_UNREACHED 移除：\n"
        + "\n".join(f"  {m}（原因曾記為：{KNOWN_UNREACHED[m]}）" for m in fixed)
    )


def test_the_known_gap_count_does_not_grow():
    """數量斷言 —— 斷掉的模組只准變少。"""
    assert len(KNOWN_UNREACHED) <= 2, (
        f"斷掉的模組從 2 個變成 {len(KNOWN_UNREACHED)} 個。"
        "⛔ 不要為了讓測試變綠往 KNOWN_UNREACHED 加東西。"
    )
