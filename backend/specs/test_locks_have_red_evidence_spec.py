"""每一支跑在 CI 的回歸鎖，都要說得出它是怎麼被證明會咬的。(#2964)

沒看過紅的 gate 是劇場 —— 它跟「什麼都沒測」在畫面上一模一樣（都是綠的）。

這道門不要求回頭補完 95 支既有的債（那會變成一次性的大工程然後沒人做），
它只要求**新加的**必須帶證據：

    具名清單 - 已驗 - grandfathered  必須是空集合

所以把一支鎖加進 `pytest.yml` 而沒有在 `docs/qa/lock-red-evidence.md` 記一筆，
這裡就會紅，訊息會直接告訴你少了哪一支。
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/pytest.yml"
LEDGER = ROOT / "docs/qa/lock-red-evidence.md"

_STEP = "Run regression locks (issue-numbered)"


def _named_locks() -> list[str]:
    lines = WORKFLOW.read_text(encoding="utf-8").split("\n")
    start = next(i for i, l in enumerate(lines) if _STEP in l)
    first = next(i for i in range(start, len(lines)) if lines[i].strip().startswith("tests/"))
    last = first
    while last + 1 < len(lines) and lines[last + 1].strip().startswith("tests/"):
        last += 1
    return [lines[i].strip().rstrip("\\").strip() for i in range(first, last + 1)]


def _ledger_sections() -> tuple[set[str], set[str]]:
    """(已驗過會咬, grandfathered)，都用檔名（不含目錄）。"""
    text = LEDGER.read_text(encoding="utf-8")
    head, _, tail = text.partition("## grandfathered")
    grab = lambda s: set(re.findall(r"`(test_[a-z0-9_]+\.py)`", s))
    return grab(head), grab(tail)


def test_the_parsing_actually_finds_things():
    """正向對照。少了這條，下面每一條都會在空集合上通過。"""
    locks = _named_locks()
    verified, grandfathered = _ledger_sections()
    assert len(locks) >= 50, f"具名清單只解析到 {len(locks)} 支 —— 解析壞了"
    assert len(verified) >= 5, f"帳本的『已驗過』只解析到 {len(verified)} 筆 —— 解析壞了"
    assert len(grandfathered) >= 5, f"grandfathered 只解析到 {len(grandfathered)} 筆 —— 解析壞了"


def test_every_named_lock_says_how_it_was_proven_to_bite():
    locks = {p.split("/")[-1] for p in _named_locks()}
    verified, grandfathered = _ledger_sections()
    missing = sorted(locks - verified - grandfathered)
    assert not missing, (
        "這些鎖跑在 CI，但 docs/qa/lock-red-evidence.md 沒有說它們是怎麼被證明會咬的：\n  "
        + "\n  ".join(missing)
        + "\n\n每一支補一筆到『已驗過會咬』那一節，寫是 mutation 還是復現。"
        "\n⛔ 不要為了讓這條綠而丟進 grandfathered —— 那一節是既有的債，不收新的。"
    )


def test_the_debt_only_shrinks():
    """棘輪：grandfathered 那節只能變少。"""
    _, grandfathered = _ledger_sections()
    assert len(grandfathered) <= 95, (
        f"grandfathered 有 {len(grandfathered)} 筆，比 2026-08-28 的 95 筆還多 —— "
        "那一節只收既有的債，不收新的"
    )
