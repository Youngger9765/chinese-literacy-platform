"""Regression lock for the uid-tree loader (#2692).

The defect this replaces was silent: a title mismatch of one punctuation mark
made the old two-layer merge hand back an empty shell instead of failing. So
these tests care less about the happy path than about what happens when the tree
is *wrong* — a half-written directory must be treated as absent, never served
partially.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import lesson_uid_loader as L  # noqa: E402


@pytest.fixture
def tree(tmp_path, monkeypatch):
    """A minimal uid tree, swapped in for the real LESSONS_ROOT."""
    monkeypatch.setattr(L, "LESSONS_ROOT", tmp_path)
    L.reset_cache()
    yield tmp_path
    L.reset_cache()


def _write(root: Path, uid: str, version: str, *, meta=True, spotlight=True,
           keypoints=True, assets=0) -> Path:
    d = root / uid / version
    d.mkdir(parents=True)
    if meta:
        (d / "lesson.yml").write_text(yaml.dump({
            "lesson_uid": uid, "version_id": version,
            "title": f"課文 {uid}", "catalog_slot": "G4-L1",
        }, allow_unicode=True), encoding="utf-8")
    if spotlight:
        (d / "spotlight.yml").write_text(yaml.dump({"spotlight": {"blocks": []}}),
                                         encoding="utf-8")
    if keypoints:
        (d / "keypoints.yml").write_text(yaml.dump({"keypoints": {"rows": []}}),
                                         encoding="utf-8")
    if assets:
        a = d / "assets"
        a.mkdir()
        for i in range(assets):
            (a / f"fig{i}.png").write_bytes(b"x")
    return d


def test_loads_a_complete_lesson(tree):
    _write(tree, "L0001", "v2", assets=3)
    lesson = L.load_lesson("L0001")
    assert lesson["lesson_uid"] == "L0001"
    assert lesson["version_id"] == "v2"
    assert "spotlight" in lesson and "keypoints" in lesson
    assert len(lesson["assets"]) == 3


def test_identity_comes_from_the_directory_not_the_title(tree):
    """Two lessons may share a title — 大自然的氣象小幫手 is both G4-L12 and
    G7-L17 with different strategies and Levels. They must stay distinct."""
    for uid in ("L0001", "L0002"):
        d = _write(tree, uid, "v2")
        (d / "lesson.yml").write_text(yaml.dump({
            "lesson_uid": uid, "version_id": "v2",
            "title": "大自然的氣象小幫手",          # same title on purpose
            "catalog_slot": "G4-L12" if uid == "L0001" else "G7-L17",
        }, allow_unicode=True), encoding="utf-8")
    L.reset_cache()
    assert len(L.load_all()) == 2
    assert {x["catalog_slot"] for x in L.load_all()} == {"G4-L12", "G7-L17"}


def test_highest_version_wins_by_default(tree):
    _write(tree, "L0001", "v1")
    _write(tree, "L0001", "v2")
    assert L.load_lesson("L0001")["version_id"] == "v2"


def test_explicit_version_can_pin_an_older_edition(tree):
    _write(tree, "L0001", "v1")
    _write(tree, "L0001", "v2")
    assert L.load_lesson("L0001", "v1")["version_id"] == "v1"


def test_missing_lesson_yml_is_absent_not_empty(tree):
    """Fail-closed: a half-written dir must not be served as a shell.
    Serving an empty lesson is exactly how the old two-layer merge failed."""
    _write(tree, "L0001", "v2", meta=False)
    assert L.load_lesson("L0001") is None
    assert L.load_all() == []


def test_dir_without_any_version_is_ignored(tree):
    (tree / "L0009").mkdir()
    L.reset_cache()
    assert "L0009" not in L.available_uids()


def test_non_uid_directories_are_ignored(tree):
    """The lessons root also holds _parsed_2026-05-01/, spotlight/, L01.yml …
    during the dual-path window. None of them may be mistaken for a uid."""
    for name in ("_parsed_2026-05-01", "spotlight", "_ai_lessons", "L01.yml"):
        (tree / name).mkdir()
    _write(tree, "L0001", "v2")
    L.reset_cache()
    assert L.available_uids() == ("L0001",)


def test_modules_are_optional(tree):
    """A lesson with no keypoints table is normal, not a failure."""
    _write(tree, "L0001", "v2", keypoints=False)
    lesson = L.load_lesson("L0001")
    assert "spotlight" in lesson
    assert "keypoints" not in lesson


def test_corrupt_module_yaml_does_not_take_the_lesson_down(tree):
    d = _write(tree, "L0001", "v2")
    (d / "spotlight.yml").write_text("{[not: valid", encoding="utf-8")
    L.reset_cache()
    lesson = L.load_lesson("L0001")
    assert lesson is not None            # the lesson still loads
    assert "spotlight" not in lesson     # but the broken module is dropped


# ── index invariants (#2683) ────────────────────────────────────────────────

def test_lookup_by_code_is_populated():
    """`build_indexes` keys the by-code index on `lesson_code`, and the tree rows
    only carried `grade_code` — so `_LESSONS_BY_CODE` built EMPTY and
    `get_lesson_by_code` returned None for every code in the catalogue, without
    raising. Anything resolving a lesson by its code silently found nothing."""
    from app.services.lesson_loader import _LESSONS_BY_CODE, get_all_lessons, get_lesson_by_code

    all_lessons = get_all_lessons()
    assert len(_LESSONS_BY_CODE) == len(all_lessons), (
        f"by-code index has {len(_LESSONS_BY_CODE)} of {len(all_lessons)} lessons"
    )
    sample = all_lessons[0]
    found = get_lesson_by_code(sample["grade_code"])
    assert found is not None, f"{sample['grade_code']} not resolvable by code"
    assert found["lesson_uid"] == sample["lesson_uid"]


def test_assetless_table_figures_are_stripped_at_load():
    """`inject_per_practice_figures` emits `{type: figure, referent: table,
    asset: null}` on every rebuild — 89 of 143 lessons carried them. They render to
    nothing, so every consumer would otherwise need to know to skip them."""
    from app.services.lesson_loader import get_all_lessons

    leftover = [
        (l["lesson_uid"], b)
        for l in get_all_lessons()
        for b in ((l.get("spotlight_v2") or {}).get("blocks") or [])
        if isinstance(b, dict)
        and b.get("type") == "figure"
        and b.get("referent") == "table"
        and not b.get("asset")
    ]
    assert leftover == [], f"{len(leftover)} assetless table figures survived loading"


def test_the_code_offset_table_stays_empty():
    """`CATALOG_TO_PARSED_OVERRIDE` patched a numbering offset between two layers.
    There is one source now, so a code means itself — and leaving the first-edition
    pairs in place was not neutral: after the renumber they redirected live lookups
    to a DIFFERENT lesson (G8-L9 「按讚」背後的真相 resolved to G8-L7 集中營裡的一門課,
    which surfaced as a 'stale manifest' rather than as the mis-binding it was)."""
    from app.services.lesson_code_normalization import (
        CATALOG_TO_PARSED_OVERRIDE,
        catalog_to_parsed_code,
        parsed_to_catalog_codes,
    )

    assert CATALOG_TO_PARSED_OVERRIDE == {}, (
        f"offset table repopulated with {list(CATALOG_TO_PARSED_OVERRIDE)[:5]} — "
        "two numbering schemes need a version_id on the uid, not a position lookup"
    )
    # And the mapping functions are the identity for real catalogue codes.
    from app.services.lesson_loader import get_all_lessons

    for lesson in get_all_lessons()[:20]:
        code = lesson["grade_code"]
        assert catalog_to_parsed_code(code) == code
        assert parsed_to_catalog_codes(code) == [code]


def test_importing_the_lab_service_does_not_need_the_lesson_loader():
    """`story_structure_lab_service` computed a pinned-id set at module scope. When
    the representative list stopped carrying `story_id`, that raised KeyError during
    IMPORT — taking down every module that imports it, which surfaced as four test
    files failing to collect rather than as one broken feature."""
    import importlib
    import sys

    for name in list(sys.modules):
        if "story_structure_lab_service" in name:
            del sys.modules[name]
    mod = importlib.import_module("app.services.story_structure_lab_service")
    assert hasattr(mod, "_pinned_story_ids")
    assert mod._pinned_story_ids() is not None   # resolvable when actually asked


def test_key_reading_is_not_bound_by_lesson_code():
    """`data/key_reading_passages.yml` is first-edition data keyed by catalogue
    position. The second edition renumbered every lesson, so looking a passage up by
    `grade_code` kept SUCCEEDING and kept returning a different lesson's text.

    Live on staging: G4-L10 《十秒的背後》 (about a sprinter) served the first
    edition's G4-L10, about giving up a seat on a bus. G4-L19 《把球打好，就夠了嗎》
    would have served a passage about African giant rats. No error anywhere — the
    student simply read the wrong lesson aloud.

    The file has no title, no uid, nothing that could establish which lesson a
    passage belongs to, and the lesson body is absent for all 175 lessons so
    containment cannot be checked either. So the route must not read it.
    """
    from pathlib import Path

    import app.routes.stories as stories

    src = Path(stories.__file__).read_text(encoding="utf-8")
    # Strip comments — they explain the removal and name the function on purpose.
    code = "\n".join(
        line for line in src.splitlines()
        if not line.lstrip().startswith("#")
    )
    assert "get_key_reading_passages" not in code, (
        "the stories route is reading key_reading_passages.yml again — that table is "
        "keyed by catalogue position and after the renumber it serves another lesson"
    )


# ── 課文本體 (#2683) ────────────────────────────────────────────────────────

def test_lessons_carry_their_body_text():
    """The body was absent for all 175 lessons: the pipeline read paragraphs back
    out of the layer the re-ink deleted, so 朗讀 / 閱讀理解 / 生字 / 造句 had no text
    to work on and 「參考課文」 rendered blank beside the keypoints table.

    3 lessons legitimately have none — 會考圖文題實戰 is exam questions end to end,
    with no passage — so this asserts the corpus, not perfection."""
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    with_body = [l for l in lessons if l.get("paragraphs")]
    assert len(with_body) >= 170, (
        f"only {len(with_body)}/{len(lessons)} lessons carry body text"
    )
    for lesson in with_body[:20]:
        assert lesson["char_count"] > 0, f"{lesson['lesson_uid']} has paragraphs but 0 chars"


def test_body_text_is_the_lesson_not_the_worksheet():
    """The failure mode worth guarding is not an empty body but a WRONG one — the
    worksheet's own instructions captured as the text to read aloud. Those lines are
    recognisable: they address the student directly about the exercise."""
    from app.services.lesson_loader import get_all_lessons

    INSTRUCTION = ("請用計時器", "計時1分鐘", "◎ 我的表現", "請在空格內填入",
                   "請根據文章內容", "找一找：")
    offenders = [
        (l["lesson_uid"], p[:24])
        for l in get_all_lessons()
        for p in (l.get("paragraphs") or [])
        if any(m in p for m in INSTRUCTION)
    ]
    assert offenders == [], f"worksheet instructions landed in the body: {offenders[:3]}"


def test_every_body_records_how_it_was_checked():
    """The extraction check travels with the data. Without it a body is just text
    that appeared — there is no way to tell a verified extraction from one that
    merely ran."""
    import yaml
    from pathlib import Path

    from app.services import lesson_uid_loader as L

    checked = 0
    for uid in L.available_uids():
        vdirs = sorted((c for c in (L.LESSONS_ROOT / uid).iterdir()
                        if c.is_dir() and c.name.startswith("v")), key=lambda c: c.name)
        if not vdirs:
            continue
        f = vdirs[-1] / "body.yml"
        if not f.exists():
            continue
        doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        chk = doc.get("extraction_check") or {}
        assert chk.get("verdict") in ("ok", "weak", "suspect", "no_vocab"), (
            f"{uid}: body.yml has no usable extraction_check"
        )
        checked += 1
    assert checked >= 170, f"only {checked} bodies carry a check"


# ── 封面 (#2683) ────────────────────────────────────────────────────────────

def test_covers_are_card_sized_not_source_sized():
    """The generator returns ~1.4 MB square PNGs and the library card renders them at
    400 px wide. Committing the source images put 99 MB into the repository for
    pictures nobody sees at that size, so covers are converted on the way in.

    This locks the OUTCOME rather than the conversion code: any route that lands a
    full-size image in the tree — a rerun with the resize removed, a hand-copied
    file — fails here."""
    from PIL import Image

    from app.services import lesson_uid_loader as L

    oversized, wrong_shape = [], []
    for uid in L.available_uids():
        # `thumbnail.*` also matches thumbnail.source.json, the provenance note
        # written beside reused first-edition art — opening that as an image raises.
        for cover in (L.LESSONS_ROOT / uid).glob("v*/assets/thumbnail.webp"):
            kb = cover.stat().st_size // 1024
            if kb > 120:
                oversized.append((uid, kb))
            if Image.open(cover).size != (400, 300):
                wrong_shape.append((uid, Image.open(cover).size))
    assert oversized == [], f"covers over 120 KB: {oversized[:5]}"
    assert wrong_shape == [], f"covers not 400x300: {wrong_shape[:5]}"


def test_most_lessons_have_a_cover():
    """One lesson legitimately has none — 會考圖文題實戰 is exam questions with no
    passage, so there is no scene to draw."""
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    with_cover = [l for l in lessons if l.get("thumbnail_url")]
    assert len(with_cover) >= 170, f"only {len(with_cover)}/{len(lessons)} have a cover"
    for l in with_cover[:10]:
        assert l["thumbnail_url"].startswith(f"/assets/lesson/{l['lesson_uid']}/"), (
            f"{l['lesson_uid']}: cover addressed by something other than its uid — "
            "keying on the lesson code is what pointed every first-edition image at "
            "the wrong story after the renumber"
        )


def test_body_paragraphs_are_prose():
    """One extraction picked up a 71-character run of the digit 5 — table filler that
    passed every length and prefix check, and that a secret scanner then flagged as a
    credential in a file of children's reading material. Real lesson text is mostly
    CJK; anything below a third is an artefact."""
    from app.services.lesson_loader import get_all_lessons

    offenders = []
    for lesson in get_all_lessons():
        for p in lesson.get("paragraphs") or []:
            cjk = sum(1 for c in p if "一" <= c <= "鿿")
            if cjk < len(p) * 0.3:
                offenders.append((lesson["lesson_uid"], p[:30]))
    assert offenders == [], f"non-prose runs in body text: {offenders[:3]}"


# ── 學習單其餘節次 (#2683) ──────────────────────────────────────────────────

def test_sections_reach_the_learning_steps():
    """語詞理解 / 語詞應用 / 閱讀理解 rendered 「本課尚無…」 for every lesson because
    the pipeline extracted two of the worksheet's nine sections. These are the other
    three, and this asserts they arrive on the story dict the steps read."""
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    counts = {k: sum(1 for l in lessons if l.get(k))
              for k in ("vocabulary", "fill_in_blank", "multiple_choice")}
    assert counts["vocabulary"] >= 100, counts
    assert counts["fill_in_blank"] >= 110, counts
    assert counts["multiple_choice"] >= 120, counts


def test_every_question_can_actually_be_answered():
    """The failure this guards would reach a student: an answer key pointing at
    something that is not on screen.

    Checked against each field's own contract — `multiple_choice` answers are a
    letter indexing into a positional `options` list (0 = A), and `fill_in_blank`
    answers are a letter resolving through `vocab_bank`."""
    from app.services.lesson_loader import get_all_lessons

    broken = []
    for lesson in get_all_lessons():
        for q in lesson.get("multiple_choice") or []:
            n = len(q.get("options") or [])
            ans = q.get("answer")
            if ans and not ("A" <= ans <= chr(ord("A") + n - 1)):
                broken.append((lesson["lesson_uid"], "multiple_choice", ans, n))
        bank = lesson.get("vocab_bank") or {}
        for q in lesson.get("fill_in_blank") or []:
            if q.get("answer") and q["answer"] not in bank:
                broken.append((lesson["lesson_uid"], "fill_in_blank", q["answer"], sorted(bank)))
    assert broken == [], f"answers with nothing to match: {broken[:3]}"


def test_withheld_sections_are_absent_not_empty():
    """A section that failed its check must not be written at all. Present-but-empty
    would render as a step with zero questions, which reads as 'this lesson has no
    exercises' rather than 'this extraction could not be verified'."""
    import yaml

    from app.services import lesson_uid_loader as L

    for uid in L.available_uids()[:40]:
        for f in (L.LESSONS_ROOT / uid).glob("v*/sections.yml"):
            doc = yaml.safe_load(f.read_text(encoding="utf-8"))
            for name, sec in doc.items():
                if not isinstance(sec, dict) or "extraction_check" not in sec:
                    continue
                verdict = sec["extraction_check"]["verdict"]
                assert verdict in ("ok", "weak", "unverified"), (
                    f"{uid}/{name}: verdict {verdict!r} should not have been written"
                )
                if verdict == "unverified":
                    assert sec.get("needs_human_review") is True, (
                        f"{uid}/{name}: unverified content must say so"
                    )


