"""QR 短網址 `/q/{slug}` 的轉址契約（#2916）。

紙上只印代號，目的地是我們這邊可以改的設定。
所以這份鎖的是「代號解得開、而且解到對的地方」——
一旦某個 slug 解錯，教室裡那疊紙全部指到錯的東西，而且收不回來。
"""
from __future__ import annotations

import pytest

from app.services.slug_index import resolve, slug_index, target_path


@pytest.fixture(scope="module")
def idx():
    return slug_index()


def test_index_is_not_empty(idx):
    """正向對照：先證明這張表真的建得起來。

    少了這條，下面每一條「解得開」都可能是在對一張空表做斷言。
    """
    assert len(idx) > 1000, f"只索引到 {len(idx)} 個 slug —— 表建壞了"


def test_every_slug_is_unique_and_lowercase(idx):
    """slug 是身分。撞號等於兩個大題共用一個代號，紙本無法分辨。"""
    bad = [s for s in idx if not s.islower() or not s.isalnum()]
    assert not bad, f"形狀不對的 slug: {bad[:10]}"


def test_multi_text_rounds_resolve_to_different_places():
    """L0063 三篇的念順順是三個不同的 QR，不可以掃到同一個地方。

    這是這整套東西存在的理由：一份學習單印了三篇課文，
    老師在第 2 篇旁邊貼的 QR 掃出來必須是第 2 篇。
    """
    slugs = ["yprak", "9a7x4", "ajy9w"]
    entries = [resolve(s) for s in slugs]
    assert all(entries), f"解不開: {[s for s, e in zip(slugs, entries) if not e]}"
    assert all(e["module"] == "key_reading" for e in entries)
    paths = [target_path(e) for e in entries]
    assert len(set(paths)) == 3, f"三個 QR 掃到同一個地方: {paths}"


def test_the_round_marker_is_the_sections_own_slug():
    """`?p=` 帶的是**這一節自己的 slug**，不是它引用的課文。

    前端 `useCurrentStepId` 把 `?p=` 接成步驟 key（`key-passage-reading#9a7x4`），
    再由 `articleSlugForStep` 用帳本查出它要哪一篇課文。
    這裡若直接帶課文的 slug，那個查找會落空 —— 而落空的結果是
    「退回頂層資料」，也就是**安靜地顯示第 1 篇**，畫面上看不出錯。
    """
    e = resolve("9a7x4")
    assert e is not None
    assert target_path(e).endswith("?p=9a7x4"), target_path(e)


def test_single_text_lessons_carry_no_round_marker():
    """單篇課不該有 `?p=` —— 沒有輪次可分，多帶一個參數只會讓網址更脆。"""
    singles = [e for e in slug_index().values()
               if e["module"] == "key_reading" and not e.get("text_ref")]
    assert singles, "找不到任何單篇課的念順順 —— 這條測不到東西"
    assert all("?p=" not in target_path(e) for e in singles[:20])


def test_unknown_slug_resolves_to_none():
    assert resolve("zzzzz") is None
    assert resolve("") is None
    assert resolve("  ") is None


# ─────────────────────────────────────────────────────────────────────────────
# `/q/{slug}` 端點本身
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def test_scanning_a_real_code_redirects_to_that_section(client):
    r = client.get("/q/9a7x4", follow_redirects=False)
    assert r.status_code == 307, r.status_code
    assert r.headers["location"] == "/learn/20063/key-passage-reading?p=9a7x4"


def test_the_three_rounds_land_in_three_different_places(client):
    locs = [client.get(f"/q/{s}", follow_redirects=False).headers.get("location")
            for s in ("yprak", "9a7x4", "ajy9w")]
    assert len(set(locs)) == 3, locs


def test_redirect_is_temporary_not_permanent(client):
    """301 會被瀏覽器永久快取 —— 那等於把目的地焊進使用者的機器，
    而這一層存在的理由就是目的地要可以改。"""
    assert client.get("/q/9a7x4", follow_redirects=False).status_code == 307


def test_unknown_code_says_so_instead_of_going_blank(client):
    r = client.get("/q/qqqqq", follow_redirects=False)
    assert r.status_code == 404
    assert r.json()["error"] == "unknown_code"
    assert r.json()["message"], "空狀態要說得出話 —— 拿著紙的是老師和學生"


def test_malformed_code_is_rejected_before_lookup(client):
    for bad in ("../etc/passwd", "ABC", "1", "z" * 40):
        r = client.get(f"/q/{bad}", follow_redirects=False)
        assert r.status_code == 404, f"{bad} → {r.status_code}"


