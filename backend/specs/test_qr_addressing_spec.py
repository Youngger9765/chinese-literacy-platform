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


#: 帳本裡沒有課文那一節的課 —— 它們印不出全文 QR。⛔ 只能變少（棘輪）。
#:
#: 2026-08-25 寫下來時有 6 課，當時用 `==` 寫死。#3011 修好其中 5 課之後
#: （L0044/L0068/L0070/L0106 的課文檔一直在硬碟上、課文也真的服務得出來
#: 577–1650 字，只是學習單目錄沒印「讀全文」那個大題所以帳本沒收；L0124 是
#: 整份目錄沒抽出來）這條就**因為情況變好而變紅**——那是判準的形狀錯了，
#: 不是有人弄壞東西。改成棘輪：缺陷回來一樣會叫，修好了不會被當成壞事。
#: L0124 已在 #3011 修好（它的 `sections_present` 本來是空的），所以從天花板移除 ——
#: 棘輪留 slack 就不會咬。實測現值就是這 5 課。
ARTICLELESS_CEILING = {"L0044", "L0068", "L0070", "L0106", "L0136"}


def test_lessons_without_an_article_are_named_not_silently_skipped(rows):
    """沒有課文的課印不出 QR —— 那是對的，但要**點名**。

    無聲跳過的話，某一課哪天掉了課文模組會看起來跟這幾課一樣正常。
    """
    without = {uid for uid, r in rows.items()
               if not any(s.get("module") in ARTICLE_MODULES
                          for s in (r.get("manifest_sections") or []))}
    #: 正向對照：這個掃描要真的看得到課（不然空集合什麼都不證明）
    assert len(rows) >= 150, f"只掃到 {len(rows)} 課，掃描本身壞了"
    extra = without - ARTICLELESS_CEILING
    assert not extra, f"這幾課的帳本沒有課文那一節，全文 QR 會靜靜地不出：{sorted(extra)}"


def test_classical_lessons_get_their_passage_code_too(rows):
    """文言文的朗讀計時也要有代號（#2916）。

    文言文的課文模組叫 `classical_text`，而發配 slug 時 `text_ref` 只從
    `full_text_annotate` 那一族收 —— 於是文言文**每一節都沒有 text_ref**。
    歸戶靠 text_ref 的話，這 10 課的朗讀計時印不出代號，QR 安靜退回長網址。

    一課只有一篇課文時，歸屬沒有歧義：其餘每一節都屬於它。
    """
    classical = [uid for uid, r in rows.items()
                 if any(s.get("module") == "classical_text" for s in (r.get("manifest_sections") or []))]
    assert len(classical) >= 8, f"只找到 {len(classical)} 課文言文 —— 這條測不到東西"
    with_key = []
    for uid in classical:
        r = rows[uid]
        has_kr = any(s.get("module") == "key_reading" for s in (r.get("manifest_sections") or []))
        if not has_kr:
            continue
        with_key.append(uid)
        p = (r.get("part_rounds") or [{}])[0]
        assert p.get("key_slug"), f"{uid} 有朗讀計時卻沒有代號"
        assert p["key_slug"] != p.get("full_slug"), f"{uid} 朗讀計時借用了課文的代號"
    assert with_key, "沒有一課文言文有朗讀計時 —— 這條測不到東西"


def test_single_article_lessons_attach_every_section_to_it(rows):
    """一課只有一篇課文時，其餘每一節都歸它 —— 不論有沒有寫 text_ref。

    有寫的照寫的走；沒寫的（文言文、以及任何舊資料）也不該掉出去。
    """
    checked = missing = 0
    for uid, r in rows.items():
        arts = [s for s in (r.get("manifest_sections") or [])
                if s.get("module") in ARTICLE_MODULES and s.get("slug")]
        if len(arts) != 1:
            continue
        has_kr = any(s.get("module") == "key_reading" for s in (r.get("manifest_sections") or []))
        if not has_kr:
            continue
        checked += 1
        if not (r.get("part_rounds") or [{}])[0].get("key_slug"):
            missing += 1
    assert checked > 100, f"只驗到 {checked} 課 —— 這條測不到東西"
    assert missing == 0, f"{missing} 課的念順順沒有代號"