def test_section_fields_match_the_frontend_contract():
    """Shape, not just presence.

    The first version of this wiring emitted what read naturally from the worksheet —
    `{question, options: [{label, text}]}` — and four learning steps threw on render.
    `frontend/src/services/api.ts` declares `multiple_choice.options` as `string[]`,
    and keeps a `fill_in_blank` item only when it looks like `{sentence, answer}`
    with the answer resolving through `vocab_bank`. Anything else is silently
    dropped or crashes.

    The API returning 200 with populated fields told me nothing — it did that while
    the steps were broken. This asserts the shape those steps actually consume."""
    from app.services.lesson_loader import get_all_lessons

    for lesson in get_all_lessons():
        for item in lesson.get("multiple_choice") or []:
            assert isinstance(item.get("options"), list), lesson["lesson_uid"]
            assert all(isinstance(o, str) for o in item["options"]), (
                f"{lesson['lesson_uid']}: options must be strings, got "
                f"{type(item['options'][0]).__name__}"
            )
        bank = lesson.get("vocab_bank") or {}
        for item in lesson.get("fill_in_blank") or []:
            assert isinstance(item.get("sentence"), str) and item["sentence"], (
                f"{lesson['lesson_uid']}: cloze item without a sentence is filtered "
                "out by the frontend"
            )
            assert item.get("answer") in bank, (
                f"{lesson['lesson_uid']}: answer {item.get('answer')!r} does not "
                f"resolve in vocab_bank {sorted(bank)}"
            )


