"""
Lesson in-memory indexes: build and expose the singleton lesson collections.

Extracted from lesson_loader.py (Issue #1889).

Public API:
    build_all_lessons()  — load + merge + sort all lessons from both layers
    build_indexes()      — construct all lookup dicts from a lesson list

These are called once at module load time by lesson_loader.py (and directly
by tests that need to verify index construction in isolation).
"""

import os
import re
from typing import Any

from app.services.spotlight_figure_images import merge_spotlight_images
from app.services.spotlight_v2_loader import (
    load_spotlight_v2,
    should_suppress_legacy_strategy_exercise,
)


def _reapply_spotlight_images(lesson: dict) -> None:
    """Layer-2 enrichment overwrites images[] — re-merge spotlight figure assets."""
    code = lesson.get("lesson_code") or lesson.get("grade_code") or ""
    spotlight_v2 = lesson.get("spotlight_v2") or load_spotlight_v2(code, lesson.get("title"))
    if not spotlight_v2:
        return
    lesson["spotlight_v2"] = spotlight_v2
    lesson["images"] = merge_spotlight_images(lesson.get("images") or [], spotlight_v2)


def _meta(l: dict) -> dict:
    m = l.get("metadata")
    return m if isinstance(m, dict) else {}


def _key_reading(l: dict) -> dict | None:
    """The 重點朗讀 passage, shaped for KeyReadingSchema.

    `key_reading.yml` only exists for a lesson whose anchor paragraph was confirmed
    against the body, so its presence is the check — there is no verdict to re-test
    here.
    """
    rounds = _key_readings(l)
    return rounds[0] if rounds else None


def _ledger_round_order(l: dict) -> list[str]:
    """帳本裡課文出現的順序 —— 一切「第幾篇」的排序都以它為準（#2916）。"""
    out: list[str] = []
    for s in l.get("manifest_sections") or []:
        if s.get("module") == "full_text_annotate" and s.get("slug"):
            if s["slug"] not in out:
                out.append(s["slug"])
    return out


#: 哪些模組「就是課文本身」——它們沒有 `text_ref`，因為它們是被引用的那一個。
#: 一般課是 `full_text_annotate`；文言文的課文叫 `classical_text`（8 課）。
#: 漏掉後者的話那 8 課印不出短網址，而且症狀是「安靜地退回長網址」。
ARTICLE_MODULES = ("full_text_annotate", "classical_text")


def _section_slugs_by_article(l: dict) -> dict[str, dict[str, str]]:
    """{課文 slug: {模組: 那一節自己的 slug}} —— 出處是帳本（#2916）。

    slug 是身分，`text_ref` 是引用。課文那一節沒有 `text_ref`（它就是被引用的
    那一個），所以用它自己的 slug 當 key；其餘各節用它 `text_ref` 指到的課文歸戶。

    跨篇的節（`text_ref` 是清單）不屬於任何單一篇，這裡不收。
    """
    secs = l.get("manifest_sections") or []
    arts = [s.get("slug") for s in secs
            if s.get("module") in ARTICLE_MODULES and s.get("slug")]
    # 一課只有一篇課文時，歸屬沒有歧義：其餘每一節都屬於它，寫不寫 `text_ref` 都一樣。
    #
    # 這條不是方便，是**必要**：發配 slug 時 `text_ref` 只從 `full_text_annotate`
    # 那一族收，而文言文的課文模組叫 `classical_text` —— 那 10 課因此
    # 每一節都沒有 `text_ref`，光靠 `text_ref` 歸戶的話它們的朗讀計時
    # 印不出代號，QR 安靜退回長網址（2026-08-25 抽樣驗到）。
    lone = arts[0] if len(arts) == 1 else None
    out: dict[str, dict[str, str]] = {}
    for sec in secs:
        mod, slug, ref = sec.get("module"), sec.get("slug"), sec.get("text_ref")
        if not mod or not slug:
            continue
        if mod in ARTICLE_MODULES:
            art = slug
        elif isinstance(ref, str) and ref:
            art = ref
        else:
            # 多篇課而這一節沒說屬於誰 → 不猜（跨篇的節就是這樣）。
            art = lone
        if not art:
            continue
        out.setdefault(art, {}).setdefault(mod, slug)
    return out


def _parts_summary(l: dict) -> list[dict]:
    """每一篇的輕量摘要，給清單用（#2916）。

    後台的 QR 清單要「一篇一列」，但它是從 `/api/stories`（清單）抓的，
    而篇次資訊本來只在單課詳情裡 —— 為了 175 課各打一次詳情太貴，
    所以在清單就帶著這一份摘要。
    """
    # 帳本才知道哪一節是哪一節的身分 —— 這裡不自己推。
    own = _section_slugs_by_article(l)
    rounds = l.get("repeat_rounds") or {}
    if not rounds:
        # 單篇課也回一筆（#2916）。它也有自己的代號，也該印短網址。
        # 這裡原本直接回 []，於是 170/175 課的 QR 退回長網址 ——
        # 也就是 97% 的紙本仍然把課號跟路由名印上去。形狀跟多篇一致，
        # 消費端不必分兩種寫法。
        art = next((x.get("slug") for x in (l.get("manifest_sections") or [])
                    if x.get("module") in ARTICLE_MODULES and x.get("slug")), None)
        if not art:
            return []
        mods = own.get(art, {})
        kr = l.get("key_reading") if isinstance(l.get("key_reading"), dict) else {}
        return [{
            "slug": art,
            "part": None,
            # ⚠️ 判準要跟 row 的 `paragraphs` **同源**（`_flat_paragraphs(_body(l))`）。
            #    這裡本來讀 `l["paragraphs"]`，而 loader 那一層是 None ——
            #    段落是 row 攤出來的。結果 4–7 年級 106 課裡 104 課的
            #    `has_full` 是 False，全文 QR 整批消失，後台那一欄變空字串。
            #    沒有錯誤、清單照樣產出，只是少了 104 個碼。
            "has_full": bool(_flat_paragraphs(_body(l))),
            "has_key": bool((kr or {}).get("passage")),
            "full_slug": mods.get("full_text_annotate") or mods.get("classical_text") or art,
            "key_slug": mods.get("key_reading"),
        }]
    out = []
    for slug, mods in rounds.items():
        fta = (mods or {}).get("full_text_annotate") or {}
        kr = (mods or {}).get("key_reading") or {}
        out.append({
            "slug": slug,
            "part": kr.get("part") or fta.get("part") or fta.get("part_no"),
            "has_full": bool(fta.get("paragraphs") or (fta.get("body") or {}).get("paragraphs")),
            "has_key": bool(kr.get("passage")),
            # QR 印的是**那一節自己的代號**，不是課文的。
            # 只帶 `slug`（課文的）的話，三篇的念順順 QR 會全部指到讀全文那一節 ——
            # 而且掃得開、頁面打得開，錯得完全沒有徵兆。
            "full_slug": own.get(slug, {}).get("full_text_annotate") or slug,
            "key_slug": own.get(slug, {}).get("key_reading"),
        })
    # 順序照帳本，不自己排（#2916）——帳本是唯一的順序來源。
    order = _ledger_round_order(l)
    out.sort(key=lambda r: order.index(r["slug"]) if r["slug"] in order else len(order))
    return out


