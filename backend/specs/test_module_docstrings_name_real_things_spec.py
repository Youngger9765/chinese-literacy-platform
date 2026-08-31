"""模組 docstring 的 Public API 清單裡，每一個名字都要真的存在（#2712 清理時發現）。

`lesson_layer_loaders.py` 的 docstring 列著 **五支根本不存在的函式**
（`load_layer1_lessons` / `load_layer2_lessons` / `build_layer2_enrichment_index` /
`load_curriculum_manifest`）跟一個不存在的常數（`ENRICHMENT_FIELDS`）——
Layer-2 在一修（#2683）被封存刪除，函式跟著移掉，docstring 原封不動留著。

⚠️ 我第一次只拿掉那兩支 layer2 的，因為 `grep "^def load_layer1_lessons"` 回 0
看起來像「其餘還在」—— 但**正向對照也回 0**，所以那個 0 什麼都不證明。
改用 `hasattr(module, name)` 直接問模組，才知道五支全都不在。
**這條鎖用的就是 hasattr，不是 grep。**

⛔ 判準刻意窄：只認 docstring 裡「Public API」那一段、四空格縮排、
   看起來像識別字的行首名字。不做語意判斷 —— 會誤擋的門最後會被關掉。
"""
import importlib
import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]

#: 掃這些服務模組（有 Public API 清單的）
MODULES = [
    "app.services.lesson_layer_loaders",
    "app.services.lesson_code_normalization",
]


def _declared_names(doc: str) -> list[str]:
    """docstring 裡「Public API」那一段列出的名字。"""
    if not doc:
        return []
    m = re.search(r"Public API[^\n]*\n(.*?)(?:\n\S|\Z)", doc, re.S)
    if not m:
        return []
    out = []
    for line in m.group(1).split("\n"):
        n = re.match(r"^\s{4}([A-Za-z_][A-Za-z0-9_]*)", line)
        if n:
            out.append(n.group(1))
    return out


@pytest.mark.parametrize("modname", MODULES)
def test_every_name_in_the_public_api_list_exists(modname):
    """⛔ docstring 宣傳不存在的 API = 下一個人照著 import 就 AttributeError。"""
    mod = importlib.import_module(modname)
    ghosts = sorted(n for n in _declared_names(mod.__doc__ or "") if not hasattr(mod, n))
    assert not ghosts, (
        f"{modname} 的 docstring 列了這些不存在的名字：{ghosts}\n"
        "→ 改掉 docstring（或把函式加回來）。判準是 hasattr，不是 grep —— "
        "grep 的 0 可能只是 pattern 寫錯。")


def test_the_detector_actually_reads_something():
    """正向對照：真的抓到名字，否則上面那條恆真。"""
    mod = importlib.import_module("app.services.lesson_layer_loaders")
    names = _declared_names(mod.__doc__ or "")
    assert len(names) >= 3, f"只抓到 {names} —— 解析可能壞了"


def test_the_detector_would_catch_a_ghost():
    """正向對照之二：合成一個不存在的名字，要抓得到。"""
    fake = "Public API:\n    build_intro()  — real\n    totally_not_a_real_name()  — ghost\n"
    got = _declared_names(fake)
    assert "totally_not_a_real_name" in got, f"抓不到合成的幽靈名字：{got}"