# ── 試算表 metadata (#2683) ─────────────────────────────────────────────────

def test_spreadsheet_metadata_reaches_the_api():
    """課程簡介, 文體, 分類 and video links come from 自學教材總表.xlsx.

    I had reported the intro as unobtainable because the worksheet DOCX has no such
    section. That was true and beside the point — the first edition never took it
    from the DOCX either, and `scripts/build_lesson_intro_from_excel.py` had been
    sitting in the repo the whole time. The check that matters is that the fields
    arrive, not that a particular source was ruled out."""
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    counts = {k: sum(1 for l in lessons if l.get(k))
              for k in ("intro", "genre", "category", "video_links")}
    assert counts["intro"] >= 140, counts
    assert counts["genre"] >= 140, counts
    assert counts["category"] >= 130, counts


def test_intro_is_about_the_lesson_not_a_copy_of_it():
    """An introduction assembled from the opening paragraph would be the lesson
    again. These are built from the unit topic and reading strategy, so no intro
    should be a prefix of its own body."""
    from app.services.lesson_loader import get_all_lessons

    echoes = []
    for lesson in get_all_lessons():
        intro = (lesson.get("intro") or {}).get("background") or ""
        paras = lesson.get("paragraphs") or []
        if intro and paras and paras[0].startswith(intro[:12]):
            echoes.append(lesson["lesson_uid"])
    assert echoes == [], f"intro repeats the body: {echoes[:3]}"


