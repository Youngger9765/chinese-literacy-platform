"""圖書館每一張卡都沒有封面 —— 而 175 張封面一直都在。

Young 看著 staging 的圖書館：圖呢？？？之前有圖啊

有。`data/lessons/<uid>/**/assets/thumbnail.webp` 共 175 張，一課一張。
二修建了 `v3/`，封面沒有跟著搬 —— 它們全部留在 `v2/assets/`。

而兩個地方都只看最新版本：

    _thumbnail_name()      只查 v3/assets/  → 175 課全部回 None
    /assets/lesson/{uid}/  versions[-1]     → 同樣指向 v3

所以 `thumbnail_url` 是 None，前端沒有東西可以畫。

⚠️ **我 2026-08-19 早上「修」過這個**：把 `<img>` 改成「沒有 URL 就不 render」。
那讓破圖 icon 消失了 —— 但封面也跟著消失，而且**看起來像是設計如此**。
把缺資料畫成空白，跟把它畫成破圖一樣不誠實，只是比較安靜。
那個守衛要留（真的沒有封面的課仍然不該畫破圖），但它不能是這件事的答案。

封面是課的一部分，不是版本的一部分：v3 沒有自己的封面時，該用課本來就有的那張。
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.lesson_loader import search_lessons  # noqa: E402

LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data" / "lessons"


def _lessons_with_a_cover_on_disk() -> set[str]:
    return {p.parents[2].name for p in LESSONS.glob("*/*/assets/thumbnail.webp")}


def test_the_covers_are_actually_there():
    """前置：沒有這條，下面兩條會在空集合上安靜地通過。"""
    have = _lessons_with_a_cover_on_disk()
    assert len(have) >= 150, f"磁碟上只找到 {len(have)} 張封面 —— 資料變了，下面在測空氣"


def test_every_lesson_with_a_cover_serves_it():
    """磁碟上有封面的課，`thumbnail_url` 就不可以是 None。"""
    have = _lessons_with_a_cover_on_disk()
    missing = [
        l.get("lesson_uid") for l in search_lessons()
        if l.get("lesson_uid") in have and not l.get("thumbnail_url")
    ]
    assert not missing, (
        f"{len(missing)} 課有封面卻沒送出 URL（圖書館會是空的）：{missing[:10]}"
    )


def test_a_lesson_without_a_cover_still_says_none():
    """負向對照：真的沒有封面的課要回 None，不可以編一個 URL 出來。

    少了這條，「一律回一個 URL」也會讓上面那條變綠，而學生會拿到 404。
    """
    have = _lessons_with_a_cover_on_disk()
    invented = [
        l.get("lesson_uid") for l in search_lessons()
        if l.get("lesson_uid") not in have and l.get("thumbnail_url")
    ]
    assert not invented, f"{len(invented)} 課沒有封面卻送出了 URL：{invented[:6]}"