def _manifest_sections(l: dict) -> list[dict]:
    """帳本，送給前端的那一層（#2916）。

    ## 一份東西，一個名字，一種形狀，三層

        _manifest.yml                  帳本本體（檔案）—— 唯一真相
        lesson["manifest_sections"]    同一份，載進記憶體（loader 層）
        row["manifest_sections"]       同一份，送給前端（API 層）

    **同名不夠，欄位也要同名。** 這一層本來叫 `worksheet_section_order`，
    而且會把 `no` 改名成 `number`、`module` 改名成 `type`。兩件事各自看起來都很小，
    合起來就是：同一份東西有兩個名字、兩種形狀，「到底哪一份才算數」沒有答案。
    2026-08-25 統一成一個名字之後，兩層寫進同一個 key，形狀不同的那份直接把另一份蓋掉 ——
    L0063 的每一列 `type` 和 `number` 全變成 None，而**沒有任何錯誤**。
    改名把潛伏的分岔變成看得見的碰撞，這是好事；解法是讓形狀也一致，不是把名字改回去。

    所以這裡不做任何改寫：帳本印什麼欄位，前端就收到什麼欄位
    （`no` / `name` / `module` / `part` / `slug` / `file` / `text_ref` / `pages`）。
    前端用 WORKSHEET_TYPE_ALIASES 把 `module`（`key_reading`）對到 step id
    （`key-passage-reading`）。

    沒有 module 的列（例如 L0029 的「綜合練習」，還沒有自己的模組）**照樣送出去**，
    由前端跳過 —— `stepSequenceFromManifest` 遇到沒有 `module` 的列本來就 `continue`。
    帳本誠實記錄紙上印了什麼；要不要顯示是消費端的事，不是帳本的事。
    """
    return list(l.get("manifest_sections") or [])


def _key_readings(l: dict) -> list[dict]:
    """所有的 重點朗讀 —— **一輪一個，不是一課一個**（#2916）。

    一份學習單印兩篇文章時，念順順也印兩次，各自有自己的 ☞ 起點與字數。
    兩份都帶 slug（`key_reading.fqwda.yml` / `key_reading.n3qxn.yml`），
    `slug` 就是定址用的 key：`?p=fqwda` 圈起那一輪。

    單篇課回一筆、`slug` 是 None —— 形狀跟多輪課一樣，消費端不必分兩種寫法。
    """
    def _one(kr, slug):
        if not isinstance(kr, dict) or not kr.get("passage"):
            return None
        return {
            "slug": slug,
            "part": kr.get("part"),
            "passage": kr["passage"],
            "start_text": kr.get("start_text"),
            "extent_chars": kr.get("extent_chars"),
            "source": kr.get("source") or "docx-extract",
        }

    out = []
    rounds = l.get("repeat_rounds") or {}
    if rounds:
        # 多輪課：一輪一筆。⛔ 不要再把頂層那份也加進來 —— 頂層就是其中一輪
        # （照帳本挑的第一份），加了會變成 4 筆而實際只有 3 個念順順（實測）。
        for slug, mods in rounds.items():
            got = _one((mods or {}).get("key_reading"), slug)
            if got:
                out.append(got)
    else:
        base = _one(l.get("key_reading"), None)
        if base:
            out.append(base)
    # 篇次是老師與學生看到的順序；沒有 part 的（單篇課）排在最前面
    # 同上：照帳本。單篇課只有一筆，順序無意義但仍走同一條路。
    order = _ledger_round_order(l)
    out.sort(key=lambda r: order.index(r.get("slug")) if r.get("slug") in order else len(order))
    return out


#: 文體 → the four categories the API contract allows. Mirrors the table in
#: `scripts/extract_lesson_metadata.py`; kept here because the genre now comes from
#: the worksheet at serve time rather than from the spreadsheet at build time.
_GENRE_TO_CATEGORY = {
    "記敘文": "Fable", "抒情文": "Fable",
    "說明文": "Science", "説明文": "Science",
    "議論文": "History", "論說文": "History", "文言文": "History",
    "應用文": "Daily",
}


def _category_for(genre: str | None, meta: dict) -> str:
    g = genre or ""
    if g in _GENRE_TO_CATEGORY:
        return _GENRE_TO_CATEGORY[g]
    # Compound labels — 「說明/議論」, 「記敘抒情文」, 「記敘文/科學故事」. Eight lessons
    # name two forms; the first is the primary one, and the four-way category axis has
    # nowhere to put a hybrid anyway.
    for form, cat in _GENRE_TO_CATEGORY.items():
        stem = form.rstrip("文")
        if g.startswith(stem):
            return cat
    return meta.get("category") or ""


def _video_links(l: dict) -> list[dict] | None:
    """知識補給站's videos, as the `{title, url}` pairs `api.ts` declares.

    The URLs are in the master spreadsheet and the TITLES are in the worksheet — two
    sources, neither of which has both. Where they list the same number of videos the
    pairing is taken positionally and the student sees what the video is called;
    where they disagree the count itself is the warning, so the titles are dropped and
    a placeholder is used rather than confidently labelling video 2 with video 1's name.

    109 lessons agree, 17 differ, 31 have URLs with no worksheet list, 3 the reverse.
    """
    res = _unwrap(_sections(l).get("resources"), "resources")
    # 二修的模組檔叫 `videos`；一修那側叫 `items`。兩個都認，否則名字對不上時
    # 這裡不會報錯，只會靜靜地把每支片名降級成「影片 N」——學生看得到連結，
    # 但不知道那支在講什麼。沒有紅字的失敗最難發現。
    videos = res.get("videos") or res.get("items") or []

    # URL 有兩個來源：一修總表的 `video_links`（舊路），以及模組檔自己帶的 `url`
    # （2026-08-19 由 scripts/migrate_legacy_video_urls.py 從一修接回來，每筆帶
    # `url_source` 可稽核）。二修的 v3 metadata 沒有 `video_links`，所以只走舊路
    # 的話 19 課 39 支影片全部回 None，學生看到「這篇課文目前沒有知識補給站影片」。
    urls = _meta(l).get("video_links") or []
    if not urls and videos:
        urls = [v.get("url") for v in videos]

    if not urls or not any(urls):
        # 有影片但一支 URL 都沒有（QR 還沒解碼的 5 課）：仍然把片名送出去。
        # 「有兩支影片，連結在紙本的 QR code」跟「沒有影片」是兩件不同的事，
        # 而後者是騙人的。
        if videos:
            return [
                {"title": v.get("title") or f"影片 {i + 1}", "url": None,
                 "source": v.get("source"), "duration": v.get("duration")}
                for i, v in enumerate(videos)
            ]
        return None

    titled = len(videos) == len(urls)
    return [
        {
            "title": (videos[i].get("title") if titled else None) or f"影片 {i + 1}",
            "url": u,
            **({"source": videos[i].get("source"), "duration": videos[i].get("duration")}
               if titled else {}),
        }
        for i, u in enumerate(urls)
    ]