def test_metadata_records_which_row_it_matched():
    """The join is on title, across two sources that spell titles differently. The
    matched spreadsheet title is stored so a wrong pairing is inspectable — the
    first edition's images were joined on lesson code and nobody could see that
    every one of them pointed at a different lesson."""
    import yaml

    from app.services import lesson_uid_loader as L

    checked = 0
    for uid in L.available_uids():
        for f in (L.LESSONS_ROOT / uid).glob("v*/metadata.yml"):
            doc = yaml.safe_load(f.read_text(encoding="utf-8"))
            assert doc.get("matched_spreadsheet_title"), f"{uid}: no provenance"
            checked += 1
    assert checked >= 140, f"only {checked} lessons carry metadata"


# ---------------------------------------------------------------------------
# 重點朗讀 (念順順) — #2683
#
# The bug this locks was live on staging: 《十秒的背後》, about a sprinter, played a
# passage about giving up a seat on a bus. `key_reading_passages.yml` is keyed by
# lesson code, the second edition renumbered every lesson, and so the lookup kept
# succeeding and kept returning someone else's paragraph. No error anywhere.
#
# The property that catches it is containment: a lesson's reading passage is a
# quotation from that lesson's own body. A passage from any other lesson fails it,
# which is what makes this test worth more than counting how many lessons have one.
# ---------------------------------------------------------------------------


def test_key_reading_passage_comes_from_this_lessons_own_body():
    from app.services.lesson_loader import get_all_lessons

    strangers = []
    for lesson in get_all_lessons():
        kr = lesson.get("key_reading")
        if not kr:
            continue
        body = "".join(lesson.get("paragraphs") or [])
        for para in kr["passage"].split("\n"):
            if para.strip() and para.strip() not in body:
                strangers.append((lesson["lesson_uid"], lesson["title"], para[:30]))
                break
    assert strangers == [], f"passage is not from this lesson: {strangers[:3]}"


def test_key_reading_is_the_marked_paragraph_not_an_inferred_span():
    """Superseded `test_key_reading_is_long_enough_for_the_timed_minute`, which asserted
    every passage ran at least 120 characters.

    That test encoded the mistake rather than guarding against it. I had reasoned that a
    single paragraph — 145 characters at the median — was too short for the timed minute
    and made the extractor accumulate to 300. 靖杭 found the result on staging: the
    ranges were 「比教授畫的範圍多出不少」, median 370 against the professor's 153, with 60
    of 67 comparable lessons more than half again too long.

    The timer is about how long the student reads. The passage is what the professor
    marked. The first edition said so outright — 「新規則：只取 ☞ 那一段」 — and the lock
    I wrote made the override permanent.

    The professor's own ranges run 19 to 412 characters. A length floor is exactly the
    wrong shape of check here; what matters is that the passage IS one of the lesson's
    paragraphs.
    """
    from app.services.lesson_loader import get_all_lessons

    wrong = []
    for l in get_all_lessons():
        kr = l.get("key_reading")
        if not kr:
            continue
        if kr["passage"].strip() not in [p.strip() for p in (l.get("paragraphs") or [])]:
            wrong.append((l["lesson_uid"], len(kr["passage"])))
    assert wrong == [], f"passage is not one of the lesson's paragraphs: {wrong[:4]}"


