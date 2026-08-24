"""QR 定址：每一個 QR 印的是**那一節自己的代號**（#2916）。

一份學習單印三篇課文時，第 2 篇旁邊的念順順 QR 必須掃到第 2 篇的念順順。
印錯的代價是不可回收的：紙已經發到教室了。
"""
from __future__ import annotations

import pytest

from app.services.lesson_indexes import build_all_lessons


@pytest.fixture(scope="module")
def rows():
    return {r.get("lesson_uid"): r for r in build_all_lessons()}


def test_the_corpus_is_there(rows):
    """正向對照 —— 少了它，下面每一條都可能在對空集合做斷言。"""
    assert len(rows) > 150, f"只載到 {len(rows)} 課"


def test_each_part_carries_its_own_section_slugs(rows):
    """每一篇要帶**兩個**代號：讀全文那一節的、念順順那一節的。

    以前只有一個 `slug`，而那是**課文的** slug。拿它當 QR 代號的話，
    三篇的念順順會全部指到讀全文那一節 —— 而且掃得開、頁面打得開。
    """
    r = rows["L0063"]
    parts = r.get("part_rounds") or []
    assert len(parts) == 3, f"L0063 應該三篇，實得 {len(parts)}"
    for p in parts:
        assert p.get("full_slug"), f"{p} 少了讀全文的代號"
        assert p.get("key_slug"), f"{p} 少了念順順的代號"
        # 讀全文那一節的 slug 就是課文自己的 slug（它是被引用的那一個）
        assert p["full_slug"] == p["slug"]
        # 念順順是引用型的，它有自己的身分，不可以跟課文同號
        assert p["key_slug"] != p["slug"], "念順順借用了課文的代號 —— slug 是身分不是引用"


def test_the_three_key_reading_codes_are_all_different(rows):
    codes = [p["key_slug"] for p in rows["L0063"]["part_rounds"]]
    assert len(set(codes)) == 3, codes


def test_codes_are_globally_unique_across_every_lesson(rows):
    """代號是全庫唯一的 —— `/q/{code}` 不帶課號，撞號就是掃到別課。"""
    seen, dup = {}, []
    for uid, r in rows.items():
        for p in (r.get("part_rounds") or []):
            for k in ("full_slug", "key_slug"):
                c = p.get(k)
                if not c:
                    continue
                if c in seen and seen[c] != uid:
                    dup.append((c, seen[c], uid))
                seen[c] = uid
    assert not dup, f"撞號: {dup[:5]}"
    assert len(seen) > 10, f"只收集到 {len(seen)} 個代號 —— 這條測不到東西"
