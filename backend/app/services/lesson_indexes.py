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

from app.services.lesson_layer_loaders import (
    ENRICHMENT_FIELDS,
    load_curriculum_manifest,
    load_layer1_lessons,
    load_layer2_lessons,
    build_layer2_enrichment_index,
)
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
    kr = l.get("key_reading")
    if not isinstance(kr, dict) or not kr.get("passage"):
        return None
    return {
        "passage": kr["passage"],
        "start_text": kr.get("start_text"),
        "extent_chars": kr.get("extent_chars"),
        "source": kr.get("source") or "docx-extract",
    }


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
    urls = _meta(l).get("video_links") or []
    if not urls:
        return None
    items = _unwrap(_sections(l).get("resources"), "resources").get("items") or []
    titled = len(items) == len(urls)
    return [
        {"title": (items[i]["title"] if titled else f"影片 {i + 1}"), "url": u}
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


def _cloze_from(l: dict) -> list[dict]:
    """四 語詞應用 → the LEGACY fill-in-blank shape the frontend requires.

    `frontend/src/services/api.ts` keeps only items matching `{sentence, answer}`
    where `answer` is a letter into `vocab_bank`; anything else is filtered out and
    the step falls back to its empty state. Emitting `{question, options[]}` — the
    shape that reads naturally from the worksheet — meant the step either showed
    nothing or crashed on `.sentence`.
    """
    sec = _unwrap(_sections(l).get("vocab_application"), "vocab_application")
    # v2 寫 `questions[{text,answer}]`；v3 照學習單寫 `items[{stem,answer}]`。
    rows = sec.get("items") or sec.get("questions") or []
    return [
        {"sentence": q.get("stem") or q.get("text") or "", "answer": q.get("answer"), "_schema": "legacy"}
        for q in rows
        if (q.get("stem") or q.get("text")) and q.get("answer")
    ]


def _vocab_bank_from(l: dict) -> dict:
    """四 語詞應用's options, as the letter → word map the cloze exercise resolves
    its answers against. Without it every answer letter matches nothing."""
    sec = _unwrap(_sections(l).get("vocab_application"), "vocab_application")
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
    for q in _unwrap(_sections(l).get("comprehension"), "comprehension").get("questions") or []:
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
            "explanation": opts.get(answer) if q.get("is_rationale") else None,
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
    if not version_id:
        vs = sorted((c.name for c in root.iterdir()
                     if c.is_dir() and c.name.startswith("v"))) if root.is_dir() else []
        version_id = vs[-1] if vs else None
    if not version_id:
        return None
    return "thumbnail.webp" if (root / version_id / "assets" / "thumbnail.webp").is_file() else None


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
            "paragraphs": [
                (p.get("text") if isinstance(p, dict) else p)
                for p in _body(l).get("paragraphs") or []
            ],
            # StoryDetail indexes these directly. The second-edition extraction
            # produces spotlight + keypoints; the remaining practice modules are
            # not yet extracted, so they are present-but-empty rather than absent
            # (absent would 500 the detail route, empty renders as "no exercise").
            # From sections.yml — the worksheet sections the pipeline now extracts.
            # A section that failed its check is absent from that file rather than
            # present-and-wrong, so `or None` here is the honest empty state and the
            # step renders 「本課尚無…」 instead of another lesson's questions.
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
            "text_type": "單",
            "source_file": None,
            # An extraction that failed is stored as {"lesson": …, "error": …} in
            # spotlight.yml, and serving that object counts as "has a spotlight" while
            # the step renders 參考課文 and nothing else. 30 lessons looked present that
            # way — the field was 175/175 and the exercises were 143/175. Absent is the
            # honest value, and it is what makes the step show its empty state.
            "spotlight_v2": _spotlight_or_none(l),
            "keypoints": (l.get("keypoints") or {}).get("keypoints"),
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
            "classical_text": l.get("classical_text") or None,
            "modern_translation": l.get("modern_translation") or None,
            "word_matching": l.get("word_matching") or None,
            "sentence_matching": l.get("sentence_matching") or None,
            "self_challenge": l.get("self_challenge") or None,
            "intro_guide": l.get("intro_guide") or None,
            # Per-lesson step order (#1374 mechanism, unused by the uid tree until now —
            # every one of the 175 second-edition lessons fell back to
            # DEFAULT_STEP_SEQUENCE because this key was never in `row` for the overlay
            # loop below to carry). A 文言文 lesson (has `classical_text`) gets
            # CLASSICAL_STEP_SEQUENCE; everything else stays None → unchanged behavior.
            "step_sequence": list(CLASSICAL_STEP_SEQUENCE) if l.get("classical_text") else None,
        }
        # Overlay what lesson.yml actually carries. Identity stays computed — a
        # lesson must never be able to rename its own uid or id from its payload.
        _IDENTITY = {"id", "lesson_uid", "version_id", "grade", "assets", "source",
                     "spotlight_v2", "keypoints", "story_structure_table"}
        for k, v in l.items():
            if k in _IDENTITY or v in (None, "", [], {}):
                continue
            if k in row:
                row[k] = v
        out.append(row)
    return out


def build_all_lessons() -> list[dict]:
    """All lessons, from the uid tree.

    The two historical layers (`L*.yml` hand-built 2026-02 and
    `_parsed_2026-05-01/` batch-parsed 2026-05) were deleted in the second-edition
    re-ink. They were merged on *title*, which silently produced empty shells
    whenever a title drifted by one punctuation mark, and duplicated 26 lessons
    across the two layers. Identity is now the directory name under
    `backend/data/lessons/<lesson_uid>/<version_id>/` and nothing else.
    """
    return _uid_tree_lessons()

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
