"""`story_structure_qa_lib.py` 有兩份複本，不可以再靜默分岔。

2026-08-20 發現的實況：

    scripts/story_structure_qa_lib.py              ← 測試、specs、gate 腳本 import 這份
    backend/app/services/story_structure_qa_lib.py ← 後端 story_structure_lab_service 用這份

兩份當時已經漂移：`app/services` 少了 `is_choice_instruction`，
`verify_interaction_profile_contract` 也是舊版（把每個 `【…】` 都當答案外洩，
指示語「【 單選 】」會被誤報 —— 另一份的註解記著「150 課裡誤報 34 次、真答案 0 次」）。

**後果是最難察覺的那種**：gate 綠燈驗的是 scripts 那份，
學生實際被服務的路徑走的是另一份，兩者可以說不一樣的話而沒有人會知道。
我自己就先改了沒被執行的那一份，測試照樣紅，差點去修一個沒壞的東西。

這條鎖不要求兩個檔逐字節相同（將來可能有正當的差異），
但**兩邊都存在的定義必須一字不差** —— 那才是會造成「gate 與服務端不同調」的部分。
"""
from __future__ import annotations

import ast
import pathlib

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "scripts" / "story_structure_qa_lib.py"
SERVICE = REPO / "backend" / "app" / "services" / "story_structure_qa_lib.py"


def _top_level_defs(path: pathlib.Path) -> dict[str, str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.name: ast.unparse(node)
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    }


def test_both_copies_exist():
    """正向對照：檔案不在就不是『沒有漂移』，是這條鎖沒在測東西。"""
    assert SCRIPTS.is_file(), SCRIPTS
    assert SERVICE.is_file(), SERVICE


def test_shared_definitions_are_identical():
    a = _top_level_defs(SCRIPTS)
    b = _top_level_defs(SERVICE)
    shared = sorted(set(a) & set(b))
    assert len(shared) >= 10, f"只比到 {len(shared)} 個定義 —— 這條鎖大概沒在測東西"

    drifted = [name for name in shared if a[name] != b[name]]
    assert drifted == [], (
        "這些定義在兩份複本裡不一樣，gate 驗的跟服務端跑的會說不同的話："
        f"{drifted}"
    )


def test_neither_copy_is_missing_a_definition_the_other_has():
    a = _top_level_defs(SCRIPTS)
    b = _top_level_defs(SERVICE)
    assert sorted(set(a) - set(b)) == [], "scripts 有、服務端沒有 —— 服務端是舊的"
    assert sorted(set(b) - set(a)) == [], "服務端有、scripts 沒有 —— gate 驗不到它"
