"""每一個 import 都要 import 得到（#2916）。

刪掉一支沒人呼叫的函式時，我用 AST 掃了 `app/` `scripts/` `specs/` 確認它是死的 ——
**漏掉 `tests/`**，那裡還有一行 import 它。本機十道門全綠，CI 的 Backend Tests
才炸出 ImportError。

「我掃過了」跟「我掃全了」在輸出上一模一樣，這是這一輪反覆出現的形狀。
所以改成不靠我選目錄：整個 repo 掃一遍。
"""
from __future__ import annotations

import ast
import importlib
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
SKIP = ("/node_modules/", "/.git/", "__pycache__", "/.venv/", "/site-packages/")


def _py_files():
    for f in REPO.rglob("*.py"):
        if not any(x in str(f) for x in SKIP):
            yield f


def test_the_scan_sees_the_repo():
    """正向對照 —— 少了它，下面那條可能在掃空集合。"""
    n = sum(1 for _ in _py_files())
    assert n > 300, f"只掃到 {n} 個 .py —— 掃描範圍壞了"


@pytest.mark.parametrize("module", [
    "app.services.lesson_layer_loaders",
    "app.services.lesson_indexes",
    "app.services.lesson_loader",
    "app.services.slug_index",
])
def test_every_name_imported_from_our_modules_exists(module):
    """全 repo 掃：有人 `from <module> import X`，X 就必須真的在。

    ⛔ 不要只掃 `app/` —— tests/ 與 scripts/ 也 import 我們的模組，
    而它們同樣會在 CI 被收集。
    """
    mod = importlib.import_module(module)
    missing = []
    for f in _py_files():
        try:
            tree = ast.parse(f.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.ImportFrom) and n.module and n.module.endswith(module.rsplit(".", 1)[-1]):
                for a in n.names:
                    if a.name != "*" and not hasattr(mod, a.name):
                        missing.append(f"{f.relative_to(REPO)}:{n.lineno} → {a.name}")
    assert not missing, f"{module} 少了這些被 import 的名字:\n  " + "\n  ".join(missing)