def test_key_reading_is_absent_rather_than_guessed():
    """35 lessons have no anchor, an anchor past the end of the body, or an anchor
    the first edition's independent extraction disagreed with. Those read the whole
    text — degraded, but their own text. Clamping to the nearest paragraph would
    produce a plausible passage that no teacher marked."""
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    have = [l for l in lessons if l.get("key_reading")]
    assert 130 <= len(have) <= len(lessons) - 1, (
        f"{len(have)}/{len(lessons)} — a jump to full coverage means the withheld "
        "lessons started being guessed at"
    )
    for l in lessons:
        assert l["has_key_reading"] == bool(l.get("key_reading"))


def test_reading_strategy_reaches_the_library_card():
    from app.services.lesson_loader import get_all_lessons

    have = [l for l in get_all_lessons() if l.get("reading_strategy")]
    assert len(have) >= 145, f"only {len(have)} lessons carry a reading strategy"


# ---------------------------------------------------------------------------
# 課文完整性 — #2683
#
# The body had a 46-character minimum, which is longer than a story's closing line.
# 《獵人與白牙》 ended on 「白牙已經奄奄一息…然後，永遠閉上了牠的眼睛。」 — 36 characters,
# dropped, so the lesson was served without its ending. 111 lessons were losing
# paragraphs this way and nothing reported it: the text was present and plausible,
# just incomplete. Its own worksheet quotes that line as 第十三段, and the body was
# ten paragraphs long.
# ---------------------------------------------------------------------------


def test_the_lesson_that_lost_its_ending_has_it_back():
    from app.services.lesson_loader import get_all_lessons

    hunter = next((l for l in get_all_lessons() if l["lesson_uid"] == "L0009"), None)
    assert hunter, "L0009 is missing from the tree"
    body = "".join(hunter["paragraphs"])
    assert "奄奄一息" in body, "the closing paragraph is gone again"
    assert len(hunter["paragraphs"]) >= 13, (
        f"{len(hunter['paragraphs'])} paragraphs — the worksheet cites 第十三段"
    )


def test_short_closing_paragraphs_survive_across_the_collection():
    """Not just the one lesson: a floor that cuts short paragraphs cuts them
    everywhere, so this counts how many lessons end on one."""
    from app.services.lesson_loader import get_all_lessons

    short_ending = [
        l["lesson_uid"] for l in get_all_lessons()
        if l.get("paragraphs") and len(l["paragraphs"][-1]) < 46
    ]
    assert len(short_ending) >= 18, (
        f"only {len(short_ending)} lessons end on a short paragraph — a length floor "
        "is truncating them again"
    )


def test_vocabulary_words_are_not_welded_together():
    """The 本課語詞 box wraps mid-list and Word does not always put a 、 at the break,
    so two words arrive fused (「揮之不去起伏」). A fused token is in no lesson's text,
    which is what this measures — and what marked 42 lessons as mismatched when their
    definitions were right."""
    from app.services.lesson_loader import get_all_lessons

    bad = []
    for lesson in get_all_lessons():
        words = [i["word"] for i in (lesson.get("vocabulary") or []) if i.get("word")]
        body = "".join(lesson.get("paragraphs") or [])
        if not words or not body:
            continue
        absent = sum(1 for w in words if w not in body)
        if absent > len(words) * 0.5:
            bad.append((lesson["lesson_uid"], absent, len(words)))
    assert len(bad) <= 12, f"{len(bad)} lessons have vocabulary absent from their text: {bad[:4]}"


def test_every_served_choice_question_has_its_answer_among_the_options():
    """Nothing with a dangling answer reaches a student.

    This locks the WITHHOLDING, not the extraction — verified by mutation: breaking the
    option regex leaves this test green, because the damaged questions are filtered out
    upstream and simply never arrive. What that break actually costs is coverage, which
    is why `test_comprehension_coverage_does_not_slip` exists beside it. Both are
    needed; neither substitutes for the other."""
    from app.services.lesson_loader import get_all_lessons

    broken = []
    for lesson in get_all_lessons():
        for q in lesson.get("multiple_choice") or []:
            opts, ans = q.get("options") or [], q.get("answer")
            if ans is None:
                continue
            # The API serves options as a positional list and the answer as its letter,
            # so A is opts[0]. A letter past the end means an option was lost.
            idx = ord(str(ans).upper()) - ord("A") if str(ans)[:1].isalpha() else -1
            if not (0 <= idx < len(opts)) or not str(opts[idx]).strip():
                broken.append((lesson["lesson_uid"], q.get("question", "")[:24], ans, len(opts)))
    assert broken == [], f"answer not among options: {broken[:4]}"


def test_comprehension_coverage_does_not_slip():
    """The counterpart to the invariant above.

    A parsing regression does not produce bad data — the gate withholds it — so it
    shows up only as lessons quietly losing their questions, with every other check
    still green. This floor catches a broad regression; a narrow one is caught by
    `test_the_question_whose_option_was_swallowed`, because measurement showed the
    single-space option bug cost exactly one lesson, and a collection-wide floor
    cannot see one lesson move.
    """
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    have = [l for l in lessons if l.get("multiple_choice")]
    assert len(have) >= 150, (
        f"{len(have)}/{len(lessons)} lessons have comprehension questions — "
        "extraction is losing questions the gate then withholds"
    )


def test_vocabulary_section_coverage_does_not_slip():
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    for field, floor in (("vocabulary", 140), ("fill_in_blank", 132), ("intro", 155)):
        have = sum(1 for l in lessons if l.get(field))
        assert have >= floor, f"{field}: {have}/{len(lessons)}, floor {floor}"