def test_no_printed_code_points_at_a_page_a_guest_cannot_read(rows):
    """會**印在紙上**的每一個代號，訪客都要看得到內容（#2916）。

    這條問的是交付面，不是資料面：資料裡的代號可以比印出來的多，
    但印出去的那些收不回來。

    2026-08-25 抽樣走 QR 時，文言文的 `/q/{代號}` 轉到 `classical-text`，
    而那個 step 不在訪客白名單裡 → 掃進去是登入牆；它的朗讀計時頁
    則因為 `key_reading` 是 null 而空白。兩者都不是交付缺陷 ——
    後台對文言文兩種碼都不印（實測 10/10 課）。這條鎖住那個「不印」，
    免得哪天有人放寬印製規則卻沒補訪客支援。
    """
    from app.services.slug_index import _MODULE_TO_STEP
    # 前端 PUBLIC_LEARNING_STEPS 的鏡像。⛔ 改那邊要改這邊 ——
    # 兩份會分岔，但分岔時這條會紅，而不是學生撞到登入牆。
    GUEST_OK = {"full-text-annotate", "key-passage-reading"}

    def delivers_full(g):
        try:
            n = int(str(g))
        except (TypeError, ValueError):
            return False
        return 4 <= n <= 7

    printed, bad = 0, []
    for uid, r in rows.items():
        for p in (r.get("part_rounds") or []):
            for kind, slug, gate in (
                ("全文", p.get("full_slug"), delivers_full(r.get("grade")) and p.get("has_full")),
                ("重點", p.get("key_slug"), p.get("has_key")),
            ):
                if not (slug and gate):
                    continue
                printed += 1
                mod = next((s.get("module") for s in (r.get("manifest_sections") or [])
                            if s.get("slug") == slug), None)
                step = _MODULE_TO_STEP.get(mod or "")
                if step not in GUEST_OK:
                    bad.append((uid, kind, slug, mod, step))
    assert printed > 100, f"只有 {printed} 個會印出的碼 —— 這條測不到東西"
    assert not bad, f"這些印出來的碼訪客打不開: {bad[:5]}"


def test_classical_lessons_print_no_codes_yet(rows):
    """文言文目前一個碼都不印 —— 訪客頁還不支援文言文（開放項）。

    點名而不是靜默：哪天訪客頁支援了、或有人放寬印製規則，這條會紅，
    提醒去確認兩件事有沒有一起做。
    """
    classical = [uid for uid, r in rows.items()
                 if any(s.get("module") == "classical_text"
                        for s in (r.get("manifest_sections") or []))]
    assert len(classical) == 10, f"文言文課數變了: {len(classical)}"
    for uid in classical:
        p = (rows[uid].get("part_rounds") or [{}])[0]
        assert not p.get("has_key"), f"{uid} 開始印重點碼了 —— 訪客頁支援文言文了嗎？"


def test_grades_four_to_seven_keep_their_full_text_code(rows):
    """4–7 年級有課文的課，全文 QR 不可以消失（#2916 回歸）。

    `_parts_summary` 判 `has_full` 時讀的是 loader 層的 `l["paragraphs"]`，
    而那一層是 None —— 段落是 row 用 `_flat_paragraphs(_body(l))` 攤出來的。
    於是 106 課裡有 104 課的 `has_full` 是 False，全文 QR 整批不見，
    後台清單那一欄變成空字串。**沒有錯誤、清單照樣產出、少了 104 個碼。**

    判準用 row 自己的 `paragraphs` —— 那是真正會送到學生面前的那一份。
    """
    def grade_num(r):
        try:
            return int(str(r.get("grade")))
        except (TypeError, ValueError):
            return None

    g47 = [r for r in rows.values() if (n := grade_num(r)) and 4 <= n <= 7]
    assert len(g47) > 90, f"只找到 {len(g47)} 課 4–7 年級 —— 這條測不到東西"
    # ⚠️ 判準是「**帳本印了讀全文這一節**」，不是「row 有段落」。
    #    L0044/L0068/L0070/L0106 的抽取檔在硬碟上，但學習單根本沒印那一節
    #    （sections_present 只有閱讀聚光燈）—— 紙上沒有的東西不該有 QR。
    #    用「有段落」當判準會把這 4 課判成缺陷，那是問錯問題。
    with_text = [r for r in g47
                 if any(s.get("module") in ARTICLE_MODULES and s.get("slug")
                        for s in (r.get("manifest_sections") or []))]
    assert len(with_text) > 90, f"只有 {len(with_text)} 課帳本印了讀全文 —— 這條測不到東西"
    missing = [r["lesson_uid"] for r in with_text
               if not any(p.get("has_full") for p in (r.get("part_rounds") or []))]
    assert not missing, (
        f"{len(missing)} 課有課文卻沒有全文碼: {missing[:8]}\n"
        "has_full 判準要跟 row 的 paragraphs 同源")


def test_every_delivered_code_is_a_slug_not_a_path(rows):
    """會印出去的每一個碼，都要有 slug 可用 —— 沒有 slug 就沒有短網址。

    owner 2026-08-25：「我希望每一個 QR code 都是一組 QR slug url」。
    退回長網址是無聲的：QR 掃得開、頁面對，只是把課號跟路由名印在紙上了。
    """
    bad = []
    for uid, r in rows.items():
        for p in (r.get("part_rounds") or []):
            if p.get("has_full") and not p.get("full_slug"):
                bad.append((uid, "全文"))
            if p.get("has_key") and not p.get("key_slug"):
                bad.append((uid, "重點"))
    total = sum(1 for r in rows.values() for p in (r.get("part_rounds") or [])
                if p.get("has_full") or p.get("has_key"))
    assert total > 140, f"只有 {total} 個可交付的節 —— 這條測不到東西"
    assert not bad, f"這些節要印碼卻沒有 slug: {bad[:8]}"