def _spotlight_or_none(l: dict) -> dict | None:
    # loader 已經把模組檔的外層拆掉，所以 `l["spotlight"]` 就是內容本身。
    # 這裡再 .get("spotlight") 一次會拿到 None —— 聚光燈整節消失且不報錯。
    sp = _unwrap(l.get("spotlight"), "spotlight")
    if not isinstance(sp, dict) or sp.get("error") or not sp.get("blocks"):
        return None
    return sp


def _sections(l: dict) -> dict:
    """v3 起每個大題是自己的模組，不再擠在 `sections` 裡。

    這個 helper 把新舊兩種形狀收斂成同一個 dict，讓下面幾個讀取器不必各自判斷。
    ⚠️ 不是相容層 —— loader 已經不讀 v2 的 `sections.yml`；這裡收的是 v3 攤在
    lesson 頂層的模組。留 `sections` 這條只為了讓還沒重抽的課回傳空 dict 而不是炸開。
    """
    merged = {
        k: l[k]
        for k in ("vocab_definitions", "vocab_application", "comprehension", "resources")
        if isinstance(l.get(k), dict)
    }
    if merged:
        return merged
    return (l.get("sections") or {}) if isinstance(l.get("sections"), dict) else {}


def _unwrap(mod: Any, key: str) -> dict:
    """模組檔的外層是 `{lesson_uid, version_id, section_no, <key>: {...}}`。"""
    if not isinstance(mod, dict):
        return {}
    inner = mod.get(key)
    return inner if isinstance(inner, dict) else mod


def _rounds_with_flat_paragraphs(l: dict) -> dict:
    """`repeat_rounds`，每一輪多一個攤平好的 `paragraphs`（#2916）。

    形狀跟 API 頂層的 `paragraphs` 一致，前端換篇時直接取用，不必知道
    原始資料是 `[{idx,text}]`。
    """
    rounds = l.get("repeat_rounds") or {}
    if not rounds:
        return {}
    out = {}
    for slug, mods in rounds.items():
        m = dict(mods or {})
        paras = _flat_paragraphs(m.get("full_text_annotate"))
        if paras:
            m["paragraphs"] = paras
        # 前端讀的是 `fill_in_blank` / `vocab_bank`，不是 `vocab_application`。
        # 只覆蓋同名欄位的話這一格永遠退回頂層 —— 三篇共用一份題目（#2930）。
        va = m.get("vocab_application")
        if va:
            m["fill_in_blank"] = _cloze_from(l, va) or None
            m["vocab_bank"] = _vocab_bank_from(l, va) or None
        out[slug] = m
    return out


def _flat_paragraphs(fta: dict | None) -> list[str]:
    """課文段落攤成純字串陣列 —— API 的 `paragraphs` 是這個形狀。

    抽取出來的原始形狀是 `[{idx, text}, ...]`。攤平**只能有一份實作**：
    2026-08-25 我一度在前端另寫一次，形狀猜錯（以為是字串陣列），
    讀全文那一頁直接當掉。要換篇的是同一份資料，攤平也該是同一支。
    """
    return [
        (x.get("text") if isinstance(x, dict) else x)
        for x in ((fta or {}).get("paragraphs") or ((fta or {}).get("body") or {}).get("paragraphs") or [])
    ]


def _body(l: dict) -> dict:
    """一 讀全文-做記號。

    v3 起模組叫 `full_text_annotate` —— `body` 是 HTML 詞彙，說不出它在學習單上
    是哪一大題，跟 #2641 那組「step id 沒說出中文 label 的事」是同一個病。
    """
    return _unwrap(l.get("full_text_annotate"), "full_text_annotate") or (
        l.get("body") if isinstance(l.get("body"), dict) else {}
    )


def _vocabulary_from(l: dict) -> list[dict]:
    """三 語詞我最棒 → the shape StoryDetail's vocabulary field expects."""
    items = _unwrap(_sections(l).get("vocab_definitions"), "vocab_definitions").get("items") or []
    return [{"word": i["word"], "definition": i["definition"]} for i in items if i.get("word")]


def _cloze_from(l: dict, section: dict | None = None) -> list[dict]:
    """四 語詞應用 → the LEGACY fill-in-blank shape the frontend requires.

    `frontend/src/services/api.ts` keeps only items matching `{sentence, answer}`
    where `answer` is a letter into `vocab_bank`; anything else is filtered out and
    the step falls back to its empty state. Emitting `{question, options[]}` — the
    shape that reads naturally from the worksheet — meant the step either showed
    nothing or crashed on `.sentence`.
    """
    # `section` 有值時就用那一輪的（#2930）。一課多篇時模組在帳本裡叫
    # `vocab_application`、送到前端卻叫 `fill_in_blank` —— 名字對不上，
    # 覆蓋那層就漏掉它，三篇的語詞應用於是長得一模一樣。
    sec = _unwrap(
        section if section is not None else _sections(l).get("vocab_application"),
        "vocab_application",
    )
    # v2 寫 `questions[{text,answer}]`；v3 照學習單寫 `items[{stem,answer}]`。
    rows = sec.get("items") or sec.get("questions") or []
    bank = _vocab_bank_from(l, section)
    out = []
    for q in rows:
        sentence = q.get("stem") or q.get("text") or ""
        answer = q.get("answer")
        if not (sentence and answer):
            continue
        primary, alts = _normalise_answer_code(str(answer), bank)
        row = {"sentence": sentence, "answer": primary, "_schema": "legacy"}
        if alts:
            row["accepted_answers"] = [primary, *alts]
        out.append(row)
    out.extend(_sub_exercise_cloze(sec))
    return out


#: 語詞應用底下的「子練習」（◎小試身手 / ◎牛刀小試 / ◎詞義辨識 / 相似詞應用），
#: 每一個都自成一組題目與選項，跟主題目的 A–G 不同組。
SUB_EXERCISE_SKIP = {"items", "questions", "videos", "notes"}


def _is_option_code(a: str) -> bool:
    """A–Z（含全形）才算代號；其餘一律當語詞。"""
    return len(a) == 1 and ("A" <= a.upper() <= "Z" or "Ａ" <= a <= "Ｚ")