def test_multi_text_full_text_codes_also_land_in_different_places():
    """一課多篇時，**讀全文**的三個 QR 也必須各自到自己那一篇。

    2026-08-25 真的跑 curl 才抓到：三個代號全部轉到
    `/learn/20063/full-text-annotate`，沒有 `?p=`，也就是三張不同的紙
    掃出來都是第 1 篇。判斷「要不要帶輪次」原本看的是 `text_ref` 有沒有值，
    而課文那一節本來就沒有 `text_ref`（它是被引用的那一個）——
    於是條件對念順順成立、對讀全文永遠不成立。

    上一條 `test_the_round_marker_is_the_sections_own_slug` 只驗了念順順，
    所以這個洞從那條測試底下走過去了。**同一族的東西要整族驗，不是挑一個。**
    """
    slugs = ["p3kud", "4uee3", "7wavn"]
    paths = [target_path(resolve(s)) for s in slugs]
    assert len(set(paths)) == 3, f"三篇的讀全文掃到同一個地方: {paths}"
    for s, p in zip(slugs, paths):
        assert p.endswith(f"?p={s}"), p


def test_every_multi_text_lesson_has_all_distinct_destinations():
    """全庫掃一遍：任何一課裡，兩個不同的代號不可以指到同一個地方。

    挑一課驗過不算 —— 這一輪的錯就是「驗了念順順、沒驗讀全文」。
    """
    from collections import defaultdict
    by_lesson = defaultdict(list)
    for slug, e in slug_index().items():
        by_lesson[e["lesson_uid"]].append((slug, target_path(e)))
    clashes = []
    for uid, items in by_lesson.items():
        seen = defaultdict(list)
        for slug, p in items:
            seen[p].append(slug)
        for p, ss in seen.items():
            if len(ss) > 1:
                clashes.append((uid, p, ss))
    assert len(by_lesson) > 150, f"只掃到 {len(by_lesson)} 課 —— 這條測不到東西"
    assert not clashes, f"{len(clashes)} 處撞目的地，例: {clashes[:4]}"


def test_every_module_that_has_a_step_can_be_reached_by_code(idx):
    """帳本裡每一種有線上畫面的模組，都要解得開代號。

    2026-08-25 抽樣走 QR 才發現文言文的 `classical_text` 不在對照表裡：
    那 10 課的課文代號回 404，而 404 說的是「查不到這個代號」——
    看起來像紙印錯，實際上是我們少一列。
    """
    from app.services.lesson_indexes import build_all_lessons
    from app.services.slug_index import _MODULE_TO_STEP
    seen = {}
    for l in build_all_lessons():
        # ⚠️ `step_sequence` 的元素帶輪次後綴（`key-passage-reading#9a7x4`）。
        #    拿裸 step id 去比會全部對不上 —— 我第一版就是這樣，量出
        #    「166 課的讀全文沒有畫面」，而那 166 課的頁面明明開得好好的。
        steps = {k.split("#", 1)[0] for k in (l.get("step_sequence") or [])}
        for sec in l.get("manifest_sections") or []:
            mod, slug = sec.get("module"), sec.get("slug")
            if not mod or not slug:
                continue
            step = _MODULE_TO_STEP.get(mod)
            # 這個模組在這一課真的有畫面嗎？沒有的話不強求代號解得開。
            if step and step in steps:
                seen.setdefault(mod, []).append(slug)
    # 點名，不用門檻數字：某個模組哪天整族掉出去，這裡會直接顯示少了誰。
    assert set(seen) == {
        "full_text_annotate", "key_reading", "vocab_definitions", "vocab_application",
        "keypoints", "comprehension", "spotlight", "vocab_review", "resources",
        "classical_text", "sentence_matching", "word_matching", "self_challenge",
    }, f"有畫面的模組清單變了: {sorted(seen)}"
    unresolvable = {m: ss[:2] for m, ss in seen.items() if not resolve(ss[0])}
    assert not unresolvable, f"這些模組的代號解不開: {unresolvable}"


def test_classical_lessons_resolve(idx):
    """文言文的課文與朗讀計時都要解得開。"""
    for slug, want in (("jp6dx", "classical-text"), ("9ry3u", "key-passage-reading")):
        e = resolve(slug)
        assert e, f"/q/{slug} 解不開"
        assert e["step"] == want, (slug, e["step"])