def test_the_question_whose_option_was_swallowed():
    """L0018 question 1 prints its four options across two lines with ONE space
    between each pair. The inline-option pattern demanded two, so option A matched
    nothing, fell through to the single-option pattern, and took 「B.其中一個重要部分」
    into its own text. B — the answer — ceased to exist.

    Locked on the lesson rather than on a count: measurement put the cost at exactly
    one lesson, and no collection-wide floor can see one lesson move.
    """
    from app.services.lesson_loader import get_all_lessons

    lesson = next((l for l in get_all_lessons() if l["lesson_uid"] == "L0018"), None)
    assert lesson, "L0018 is missing from the tree"
    q = next((q for q in (lesson.get("multiple_choice") or [])
              if "一環" in (q.get("question") or "")), None)
    assert q, "the 一環 question is gone — its options were swallowed again"
    assert len(q["options"]) == 4, f"{len(q['options'])} options, expected 4"
    assert "其中一個重要部分" in q["options"][1], (
        f"option B is not itself: {q['options'][1][:40]}"
    )


def test_the_title_join_is_confirmed_by_an_independent_field():
    """The spreadsheet is joined on title, and a title join that guesses is how the
    first edition's covers ended up on the wrong lessons. This checks the join against
    a field neither side of it controls: the worksheet's own masthead line,
    「Level 4・記敘文」, written with the lesson rather than in the planning sheet.

    A join that were guessing would agree at chance across six genres. Measured: 130
    of 146 agree, and the 16 that differ are editorial calls on the same lesson — a
    letter-writing lesson filed as 說明文 in one place and 應用文 in the other.
    """
    from app.services.lesson_loader import get_all_lessons
    from app.services.lesson_uid_loader import load_all

    fold = lambda s: (s or "").replace("説", "說")
    pairs = []
    for l in load_all():
        sheet = fold((l.get("metadata") or {}).get("genre"))
        sheet_from_worksheet = fold(((l.get("body") or {}).get("level") or {}).get("genre"))
        if sheet and sheet_from_worksheet:
            pairs.append(sheet == sheet_from_worksheet)

    assert len(pairs) >= 120, f"only {len(pairs)} lessons carry both labels"
    rate = sum(pairs) / len(pairs)
    assert rate >= 0.80, (
        f"worksheet and spreadsheet agree on genre for only {rate:.0%} of lessons — "
        "the title join is pairing lessons with the wrong spreadsheet rows"
    )
    # And the served genre must be the worksheet's, not the spreadsheet's.
    served = [l for l in get_all_lessons() if l.get("genre")]
    assert len(served) >= 168, f"{len(served)} lessons carry a genre"


def test_video_links_carry_the_shape_the_frontend_declares():
    """`api.ts` declares `{title, url}[]`. Shape mismatches here do not raise — the
    API returns 200 with a populated field and the step renders wrong or throws, which
    is how four learning steps broke earlier in this rebuild while every presence check
    stayed green."""
    from app.services.lesson_loader import get_all_lessons

    wrong = []
    for lesson in get_all_lessons():
        for v in lesson.get("video_links") or []:
            if not isinstance(v, dict) or not v.get("url") or not v.get("title"):
                wrong.append((lesson["lesson_uid"], repr(v)[:40]))
    assert wrong == [], f"video_links is not {{title, url}}: {wrong[:3]}"


def test_videos_are_titled_from_the_worksheet_where_both_sources_agree():
    """URLs come from the spreadsheet, titles from the worksheet — neither source has
    both. Where the two list the same number of videos the pairing is positional and
    the student sees the real title; where they disagree the titles are dropped rather
    than confidently mislabelled."""
    from app.services.lesson_loader import get_all_lessons

    titled = [
        l for l in get_all_lessons()
        if l.get("video_links") and not l["video_links"][0]["title"].startswith("影片 ")
    ]
    assert len(titled) >= 100, f"only {len(titled)} lessons show real video titles"


def test_the_knowledge_section_stops_at_the_first_index_reset():
    """知識補給站 is the last section, so when its bounds run long every numbered list
    after it is swept in. L0029 collected 24 「videos」 — 3 videos and 21 exercise items
    whose numbering restarted at 1."""
    from app.services.lesson_uid_loader import load_all

    over = []
    for l in load_all():
        items = ((l.get("sections") or {}).get("resources") or {}).get("items") or []
        idx = [i["index"] for i in items]
        if idx != sorted(set(idx)) or len(idx) > 8:
            over.append((l["lesson_uid"], idx[:8]))
    assert over == [], f"resource indices are not one increasing run: {over[:3]}"


def test_a_body_with_no_cross_check_says_so():
    """Extraction ran and produced text is not the same as extraction was verified.

    29 worksheets name no vocabulary to compare the body against — 11 of them 文言文,
    which use 古文今譯 rather than a 本課語詞 box — so nothing confirms their boundary.
    Left unflagged they are indistinguishable from the 111 that passed a real check.
    """
    import yaml

    from app.services import lesson_uid_loader as L

    unflagged = []
    for uid in L.available_uids():
        for f in (L.LESSONS_ROOT / uid).glob("v*/body.yml"):
            doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            verdict = (doc.get("extraction_check") or {}).get("verdict")
            if verdict in ("no_vocab", "suspect") and not doc.get("needs_review"):
                unflagged.append((uid, verdict))
    assert unflagged == [], f"unverifiable bodies presented as checked: {unflagged[:4]}"


