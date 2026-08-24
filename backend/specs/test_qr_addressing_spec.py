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


def test_single_text_lessons_also_carry_their_codes(rows):
    """單篇課也要有代號 —— 它們也有自己的 slug，也該印短網址。

    `part_rounds` 原本只在多篇課才有值（5/175），其餘 170 課是空的，
    於是 QR 退回長網址：**97% 的課仍然把課號跟路由名印在紙上**。
    退回本身是對的（能掃勝過沒有），但它不該是常態。

    形狀跟多篇課一樣：一筆，`part` 是 None。消費端不必分兩種寫法。
    """
    r = rows["L0001"]
    parts = r.get("part_rounds") or []
    assert len(parts) == 1, f"單篇課應該一筆，實得 {len(parts)}"
    p = parts[0]
    assert p["full_slug"], p
    assert p["key_slug"], p
    assert p["full_slug"] != p["key_slug"], "讀全文跟念順順共用一個代號 —— 兩個 QR 會掃到同一處"


ARTICLE_MODULES = ("full_text_annotate", "classical_text")


def test_every_lesson_that_has_an_article_can_print_a_short_code(rows):
    """不變式，不是魔術數字：**有課文的課，就印得出短網址**。

    課文模組有兩種：一般課 `full_text_annotate`，文言文 `classical_text`。
    只認前者的話，8 課文言文會安靜地退回長網址 —— 沒有錯誤、QR 掃得開，
    只是紙上又把課號跟路由名印了上去。

    ⛔ 這裡刻意不寫「至少 N 課」。數字會隨教材增減漂移，而漂移時
    「少了一課」跟「門檻訂太鬆」分不出來。問的是每一課自己的條件。
    """
    missing = []
    for uid, r in rows.items():
        has_article = any(s.get("module") in ARTICLE_MODULES and s.get("slug")
                          for s in (r.get("manifest_sections") or []))
        can_print = any(p.get("full_slug") or p.get("key_slug")
                        for p in (r.get("part_rounds") or []))
        if has_article and not can_print:
            missing.append(uid)
    checked = sum(1 for r in rows.values()
                  if any(s.get("module") in ARTICLE_MODULES for s in (r.get("manifest_sections") or [])))
    assert checked > 150, f"只有 {checked} 課有課文模組 —— 這條測不到東西"
    assert not missing, f"有課文卻印不出代號: {missing}"


def test_lessons_without_an_article_are_named_not_silently_skipped(rows):
    """沒有課文的課印不出 QR —— 那是對的，但要**點名**。

    無聲跳過的話，某一課哪天掉了課文模組會看起來跟這幾課一樣正常。
    2026-08-25 實測這 6 課：學習單上就沒有讀全文那一節。
    """
    without = sorted(uid for uid, r in rows.items()
                     if not any(s.get("module") in ARTICLE_MODULES
                                for s in (r.get("manifest_sections") or [])))
    assert without == ["L0044", "L0068", "L0070", "L0106", "L0124", "L0136"], without