def _sub_exercise_cloze(sec: dict) -> list[dict]:
    """語詞應用底下的子練習 → 同一套 legacy 填空形狀。

    🔴 **這一段之前不存在，於是那些題目印在學習單上、抽進了 yml、
    卻從來沒有到過學生面前。** 實測 staging：L0149 學生拿到 6 題
    （原稿 8 題）、L0066 拿到 7 題（原稿 8 題）。

    ⚠️ 資料是忠實的 —— 我一度以為是抽取漏了，還為此開了兩張缺陷票
    （#2867 #2869），兩張都是假的。真正的斷點在**這裡**：
    `rows = sec.get("items")` 只讀頂層，子練習整包沒人讀。
    這跟見證對帳門犯的是同一個錯，差別是門只會誤報，這裡會讓學生少做題。

    子練習的選項**自成一組**，不能沿用主題目的 A–G：

        L0122 ◎牛刀小試      自己就有 `option_bank` {A: 肆虐, B: 蔓延}
        L0066 相似詞應用      沒有 bank，答案是語詞（象徵/意味著/代表）
        L0149 ◎詞義辨識      沒有 bank，`glossary` 給了那兩個詞

    後兩種在這裡合成一組 bank（答案本身當選項），把答案改寫成代號 ——
    元件的判分就是「點到的代號 == answer」，這樣不必改判分邏輯。

    ⛔ 一題有多個空格的（L0027 ◎小試身手，`answers` 是 list）**不處理** ——
    那是不同題型，硬塞進單選框只會做出一個學生答不對的題目。
    """
    out: list[dict] = []
    for key, sub in sec.items():
        if key in SUB_EXERCISE_SKIP or not isinstance(sub, dict):
            continue
        rows = sub.get("items")
        if not isinstance(rows, list) or not rows:
            continue
        rows = [r for r in rows if isinstance(r, dict)]
        # 多空格題：跳過，且不要假裝它不存在（見上方 ⛔）
        if any("answers" in r for r in rows):
            continue

        declared = sub.get("option_bank")
        if isinstance(declared, dict) and declared:
            bank = {str(k): str(v) for k, v in declared.items()}
        else:
            # 沒有印出來的選項組 → 用「這幾題的答案」當選項。
            # 順序優先照 glossary（原稿印的順序），否則照題號順序。
            words: list[str] = []
            for g in (sub.get("glossary") or []):
                w = g.get("word") if isinstance(g, dict) else None
                if isinstance(w, str) and w not in words:
                    words.append(w)
            for r in rows:
                a = r.get("answer")
                # ⚠️ 判「代號 vs 語詞」用**是不是 A–Z**，不是字數 ——
                #    單字語詞（「蹭」）用字數判會被當成代號然後整題丟掉。
                if isinstance(a, str) and not _is_option_code(a) and a not in words:
                    words.append(a)
            if not words:
                continue
            bank = {chr(ord("A") + i): w for i, w in enumerate(words)}

        word_to_code = {v: k for k, v in bank.items()}
        for r in rows:
            sentence = r.get("stem") or r.get("text") or ""
            answer = r.get("answer")
            if not (sentence and isinstance(answer, str)):
                continue
            code = answer if answer in bank else word_to_code.get(answer)
            if not code:
                # 答案既不是這組的代號、也不是這組的語詞 —— ⛔ 不猜。
                # 送出去只會做出一個永遠答不對的題目。
                continue
            out.append({
                "sentence": sentence,
                "answer": code,
                "options": bank,          # ← 這一題自己的選項組
                "_schema": "legacy",
                "_sub_exercise": sub.get("title") or key,
            })
    return out


def _normalise_answer_code(answer: str, bank: dict) -> tuple[str, list[str]]:
    """答案代號 → 對得上 `option_bank` 的鍵，外加同樣算對的其他代號。

    兩個實際踩到的形狀（2026-08-19 全庫掃描）：

    **全形字母。** L0056 九題的答案是 `Ｂ Ｄ Ｃ Ｆ Ｈ`，而 `option_bank` 的鍵是
    半形 `A B C`。字面比對一題都對不上 ⇒ **整課九題判不了分**，而且畫面上
    看不出異常：選項照常顯示、學生照常選，只是永遠不對。

    **一題兩個答案。** L0012 第 3 題的答案是 `'A/B'`，`answer_note` 寫著
    「原稿手寫「A/B」，兩個答案都算對」。抽取忠實記錄了，消費端把整串當成一個代號查，
    查無 ⇒ 那一題同樣永遠不對。

    兩個都不是抽取錯 —— 抽取記下的就是學習單上的樣子。是這一層沒認得。
    """
    raw = answer.strip()
    # 全形 Ａ-Ｚ / ａ-ｚ → 半形
    half = "".join(
        chr(ord(ch) - 0xFEE0) if "Ａ" <= ch <= "Ｚ" or "ａ" <= ch <= "ｚ" else ch
        for ch in raw
    )
    parts = [p.strip().upper() for p in half.replace("、", "/").replace(",", "/").split("/") if p.strip()]
    if not parts:
        return raw, []
    # 認得的代號優先；一個都認不得就原樣回傳（不要靜靜地換成別的東西）
    known = [p for p in parts if p in bank] if bank else parts
    if not known:
        return half if half in bank or not bank else raw, []
    return known[0], known[1:]


def _vocab_bank_from(l: dict, section: dict | None = None) -> dict:
    """四 語詞應用's options, as the letter → word map the cloze exercise resolves
    its answers against. Without it every answer letter matches nothing."""
    # `section` 有值時就用那一輪的（#2930）。一課多篇時模組在帳本裡叫
    # `vocab_application`、送到前端卻叫 `fill_in_blank` —— 名字對不上，
    # 覆蓋那層就漏掉它，三篇的語詞應用於是長得一模一樣。
    sec = _unwrap(
        section if section is not None else _sections(l).get("vocab_application"),
        "vocab_application",
    )
    # 一課可能有多個代號表（L0072 的語詞應用分成 A-C 與 D-G 兩組），全部合起來 ——
    # 只取第一組會讓後半題的答案代號查無對應。
    banks = sec.get("option_banks")
    if isinstance(banks, list):
        merged: dict = {}
        for b in banks:
            if isinstance(b, dict):
                merged.update(b)
        return merged
    return dict(sec.get("option_bank") or sec.get("options") or {})