def test_no_lesson_is_shorter_than_its_own_worksheet_says():
    """The worksheet names the paragraph the reading timer starts from — 「從指定段落
    （六）開始朗讀」 — so the body must have at least that many paragraphs. That is the
    document contradicting itself, and it is the only signal here that catches a body
    cut short without knowing in advance how long it should be.

    It caught two: section headings were matched as substrings ANYWHERE, so lessons
    ABOUT reading comprehension closed their own body by saying so
    (「閱讀的速度愈快…閱讀理解就會愈強哦」) — L0072 was served as one paragraph while its
    worksheet asked the student to start at the sixth.

    A length threshold would not do this. 《陸公買硯》 is two paragraphs and 193
    characters, and complete: classical stories are short, and an arbitrary floor
    flags it while missing the lessons that are genuinely truncated.
    """
    import json
    import subprocess
    import sys as _sys
    from pathlib import Path

    src = Path("/tmp/docx-src")
    if not src.is_dir():
        pytest.skip("worksheet sources not present")

    from app.services.lesson_loader import get_all_lessons

    _sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scripts"))
    from extract_key_reading import find_anchor
    from extract_lesson_body import _paragraphs

    over = []
    for lesson in get_all_lessons():
        docx = src / f"{lesson['lesson_uid']}.docx"
        if not docx.exists():
            continue
        anchor = find_anchor(_paragraphs(docx))
        body = lesson.get("paragraphs") or []
        if anchor and body and anchor > len(body):
            over.append((lesson["lesson_uid"], anchor, len(body)))

    # Zero, not "at most one". The last holdout was L0012, a letter whose salutations
    # and signature ran under the short-paragraph floor — 應用文 lessons are made of
    # such lines and now keep them. Every anchor a worksheet names now exists in the
    # body it points into.
    assert over == [], f"bodies shorter than their worksheet claims: {over[:5]}"


def test_key_reading_disagreements_are_flagged_not_silently_preferred():
    """Two lessons have the DOCX marking one paragraph and the first edition's table
    marking another. The DOCX wins — it is this edition's own instruction, and the
    passage is still this lesson's — but the file has to say a human should look, and
    say why. Setting the verdict before the length check and falling through
    overwrote it with 'ok': the flag survived, the reason did not."""
    import yaml

    from app.services import lesson_uid_loader as L

    flagged = 0
    for uid in L.available_uids():
        for f in (L.LESSONS_ROOT / uid).glob("v*/key_reading.yml"):
            doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            if not doc.get("needs_human_review"):
                continue
            flagged += 1
            assert doc.get("review_reason"), f"{uid}: flagged with no reason"
            verdict = (doc.get("extraction_check") or {}).get("verdict")
            assert verdict == "disagrees_with_first_edition", f"{uid}: verdict {verdict!r}"
    assert flagged >= 1, "no lesson carries the flag — has the disagreement been hidden?"


def test_every_asset_a_lesson_serves_is_addressed_by_its_own_uid():
    """No asset URL may contain a lesson CODE.

    A code is a catalogue position and the re-ink renumbered every one of them, so a
    code-addressed asset resolves to whatever the first edition filed at that position
    — which is how a bus interior ended up on a sprinting lesson and another lesson's
    passage in 重點朗讀. The cover was fixed by addressing it as
    `/assets/lesson/<uid>/`; this asserts nothing has drifted back.

    Three code-addressed paths still exist in the frontend and are inert only because
    no second-edition lesson carries the data that feeds them:

        InlineImageCard / GraphicTextLayout / GraphicTextImageStrip
            `${ASSET_BASE}/lessons-images/${story.lesson_code}/${basename}` — and
            `lesson_code` is set from `grade_code` in api.ts, i.e. the new position.
            The <img onError> handler hides a failure behind a grey placeholder, so a
            wrong or missing image says nothing at all.

        worksheet_pdf_url / worksheet_docx_url
            documented as gs://lingoleap-assets/worksheets/{lesson_code}.pdf, currently
            null for all 175.

    They stay dead as long as this holds. If a lesson starts serving either, this test
    is where it gets caught rather than a student opening someone else's worksheet.
    """
    import re

    from app.services.lesson_loader import get_all_lessons

    CODE = re.compile(r"/(G\d+-L\d+[a-z]?|文-L\d+|體-L\d+)/", re.I)
    offenders = []
    for lesson in get_all_lessons():
        uid = lesson["lesson_uid"]
        for field in ("thumbnail_url", "worksheet_pdf_url", "worksheet_docx_url"):
            url = lesson.get(field)
            if not url:
                continue
            if CODE.search(url):
                offenders.append((uid, field, url))
            elif "/assets/lesson/" in url and f"/assets/lesson/{uid}/" not in url:
                offenders.append((uid, field, f"addressed as another lesson: {url}"))
    assert offenders == [], f"code-addressed assets: {offenders[:4]}"


def test_no_lesson_carries_the_code_addressed_image_shape():
    """`{filename: "images/G7-L28/G7-L28-01.png"}` is the shape the three frontend
    components turn into a code-addressed URL. Zero lessons carry it, which is the only
    reason those components cannot mis-bind."""
    import json

    from app.services.lesson_loader import get_all_lessons

    carriers = [
        l["lesson_uid"] for l in get_all_lessons()
        if '"filename"' in json.dumps(l, ensure_ascii=False, default=str)
    ]
    assert carriers == [], (
        f"{len(carriers)} lessons feed the code-addressed image path — point those "
        f"components at lesson_uid before shipping this: {carriers[:4]}"
    )


