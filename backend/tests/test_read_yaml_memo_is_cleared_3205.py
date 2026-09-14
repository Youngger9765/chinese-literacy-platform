"""`_read_yaml` 的快取必須被 `reset_cache()` 清掉。(#3205)

## 為什麼這條比看起來重要

`reset_cache()` 的原始 docstring 寫「Test-only」，**但那不是真的** ——
`app/routes/admin_stories.py` 在管理員改過課文之後會呼叫它。

所以 #3205 加的那個 per-path memo 如果沒被它清掉，症狀是
**管理員改了課文、線上沒變**，而且不會有任何錯誤訊息。
那種缺陷會被當成「快取問題」查很久。

這條直接對著那個症狀斷言：改檔 → reset → 必須讀到新內容。
"""

from __future__ import annotations

import pathlib

import app.services.lesson_uid_loader as loader


def test_memo_returns_the_cached_value_until_reset(tmp_path: pathlib.Path) -> None:
    """正向對照：memo 真的在生效（否則下一條什麼都沒證明）。"""
    p = tmp_path / "x.yml"
    p.write_text("a: 1\n", encoding="utf-8")
    loader.reset_cache()
    assert loader._read_yaml(p) == {"a": 1}

    p.write_text("a: 2\n", encoding="utf-8")
    assert loader._read_yaml(p) == {"a": 1}, "memo 沒生效 —— 那 #3205 的 18 倍改善不存在"


def test_reset_cache_clears_the_memo(tmp_path: pathlib.Path) -> None:
    """改檔 + reset_cache() → 必須讀到新內容。

    這是 `admin_stories.py` 那條路徑依賴的行為。
    """
    p = tmp_path / "y.yml"
    p.write_text("a: 1\n", encoding="utf-8")
    loader.reset_cache()
    assert loader._read_yaml(p) == {"a": 1}

    p.write_text("a: 2\n", encoding="utf-8")
    loader.reset_cache()
    assert loader._read_yaml(p) == {"a": 2}, (
        "reset_cache() 沒清掉 _read_yaml 的快取 —— "
        "管理員改過課文之後線上不會變，而且不會有錯誤訊息"
    )


def test_every_cache_in_this_module_is_reachable_from_reset_cache() -> None:
    """模組裡每一個 lru_cache 都要能被 reset_cache() 清到。

    ⛔ 這條擋的是「以後有人再加一個快取卻忘了掛上去」——
    #3205 自己就差點是那個人。加快取時把它加進 reset_cache，不要加進這裡的豁免。
    """
    cached = {
        name
        for name, obj in vars(loader).items()
        if callable(obj) and hasattr(obj, "cache_clear")
    }
    assert cached, "一個 lru_cache 都沒找到 —— 查法壞了，這條空轉"

    import inspect

    src = inspect.getsource(loader.reset_cache)
    missed = sorted(n for n in cached if f"{n}.cache_clear()" not in src)
    assert not missed, (
        f"這些快取沒有被 reset_cache() 清掉：{missed}。"
        "管理員改課文後線上不會變，而且是靜默的"
    )