def _mcq_from(l: dict) -> list[dict]:
    """七 閱讀理解 → the shape declared in `api.ts`:
    `{question, options: string[], answer, explanation}`.

    Options are a list of STRINGS there, not label/text objects — passing objects
    made the step throw on render. The letter is preserved by position (index 0 = A),
    which is how the component maps an answer onto a choice.

    `explanation` carries the teacher edition's rationale. Where that rationale had
    overwritten the correct option in the source, it is both the option text and the
    explanation — the worksheet genuinely has nothing else there.
    """
    out = []
    body = _unwrap(_sections(l).get("comprehension"), "comprehension")
    # 抽取器對同一種東西用了兩個容器名：144 課叫 `questions`、27 課叫 `items`（#2922）。
    # 每一題的結構完全一樣（index / answer / stem / options 字典），差別只在外面那層。
    #
    # ⚠️ 這裡本來只讀 `questions`，於是那 27 課的 `multiple_choice` 是空的 ——
    #    **題目抽出來了，學生看不到**。沒有錯誤、頁面打得開、十道門全綠。
    #    跟 #2683 那批（options 是 dict、欄名叫 videos 不叫 items）同一個病。
    #
    # ⛔ 不要「順手」把資料改成統一容器名：那要動 27 份已上線的內容檔，
    #    而讀取端多認一個名字是零風險的。真要統一是抽取器那邊的事。
    for q in (body.get("questions") or body.get("items") or []):
        opts = q.get("options") or {}
        if not opts:
            continue
        # Positional list, so a gap in the letters SHIFTS every later option: a
        # question with A, C, D and answer D would land on C. Worksheets do have
        # gaps — an option can be missing from the source entirely — so the run is
        # filled from A to the highest letter present, and a hole becomes an empty
        # string rather than a silent renumbering.
        last = max(opts)
        letters = [chr(c) for c in range(ord("A"), ord(last) + 1)]
        answer = q.get("answer")
        if answer and answer > last:
            continue          # answer points past every option — withhold the question
        out.append({
            "question": q.get("stem", ""),
            "options": [opts.get(k, "") for k in letters],
            "answer": answer,
            # 教師版的說明：`questions` 那批叫 `option_corrections`，
            # `items` 那批叫 `option_notes`。兩個都收，欄位名不同不代表意思不同。
            "explanation": (opts.get(answer) if q.get("is_rationale")
                            else (q.get("option_corrections") or q.get("option_notes") or {}).get(answer)),
        })
    return out