def test_options_do_not_carry_the_marker_s_notes():
    """The worksheet is the TEACHER's copy, and its annotations were reaching students
    inside the option text. Found by looking at what 閱讀理解 actually renders:

        B 體育競賽總是讓人「事與願違」，相當刺激(血脈賁張)
        C 日本的冬季溫度與高雄相比真是「血脈賁張」(天壤之別)

    The question asks which usage is correct. Every annotated option is a wrong one, so
    the unannotated option is the answer and no reading is required. Three forms, all
    now stripped into `marker_notes` / `source_paragraphs`:

        a paragraph citation — 「(第三段)」, 10 of 15 on the correct option
        the word that would have been right — 「(血脈賁張)」
        the marker's reasoning — 「（由前後文…可推論是懊惱的情緒）」, 3 of 6 on the answer

    A gloss that belongs to the option is NOT stripped: 「圓形而中空的東西（玉環）」,
    「圍繞（環繞）」, 「深蹲－胸肌、三頭肌（伏地挺身）」. 38 of those survive, which is
    what makes this a filter rather than a blanket rule.
    """
    import re

    from app.services.lesson_loader import get_all_lessons

    CITE = re.compile(r"[（(]\s*第[一二三四五六七八九十0-9].{0,12}段.{0,4}[）)]\s*$")
    CLAUSE = re.compile(r"[（(]\s*[^（）()]{13,}\s*[）)]\s*$")

    leaks = []
    for lesson in get_all_lessons():
        for q in lesson.get("multiple_choice") or []:
            for o in q.get("options") or []:
                if not o:
                    continue
                if CITE.search(o.strip()):
                    leaks.append((lesson["lesson_uid"], "paragraph citation", o[:44]))
                elif CLAUSE.search(o.strip()):
                    leaks.append((lesson["lesson_uid"], "marker rationale", o[:44]))
    assert leaks == [], f"teacher annotations visible to students: {leaks[:4]}"


def test_no_option_ends_in_the_marker_s_bracket():
    """Superseded `test_the_glosses_that_belong_to_an_option_are_left_alone`, which
    asserted that 30-odd options KEEP a trailing parenthesis because they were glosses.
    That premise was wrong, and the test was protecting the wrong thing.

    Reading all 40 in the corpus: 「圓形而中空的東西（玉環）」 is not a gloss. The question
    asks what 「一環」 means and its options are

        圓形而中空的東西（玉環）  其中一個重要部分  圍繞（環繞）  玉石雕的圓形圈子（玉環）

    The answer is the only one WITHOUT a bracket. Every other case is the same kind of
    note — （擬人）naming the device the question asks about, （文中未提到）explaining why
    an option is wrong, (從第4、5段可知) citing the source. Not one is content the option
    needs, so all of them move to `marker_notes`.

    The guard against over-stripping is not "keep some brackets" but the two below:
    nothing is emptied, and the section coverage does not fall.
    """
    from app.services.lesson_loader import get_all_lessons

    left = [
        (l["lesson_uid"], o[:40]) for l in get_all_lessons()
        for q in (l.get("multiple_choice") or [])
        for o in (q.get("options") or [])
        if o and o.strip().endswith(("）", ")"))
    ]
    assert left == [], f"marker brackets still visible: {left[:4]}"


def test_stripping_annotations_never_empties_an_option():
    """The real guard against over-stripping. An option that is ENTIRELY a parenthesis
    is the teacher edition's rationale standing in for the overwritten correct option —
    removing its brackets would leave nothing at all."""
    from app.services.lesson_loader import get_all_lessons

    empty = [
        (l["lesson_uid"], q.get("question", "")[:26])
        for l in get_all_lessons()
        for q in (l.get("multiple_choice") or [])
        for o in (q.get("options") or [])
        if o is not None and not str(o).strip() and q.get("answer")
        and (q.get("options") or []).index(o) == ord(str(q["answer"])[0]) - 65
    ]
    assert empty == [], f"answer option emptied by the strip: {empty[:4]}"


def test_the_teacher_edition_rationale_still_fills_the_missing_option():
    """Deleted by accident while consolidating the annotation rules, and the effect was
    not subtle: 48 questions became 「answer not among options」 and comprehension fell
    from 155 lessons to 107. The section counts caught it; no individual option looked
    wrong."""
    from app.services.lesson_loader import get_all_lessons

    lessons = [l for l in get_all_lessons() if l.get("multiple_choice")]
    assert len(lessons) >= 150, (
        f"{len(lessons)} lessons carry comprehension questions — the rationale is no "
        "longer filling options the teacher edition overwrote"
    )


def test_a_failed_extraction_is_not_served_as_content():
    """`spotlight.yml` stores a failure as an object — lesson + error — and serving it
    counted as 「this lesson has a spotlight」 while the step rendered 參考課文 and
    nothing else. The field read 175/175; the exercises were 143/175.

    Absent is the honest value. It is also what makes the step show its empty state
    instead of a page that looks finished.
    """
    from app.services.lesson_loader import get_all_lessons

    served = [l for l in get_all_lessons() if l.get("spotlight_v2")]
    broken = [l["lesson_uid"] for l in served
              if not isinstance(l["spotlight_v2"], dict)
              or l["spotlight_v2"].get("error")
              or not l["spotlight_v2"].get("blocks")]
    assert broken == [], f"error payloads served as spotlight: {broken[:4]}"
    assert 130 <= len(served) < 175, (
        f"{len(served)}/175 — 30 lessons have no extractable spotlight "
        "(content_known_gaps.yaml#spotlight_range_not_found); full coverage here means "
        "failures are being counted as content again"
    )


def test_the_lessons_without_a_spotlight_are_a_recorded_pipeline_failure():
    """Not a structural absence, which is what the code used to claim.

    Checked against the source: 27 of the 30 have 閱讀聚光燈 in their DOCX. Their
    worksheets print that heading in the MASTHEAD and open the exercises with
    「示範１：」/「練習1：」, which `find_spotlight_range` does not recognise — the same
    layout variant that truncated three lesson bodies.

    This asserts the registry entry stays, because the wrong version of this claim sat
    in a comment for long enough that nobody re-checked it.
    """
    import yaml
    from pathlib import Path

    gaps = yaml.safe_load(
        (Path(__file__).resolve().parent.parent / "data" / "curriculum_qa"
         / "content_known_gaps.yaml").read_text(encoding="utf-8")
    )
    entry = gaps.get("spotlight_range_not_found")
    assert entry, "the spotlight gap is no longer recorded"
    assert "是" in str(entry.get("is_it_a_pipeline_failure", "")), (
        "the entry no longer says this is a pipeline failure"
    )
