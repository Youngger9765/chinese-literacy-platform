"""模組 yml 的檔名解析 —— 測試共用（#2916）。

檔名是 `{模組}.{自己的 slug}.yml`，而且一課可能有好幾份（多篇課每篇一份）。
寫死 `{模組}.yml` 的地方在改名後會**讀不到檔**，而多數呼叫端把
「讀不到」當成「這課沒有這個模組」——於是整批測試靜靜地掃 0 課。

⛔ 這支只給測試用。生產程式碼走 `lesson_uid_loader`。
"""
from __future__ import annotations

import pathlib


def module_files(vdir: pathlib.Path, mod: str) -> list[pathlib.Path]:
    """`vdir` 底下這個模組的所有檔（多篇課一篇一份），檔名序。"""
    return sorted(vdir.glob(f"{mod}.*.yml"))


def module_file(vdir: pathlib.Path, mod: str) -> pathlib.Path | None:
    """第一份，沒有就 None。單篇課的情境用這支。"""
    fs = module_files(vdir, mod)
    return fs[0] if fs else None