def _thumbnail_name(uid: str, version_id: str | None) -> str | None:
    """The cover file for a lesson, or None.

    All covers are 400×300 WebP — the first edition's spec, kept because it is the
    size the library card actually renders. Newly generated art arrives as ~1.4 MB
    PNG from the model and is converted on the way in: 69 of those would have put
    99 MB of images into the repository for pictures displayed at 400 px wide.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent.parent / "data" / "lessons" / uid
    if not root.is_dir():
        return None
    # 封面是**課**的一部分，不是版本的一部分。
    #
    # 二修建了 v3 但沒把封面搬過去，175 張一度全留在 `v2/assets/`。這裡原本只看
    # `version_id`（＝ v3），於是每一課都回 None，圖書館整片空白。
    # Young：圖呢？？？之前有圖啊
    #
    # v2 移除時 1990 個 asset 已 `git mv` 進 `v3/assets/`（#2720 的 v3 移植），
    # 所以現在最新版本就有封面。**往回找的迴圈保留** —— 它不是為 v2 寫的，而是為
    # 「下一個版本忘記搬封面」寫的，而那件事已經發生過一次。
    versions = sorted(
        (c for c in root.iterdir() if c.is_dir() and c.name.startswith("v")),
        key=lambda c: c.name,
        reverse=True,
    )
    if version_id:
        # 呼叫端指定的版本先試，其餘依序往回
        versions = ([root / version_id] if (root / version_id).is_dir() else []) + [
            c for c in versions if c.name != version_id
        ]
    for v in versions:
        if (v / "assets" / "thumbnail.webp").is_file():
            return "thumbnail.webp"
    return None


#: 文言文課的線上學習流程 (#2752). Six worksheet sections
#: (導讀／古文今譯／原文／文白句子比對／文白詞語比對／自我挑戰) have no `step_sequence`
#: to travel on, so the frontend falls back to `DEFAULT_STEP_SEQUENCE` — the vocab/listening/
#: dictation steps a 白話課 uses, none of which this genre has data for. This is what a
#: 文言文 lesson gets instead, in worksheet order:
#:   導讀+古文今譯 fold into lesson-intro；原文(+白話對照) is its own step (annotate-by-
#:   student doesn't apply — the 注釋 are already printed, so full-text-annotate's
#:   interaction doesn't fit); 念順順 stays key-passage-reading (already wired, #2559);
#:   一/二/六 大題 each get their own step (matching answer / boxed-term blank / separate
#:   passage+questions are three different interaction shapes, none of which the
#:   existing vocab-definition/vocab-application cloze renderer can display without
#:   mislabeling the step).
CLASSICAL_STEP_SEQUENCE: tuple[str, ...] = (
    "lesson-intro",
    "classical-text",
    "key-passage-reading",
    "classical-sentence-matching",
    "classical-word-matching",
    "keypoints-table",
    "spotlight",
    "comprehension",
    "classical-self-challenge",
    "report",
)


def _uid_tree_lessons() -> list[dict]:
    """Second-edition lessons from the uid tree (#2687/#2692).

    Returns [] when the tree is absent, so this is a no-op on any checkout that
    has not run the extraction yet. Shaped to look like the existing lesson
    dicts so downstream code needs no change during the dual-path window.
    """
    try:
        from app.services.keypoints_to_structure import keypoints_to_structure_table
        from app.services.lesson_uid_loader import load_all as _load_uid_all
    except Exception:
        return []
    out = []
    for i, l in enumerate(_load_uid_all(), start=1):
        uid = l["lesson_uid"]
        code = l.get("catalog_slot") or ""
        # `grade` is the single classification axis the library filters on, and
        # it is a STRING, not a year number: "4".."9" plus 文言文 and 品格教育.
        #
        # 文-L2 / 體-L6 carry no year in their filename because they are not a
        # year — they are standalone collections. Modelling them as a separate
        # `track` field forced every caller to handle two axes; modelling them as
        # a fake grade number (90/91) would have been inventing data. Making the
        # axis a string lets one filter cover all eight categories.
        m = re.match(r"^G(\d+)-", code or "")
        if m:
            grade = m.group(1)
        elif code.startswith("文"):
            grade = "文言文"
        elif code.startswith("體"):
            grade = "品格教育"      # 檔名寫的是「品格力」，非「品德」
        else:
            grade = ""
        # Fields the extraction pipeline does not produce, so they default empty —
        # but a lesson.yml may carry them (the admin editor writes a full record, and
        # future pipeline versions will too). Anything present on disk wins over the
        # default: hardcoding these meant an admin could save a story and get back a
        # row with its genre and paragraphs blanked, with no error anywhere.
        row = {
            # 20000+ keeps these clear of Layer-1 (1-57) and Layer-2 (1000+)
            # during the dual-path window; Phase 5 drops the other two and the
            # uid becomes the only identity.
            "id": 20000 + int(uid[1:]),
            "lesson_uid": uid,
            "version_id": l.get("version_id"),
            "lesson_number": 20000 + int(uid[1:]),
            "grade_code": code,
            # `build_indexes` keys the by-code lookup on `lesson_code`, and the tree
            # rows only carried `grade_code` — so `_LESSONS_BY_CODE` built empty and
            # `get_lesson_by_code` returned None for every code in the catalogue,
            # silently. The two names are the same value; the older loaders set both.
            "lesson_code": code,
            # 課次／系列／排序序號（#2736）。圖書館以前按 `lesson_uid` 排 —— 那是
            # 抽取流水號，跟課本順序無關，所以四年級第一課顯示的是第 10 課。
            # 課次一直都在課碼裡（`G4-L10`），但那是字串，而且有三種系列
            # （`G4-L1` / `文-L1` / `體-L1`）；每個要排序的地方各自 parse 一次，
            # 遲早會排得不一樣。這裡送明確欄位，前端不用再拆字串。
            "lesson_no": _meta(l).get("lesson_no"),
            "series": _meta(l).get("series"),
            "lesson_seq": _meta(l).get("lesson_seq"),
            "grade": grade,
            "title": l.get("title"),
            # fields the API schema expects; the uid tree has no genre/category
            # taxonomy yet, so they stay empty rather than being invented.
            # From 自學教材總表.xlsx (#2683). These were hardcoded empty because the
            # worksheet DOCX carries no taxonomy — but the spreadsheet always has,
            # and the first edition read it from there too. Reporting the field as
            # unobtainable was a failure to look at how it had been obtained before.
            # The worksheet's own masthead over the planning spreadsheet: they disagree
            # on 16 lessons and the worksheet is the one authored with the lesson.
            "genre": ((_body(l).get("level") or {}).get("genre")
                      or _meta(l).get("genre") or ""),
            # Derived from the genre actually served, not from the spreadsheet's —
            # otherwise a lesson shows 說明文 beside a category computed from 應用文.
            "category": _category_for(
                (_body(l).get("level") or {}).get("genre"),
                _meta(l),
            ),
            "char_count": _body(l).get("char_count") or 0,
            # Served from the uid tree, so the image is addressed by the lesson's
            # identity rather than its catalogue position. Under the first edition
            # covers were keyed by code; the renumber pointed every one of them at a
            # different story (verified: G4-L10's bus interior against 《十秒的背後》).
            "thumbnail_url": (
                f"/assets/lesson/{uid}/{_thumbnail_name(uid, l.get('version_id'))}"
                if _thumbnail_name(uid, l.get("version_id")) else None
            ),
            # 閱讀聚光燈策略 from the master spreadsheet — the reading method the
            # lesson teaches, shown on the library card and the spotlight step.
            "reading_strategy": _meta(l).get("strategy") or None,
            # #2898：策略「名稱」只有 13 字，是一個標籤不是說明。這一欄是批次
            # 預生成的 2-3 句白話，給學生看的。沒有的課回 None，前端就不畫那一段。
            "reading_strategy_explained": _meta(l).get("strategy_explained") or None,
            "has_key_reading": bool(_key_reading(l)),
            # The intro is a sentence about what the lesson is FOR, built from its
            # unit topic and reading strategy — not the opening paragraph, which
            # would make "introduction" mean "the lesson, again".
            "intro": ({"author": "", "background": _meta(l)["intro"]}
                      if _meta(l).get("intro") else None),
            # 課文本體, extracted from the DOCX section the worksheet calls
            # 讀全文-做記號 (#2683). It was absent for all 175 lessons because the
            # pipeline read paragraphs back out of the layer the re-ink deleted —
            # which left 朗讀 / 閱讀理解 / 生字 / 造句 with no text to work on and
            # 「參考課文」 blank beside the keypoints table.
            "paragraphs": _flat_paragraphs(_body(l)),
            # StoryDetail indexes these directly. The second-edition extraction
            # produces spotlight + keypoints; the remaining practice modules are
            # not yet extracted, so they are present-but-empty rather than absent
            # (absent would 500 the detail route, empty renders as "no exercise").
            # From sections.yml — the worksheet sections the pipeline now extracts.
            # A section that failed its check is absent from that file rather than
            # present-and-wrong, so `or None` here is the honest empty state and the
            # step renders 「本課尚無…」 instead of another lesson's questions.
            # 重複出現的大題（#2916）。一份學習單印兩篇文章時，念順順／讀全文／語詞
            # 這些大題會各出現一次，檔名各帶一個 slug（`key_reading.fqwda.yml`）。
            #
            # ⚠️ 這個 row 是**逐欄寫死的字典**，下面那個 overlay 迴圈只覆蓋
            #    「row 裡已經有的 key」——所以沒有宣告在這裡的欄位，
            #    loader 讀到了也永遠送不出去，而且不會有任何錯誤或紅燈
            #    （2026-08-24 實測：L0029 兩個念順順都在硬碟上，API 回 repeat_rounds 空）。
            # 每一輪額外附上**攤平好的** `paragraphs`（#2916）。
            # 輪次裡原始的是 `[{idx,text}]`，而 API 頂層的 `paragraphs` 是字串陣列 ——
            # 不在這裡對齊的話，前端換篇時得自己再攤一次，那就是第二套實作。
            "repeat_rounds": _rounds_with_flat_paragraphs(l) or None,
            # ⚠️ 不能叫 `parts` —— `lesson.yml` 自己就有一個 `parts:`（{id,label}），
            #    而下面那個 overlay 迴圈會用課的版本蓋掉這裡算的（實測 0/5 課拿得到）。
            "part_rounds": _parts_summary(l) or None,
            # 前台的導航順序 —— 直接來自那一課的總帳（`_manifest.yml`），
            # 不是寫死的預設步驟表（#2916）。
            #
            # ⚠️ 在此之前這個欄位**175 課全是 None**，所以每一課都退回
            #    DEFAULT_STEP_SEQUENCE —— 前台從來沒有照學習單的順序走過。
            #
            # 一課多篇時同一個大題會出現多次，`file` 寫明各自要載哪一份，
            # 前台照列表由上往下走就對了，不必知道 slug 規則。
            "manifest_sections": _manifest_sections(l) or None,
            "vocabulary": _vocabulary_from(l) or None,
            "fill_in_blank": _cloze_from(l) or None,
            "vocab_bank": _vocab_bank_from(l) or None,
            "multiple_choice": _mcq_from(l) or None,
            # The lesson's own characters-per-minute (or seconds, for 文言文) target,
            # read from 念順順 and stored beside the passage it belongs to. Hard-coded
            # None until #2722, which meant `getThresholdsFromBenchmark` fell through to
            # a grade-wide default on every lesson while each worksheet carried its own.
            "reading_benchmark": ((l.get("key_reading") or {}).get("reading_benchmark")
                                  if isinstance(l.get("key_reading"), dict) else None),
            # 重點朗讀 (念順順). Absent means the step reads the whole text, which is
            # what the 2026-07-20 review ruled against but is at least this lesson's
            # own text — the first-edition table, keyed by code, was serving another
            # lesson's paragraph aloud.
            "key_reading": _key_reading(l),
            # 一輪一個（#2916）。單篇課就是一筆、slug=None；一課兩篇就是兩筆。
            # ⚠️ 單數那個保留指向第一輪，所以 168 課單篇的行為一個字都沒變。
            "key_readings": _key_readings(l) or None,
            "text_type": "單",
            "source_file": None,
            # An extraction that failed is stored as {"lesson": …, "error": …} in
            # spotlight.yml, and serving that object counts as "has a spotlight" while
            # the step renders 參考課文 and nothing else. 30 lessons looked present that
            # way — the field was 175/175 and the exercises were 143/175. Absent is the
            # honest value, and it is what makes the step show its empty state.
            "spotlight_v2": _spotlight_or_none(l),
            # `_unwrap`, not `.get("keypoints")` — the loader has already taken the
            # module wrapper off, so `l["keypoints"]` IS the table. Asking for a
            # `keypoints` key inside it found nothing and this field was None for all
            # 175 lessons, silently: `lesson_content_loader` says in a comment that the
            # 重點表 step is "served separately on story['keypoints']", and it was not.
            # `_spotlight_or_none` two lines up carries the same warning for the same
            # reason — spotlight was written correctly, keypoints was not.
            "keypoints": _unwrap(l.get("keypoints"), "keypoints") or None,
            # The 重點表 step reads `story_structure_table` off the story and asks an
            # LLM to invent one when it is absent. The second-edition pipeline emits
            # the same table already structured, so convert rather than regenerate —
            # an AI-written table is not the one the teacher authored.
            "story_structure_table": keypoints_to_structure_table(l.get("keypoints")),
            "video_links": _video_links(l),
            "assets": l.get("assets") or [],
            "source": "uid_tree",
            # 文言文專屬模組 (#2752) — passed through raw, same shape `lesson_uid_loader`
            # already unwrapped them into. `None` for the ~9 in 10 lessons that carry
            # none of these files; a missing module stays missing (module_entry_gate's
            # "空狀態是誠實值" rule applies here too — inventing a self_challenge for a
            # lesson whose worksheet never had one would be worse than showing nothing).
            # 詞語複習的教師版找字表 + 知識補給站 (#2860)。抽取器 150／148 課早就抽好，
            # 但這條路上「後端 story dict → StoryDetail → api.ts → 元件」四處都是
            # 逐欄位列舉，沒列到就靜默掉 —— 前端因此一直用 story.vocabulary
            # 自己隨機生格子，老師出的那張表一課都沒到過學生面前，且沒有任何錯誤訊息。
            "vocab_review": l.get("vocab_review") or None,
            "resources": l.get("resources") or None,
            "classical_text": l.get("classical_text") or None,
            "modern_translation": l.get("modern_translation") or None,
            "word_matching": l.get("word_matching") or None,
            "sentence_matching": l.get("sentence_matching") or None,
            "self_challenge": l.get("self_challenge") or None,
            "intro_guide": l.get("intro_guide") or None,
            # 目標策略框／讀前自我檢核 (#2752 Phase 2) — spans regular lessons too
            # (70／58 課), not a single genre. Same "missing stays missing" rule.
            "goal_box": l.get("goal_box") or None,
            "self_check_before_reading": l.get("self_check_before_reading") or None,
            # 多文本合讀課 + 收尾書寫練習 (#2752 Phase 3). `multi_text_parts` is a
            # LIST (one entry per additional part), not a dict — `or None` still
            # works correctly on an empty/absent list.
            "multi_text_parts": l.get("multi_text_parts") or None,
            "cross_text_banner": l.get("cross_text_banner") or None,
            "keypoints_followup_questions": l.get("keypoints_followup_questions") or None,
            "writing_practice": l.get("writing_practice") or None,
            # Per-lesson step order (#1374 mechanism, unused by the uid tree until now —
            # every one of the 175 second-edition lessons fell back to
            # DEFAULT_STEP_SEQUENCE because this key was never in `row` for the overlay
            # loop below to carry). A 文言文 lesson (has `classical_text`) gets
            # CLASSICAL_STEP_SEQUENCE; everything else stays None → unchanged behavior.
            "step_sequence": _step_sequence_for(l),
        }
        # Overlay what lesson.yml actually carries. Identity stays computed — a
        # lesson must never be able to rename its own uid or id from its payload.
        #
        # ⚠️ 這份清單不只是「身分」，是**所有這裡算過、不可以被原始 payload 蓋掉的欄位**。
        #    row 是逐欄寫死的字典，欄名跟 lesson.yml 的欄名撞到就會被這個迴圈蓋回原值 ——
        #    沒有錯誤、型別也對，只是你算的那份不見了。已經踩過三次：
        #      `parts`（0/5 課拿得到篇次）
        #      `repeat_rounds`（攤平好的段落被原始 [{idx,text}] 蓋回去 → 讀全文當掉）
        #      `manifest_sections`（形狀不同的兩份互蓋 → type/number 全變 None）
        #    加新的計算欄位時，**如果 lesson.yml 也有同名欄位就要加進這裡**。
        #    `test_computed_fields_survive_the_overlay` 會盯著這件事。
        _IDENTITY = {"id", "lesson_uid", "version_id", "grade", "assets", "source",
                     "spotlight_v2", "keypoints", "story_structure_table",
                     "repeat_rounds", "manifest_sections"}
        for k, v in l.items():
            if k in _IDENTITY or v in (None, "", [], {}):
                continue
            if k in row:
                row[k] = v
        out.append(row)
    return out


# 學習單章節 → 線上 step。名字是抽取照著學習單印的字寫的。
#: 學習單印出來的破折號有好幾種寫法，而 `_SECTION_TO_STEP` 是字面比對。
#: 實測（2026-08-21，350 份 lesson.yml）：
#:
#:     讀全文-做記號   U+002D HYPHEN-MINUS         122 課   ← 表裡有
#:     讀全文—做記號   U+2014 EM DASH               36 課   ← 表裡沒有，全部掉步驟
#:
#: 那 36 課的 `step_sequence` 完全沒有 `full-text-annotate`，學生走到第二關時
#: 那一關不存在。同族還有三個標籤帶 U+2500（BOX DRAWINGS，抽取管線的產物）。
#:
#: 修法是**比對前正規化**而不是加四條別名：別名治的是「今天看到的那四個」，
#: 破折號變體不只四種，每多一種就要有人再發現一次。
_DASH_VARIANTS = "\u2014\u2013\u2012\u2015\u2500\u2501\uff0d\u2212\u2043"
_DASH_TABLE = str.maketrans({c: "-" for c in _DASH_VARIANTS})


def normalise_section_label(name: str) -> str:
    """把章節標籤裡的各種破折號統一成 HYPHEN-MINUS，其餘一字不動。"""
    return (name or "").translate(_DASH_TABLE)


_SECTION_TO_STEP = {
    "讀全文-做記號": "full-text-annotate",
    "念順順": "key-passage-reading",
    "重點朗讀": "key-passage-reading",
    "語詞我最棒": "vocab-definition",
    "語詞應用": "vocab-application",
    "文章重點表": "keypoints-table",
    "閱讀聚光燈": "spotlight",
    "閱讀理解": "comprehension",
    "詞語複習": "vocab-review",
    "語詞複習": "vocab-review",
    "知識補給站": "knowledge-station",
}


#: 模組名 → step id。跟 `scripts/module_entry_gate.py` 的 ENTRY 同一份對照，
#: 那道門會解析 stepConfig.ts 驗「每個抽出來的模組，學生都走得到」。
_MODULE_TO_STEP: dict[str, str] = {
    "full_text_annotate": "full-text-annotate",
    "key_reading": "key-passage-reading",
    "vocab_definitions": "vocab-definition",
    "vocab_application": "vocab-application",
    "keypoints": "keypoints-table",
    "comprehension": "comprehension",
    "spotlight": "spotlight",
    "vocab_review": "vocab-review",
    "resources": "knowledge-station",
}


def _step_sequence_for(l: dict) -> list[str] | None:
    """這一課的步驟順序，來自它自己的學習單。

    為什麼不能是一份通用清單
    ------------------------
    側欄是照學習單章節順序畫的，而「下一關」原本查一張靜態表
    （`STEP_FINISH_TRANSITIONS`）—— 兩個來源，於是它們可以不一致。
    2026-08-19 Young 在聚光燈按下一關，直接跳到閱讀理解，**略過文章重點表**：

    > 下一關按鈕為什麼不是按照側欄順序？？？？

    學習單自己就寫著順序。`lesson.yml` 的 `sections_present`：

        五 文章重點表 → 六 閱讀聚光燈 → 七 閱讀理解

    抽取抽出來了，只是沒有人把它接成 `step_sequence` ⇒ 前端拿不到序列，
    只能退回靜態表。今天反覆出現的同一個形狀。

    文言文課維持既有的 `CLASSICAL_STEP_SEQUENCE`：它的章節名
    （導讀／古文今譯／原文…）跟一般課完全不同，對照表涵蓋不到。
    """
    if l.get("classical_text"):
        return list(CLASSICAL_STEP_SEQUENCE)

    # 🔴 帳本（`_manifest.yml`）優先 —— 順序只能有一個來源（#2916）。
    #
    # 這支原本自己再從 `sections_present` 算一次，於是全站有三套順序：
    # 這裡、`_manifest_sections()`、以及前端的 `stepSequenceFromManifest`。
    # 而 `api.ts` 是 `detail.step_sequence ?? stepSequenceFromManifest(...)` ——
    # 只要這裡有值，前端那支就永遠不會被呼叫。2026-08-25 實測：帳本 19 列、
    # 前端只顯示 9 步，三個念順順收斂成一個，而我改的是永遠跑不到的那一支。
    #
    # 帶 slug 的那幾列要各自成為一步，key 加後綴 `#<slug>`，
    # 前端 `resolveActiveSteps` 會把後綴剝掉查 registry。
    seen: list[str] = []
    rows = l.get("manifest_sections") or []
    if rows:
        for sec in rows:
            mod = (sec or {}).get("module")
            step = _MODULE_TO_STEP.get(mod) if mod else None
            if not step:
                continue
            key = f"{step}#{sec['slug']}" if sec.get("slug") else step
            if key not in seen:
                seen.append(key)
    else:
        for sec in l.get("sections_present") or []:
            step = _SECTION_TO_STEP.get(
                normalise_section_label(str((sec or {}).get("name") or "").strip())
            )
            if step and step not in seen:
                seen.append(step)
    if not seen:
        return None
    # 課程簡介永遠在最前、報告永遠在最後 —— 學習單不印這兩個章節，
    # 但它們是線上流程的頭尾，漏掉的話學生走到最後會無處可去。
    return ["lesson-intro", *seen, "report"]


def build_all_lessons() -> list[dict]:
    """All lessons, from the uid tree.

    The two historical layers (`L*.yml` hand-built 2026-02 and
    `_parsed_2026-05-01/` batch-parsed 2026-05) were deleted in the second-edition
    re-ink. They were merged on *title*, which silently produced empty shells
    whenever a title drifted by one punctuation mark, and duplicated 26 lessons
    across the two layers. Identity is now the directory name under
    `backend/data/lessons/<lesson_uid>/<version_id>/` and nothing else.

    **課本順序在這裡定案，不在每個消費者各自定案。** 圖書館原本按 `id`
    （＝ `20000 + uid`，抽取流水號）排，所以四年級的第一課顯示成第 10 課，
    而課本的第 1 課《贏得喝采的輸家》躺在 L0011。UID 跟課本順序沒有關係。

    排序鍵是 `lesson_seq`（`scripts/add_lesson_ordering_metadata.py` 寫入 metadata），
    一把尺同時排三種系列：一般課 `年級*1000+課次*10`、文言文 90000+、體育生 91000+。
    課碼解不出課次的課退回用 UID（99000+），排在最後但仍然是決定性的順序 ——
    不給它位置，它會落在排序器碰巧放的地方，而那不會有任何徵兆。
    """
    lessons = _uid_tree_lessons()
    return sorted(lessons, key=lambda l: (
        l.get("lesson_seq") if isinstance(l.get("lesson_seq"), int) else 99000 + l["id"],
        l["id"],
    ))

def build_indexes(all_lessons: list[dict]) -> tuple[
    dict[int, dict],
    dict[str, dict],
    dict[str, dict],
    list[int],
]:
    """Build all lookup indexes from the full lesson list.

    Returns:
        lessons_by_id    — {id: lesson}
        lessons_by_code  — {lesson_code: lesson}
        lessons_by_title — {title: lesson}
        available_grades — sorted list of unique grade ints
    """
    lessons_by_id: dict[int, dict] = {l["id"]: l for l in all_lessons}
    lessons_by_code: dict[str, dict] = {
        l["lesson_code"]: l for l in all_lessons if l.get("lesson_code")
    }
    lessons_by_title: dict[str, dict] = {l["title"]: l for l in all_lessons}
    # Years first in numeric order, then the named collections.
    _g = {l["grade"] for l in all_lessons if l.get("grade")}
    available_grades: list[str] = (
        sorted((x for x in _g if x.isdigit()), key=int) + sorted(x for x in _g if not x.isdigit())
    )
    return lessons_by_id, lessons_by_code, lessons_by_title, available_grades
