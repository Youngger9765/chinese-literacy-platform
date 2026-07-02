"""Fidelity tests for the three round-N fixes in scripts/spotlight_to_lesson_content.py.

These exercise the REAL corpus (backend/data/lessons/spotlight/{catalog,dev7}/*.spotlight.yml
+ backend/data/lessons/_parsed_2026-05-01/*.yml — never mocked) and assert the honesty
invariants of each fix:

  Gap 1 — range/補零/suffix-aware ``_parsed`` keypoints lookup: the 5 named catalog lessons
          whose story_structure_table lives in a MERGED range file or a suffix-stripped base
          file now emit a keypoints_table exercise (were ``no_keypoints_source``), each
          honestly flagged ``needs_review`` + a merged_range / suffix gap reason. Bare-first
          resolution is kept so a G8 block whose bare file and curriculum override DISAGREE is
          NOT mis-bound (張冠李戴).

  Gap 2 — keypoints_table anchor semantics: keypoints anchors to the passage/table blocks it
          summarizes (figures only for pure-圖文 lessons). A source with ZERO presentation
          blocks keeps anchors=[] + needs_review + ``no_anchorable_passage_in_source`` (honest
          NEEDS_REVIEW, never a fake green). ``_exercise_anchoring_ok`` encodes the judgment.

  Gap 3 — no silent drop: ``match`` blocks (answer-bearing) become a ``custom`` exercise
          (needs_review) that preserves every left→right answer + logs
          ``matching_type_unsupported``. ``fill_table`` bare stubs yield no block but are logged
          ``fill_table_stub_no_inline_content``. ``guide`` / ``self_check`` stay non-exercises.

Run: cd backend && python -m pytest tests/test_spotlight_adapter_fidelity.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "backend"))
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

from app.schemas.lesson_content import Lesson  # noqa: E402
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402

import spotlight_to_lesson_content as adapter  # noqa: E402
import eval_lesson_content as ev  # noqa: E402

_SPOTLIGHT_ROOT = _REPO_ROOT / "backend" / "data" / "lessons" / "spotlight"


# ── helper: build any lesson from any set dir (adapter is hard-wired to dev7) ───


def _build_from_set(setname: str, code: str, with_keypoints: bool = True):
    """Assemble a lesson dict from spotlight/<setname>/<code>.spotlight.yml the SAME way the
    runner does (load_spotlight → load_parsed → assemble_lesson → validate). Returns
    (Lesson, GapLog, parsed_kind)."""
    path = _SPOTLIGHT_ROOT / setname / f"{code}.spotlight.yml"
    spot = adapter.load_spotlight(path)
    lesson_code = normalize_manifest_code(str(spot.get("lesson") or code))
    parsed, parsed_kind = adapter.load_parsed(lesson_code)
    gaps = adapter.GapLog()
    lesson_dict = adapter.assemble_lesson(spot, parsed, gaps, with_keypoints, parsed_kind)
    lesson = Lesson.model_validate(lesson_dict)  # fail LOUD on mapping bug
    return lesson, gaps, parsed_kind


def _ex(lesson: Lesson, ex_id: str):
    for b in lesson.blocks:
        if b.type == "exercise" and b.id == ex_id:
            return b
    return None


def _reasons(gaps: adapter.GapLog, code: str) -> set[str]:
    return {g["reason"] for g in gaps.for_lesson(code)}


# ═══════════════════════════════════════════════════════════════════════════
#  GAP 1 — range/suffix-aware parsed lookup recovers the 5 named cases
# ═══════════════════════════════════════════════════════════════════════════

# (lesson_code, expected parsed source kind). These are the 5 the round targeted; keyed by the
# STRUCTURAL property (merged-range vs suffix-base), not by hardcoded story content.
_RANGE_CASES = ["G4-L20", "G5-L24", "G9-L15", "G9-L17"]
_SUFFIX_CASE = "G8-L9a"


@pytest.mark.parametrize("code", _RANGE_CASES)
def test_gap1_merged_range_recovers_keypoints(code):
    lesson, gaps, kind = _build_from_set("catalog", code, with_keypoints=True)
    assert kind == "merged_range", (code, kind)
    kp = _ex(lesson, "ex-keypoints")
    assert kp is not None, f"{code}: expected recovered ex-keypoints"
    assert kp.question.kind == "keypoints_table"
    assert isinstance(kp.answer, dict) and kp.answer, "keypoints answer must be a non-empty dict"
    # honesty: merged range = approximate for one lesson → flagged + logged, NOT faked clean
    assert kp.needs_review is True
    assert "keypoints_source_is_merged_range" in _reasons(gaps, code)
    # NOT re-logged as a false "no source" — it WAS recovered
    assert "no_keypoints_source" not in _reasons(gaps, code)
    # round-trip still fine (exact grader on the recovered blanks)
    assert ev.answer_round_trip(kp) != "fail"


def test_gap1_suffix_base_recovers_keypoints():
    code = _SUFFIX_CASE
    lesson, gaps, kind = _build_from_set("catalog", code, with_keypoints=True)
    assert kind == "suffix_base", (code, kind)
    kp = _ex(lesson, "ex-keypoints")
    assert kp is not None, f"{code}: expected recovered ex-keypoints via suffix-strip"
    assert kp.question.kind == "keypoints_table"
    assert kp.needs_review is True
    assert "keypoints_source_suffix_resolved" in _reasons(gaps, code)
    assert "no_keypoints_source" not in _reasons(gaps, code)


def test_gap1_resolver_prefers_exact_over_override_no_zhangguanlidai():
    """A G8 catalog code whose BARE-normalized parsed file exists but whose curriculum override
    (catalog_to_parsed_code) points at a DIFFERENT file must resolve to the BARE file — routing
    through the override would attach a neighbour's story (張冠李戴). We assert the resolver
    keeps kind='exact' (bare) for every such divergent code, so no keypoints_source_* range/
    suffix flag is (wrongly) raised for a code whose exact twin is present."""
    from app.services.lesson_code_normalization import catalog_to_parsed_code

    parsed_dir = adapter.PARSED_DIR
    divergent = []
    for p in sorted((_SPOTLIGHT_ROOT / "catalog").glob("*.spotlight.yml")):
        spot = adapter.load_spotlight(p)
        norm = normalize_manifest_code(str(spot.get("lesson") or ""))
        auth = catalog_to_parsed_code(norm)
        bare_present = (parsed_dir / f"{norm}.yml").exists()
        if norm != auth and bare_present:
            divergent.append(norm)
    assert divergent, "expected >=1 G8 divergent (bare present, override points elsewhere)"
    for norm in divergent:
        path, kind = adapter.resolve_parsed_source(norm)
        assert kind == "exact", (norm, kind)
        assert path == parsed_dir / f"{norm}.yml"


def test_gap1_missing_sl_codes_stay_no_source():
    """test15 SL-codes (e.g. G*-SL*) have no L-parsed twin, no range, no suffix → they must
    stay honestly 'none' (→ no_keypoints_source), NOT be force-fit to a neighbour."""
    checked = 0
    for p in sorted((_SPOTLIGHT_ROOT / "test15").glob("*-SL*.spotlight.yml")):
        spot = adapter.load_spotlight(p)
        norm = normalize_manifest_code(str(spot.get("lesson") or ""))
        _, kind = adapter.load_parsed(norm)
        assert kind == "none", (norm, kind)
        checked += 1
    assert checked >= 1, "expected >=1 SL-code with no parsed twin"


# ═══════════════════════════════════════════════════════════════════════════
#  GAP 2 — keypoints anchor semantics + legit-unanchorable judgment
# ═══════════════════════════════════════════════════════════════════════════


def test_gap2_keypoints_anchors_to_passage_when_present():
    """A DEV7 lesson WITH passage blocks: keypoints anchors to those paragraph (p*) blocks,
    never to a lone figure (the old semantically-wrong last-figure anchor)."""
    # G6-L22 has 4 passage blocks (verified real source).
    lesson, gaps, _ = _build_from_set("dev7", "G6-L22", with_keypoints=True)
    kp = _ex(lesson, "ex-keypoints")
    assert kp is not None
    anchor_ids = {a.block_id for a in kp.anchors}
    assert anchor_ids, "keypoints must anchor to the passage it summarizes"
    assert all(a.startswith("p") for a in anchor_ids), anchor_ids
    assert kp.needs_review is False  # clean exact source + real passage anchor
    assert ev.lesson_coverage(lesson)["all_anchored"] is True


def test_gap2_figure_only_lesson_anchors_figures_not_penalized():
    """A pure-圖文 lesson (figures, no passage/table) legitimately anchors its keypoints to the
    figures — it stays anchored (not forced to needs_review)."""
    # G7-L29 = 從四張圖…(5 figures, no passage). Verified real source.
    lesson, gaps, _ = _build_from_set("dev7", "G7-L29", with_keypoints=True)
    kp = _ex(lesson, "ex-keypoints")
    assert kp is not None
    anchor_ids = {a.block_id for a in kp.anchors}
    assert anchor_ids and all(a.startswith("fig") for a in anchor_ids), anchor_ids
    assert kp.needs_review is False
    assert "no_anchorable_passage_in_source" not in _reasons(gaps, lesson.lesson_code)


def test_gap2_no_presentation_source_is_honest_needs_review_not_fake_green():
    """A lesson whose source has ZERO presentation blocks keeps anchors=[] + needs_review +
    no_anchorable_passage_in_source. It is a legitimate 'no in-document span' FACT →
    reclassified to NEEDS_REVIEW (🟡), NEVER a fake green (🟢)."""
    # G6-L24 = guide/single/fill_table/self_check only, no passage/figure (verified).
    lesson, gaps, _ = _build_from_set("dev7", "G6-L24", with_keypoints=True)
    for ex_id in ("ex-spotlight", "ex-keypoints"):
        ex = _ex(lesson, ex_id)
        assert ex is not None
        assert ex.anchors == [], f"{ex_id} should have no anchor (no presentation source)"
        assert ex.needs_review is True, f"{ex_id} must be flagged needs_review (honest)"
    assert "no_anchorable_passage_in_source" in _reasons(gaps, lesson.lesson_code)
    cov = ev.lesson_coverage(lesson)
    # all_anchored is True ONLY because the empty-anchor exercises are honestly needs_review.
    assert cov["all_anchored"] is True
    assert cov["n_needs_review"] >= 1  # so the lesson lands NEEDS_REVIEW, not GREEN


def test_gap2_anchoring_ok_helper_rejects_unflagged_empty():
    """_exercise_anchoring_ok is additive & cannot manufacture a green: an exercise with 0
    anchors AND needs_review=False (a real anchoring bug) is still NOT anchoring-ok."""
    lesson_dict = {
        "id": "T", "lesson_code": "T",
        "blocks": [
            {"id": "p1", "type": "paragraph", "text": "錨點"},
            {
                "id": "ex-x", "type": "exercise",
                "question": {"kind": "guided_steps", "strategy_name": "s", "instruction": "i",
                             "steps": [{"prompt": "q", "type": "free_text", "answer": None}]},
                "answer_space": "free_text", "answer": [None], "grader": "rubric_ai",
                "anchors": [], "needs_review": False,
            },
        ],
    }
    lesson = Lesson.model_validate(lesson_dict)
    ex = _ex(lesson, "ex-x")
    assert ev._exercise_anchoring_ok(ex) is False  # empty + not flagged = real bug
    assert ev.lesson_coverage(lesson)["all_anchored"] is False


# ═══════════════════════════════════════════════════════════════════════════
#  GAP 3 — no silent drop: match / fill_table / guide / self_check
# ═══════════════════════════════════════════════════════════════════════════


def test_gap3_match_block_emitted_as_custom_no_silent_drop():
    """The catalog lesson with ``match`` blocks emits a custom ex-match preserving every
    right-hand answer + logs matching_type_unsupported — the answers are NEVER dropped."""
    # G5-L8 has 2 answer-bearing match blocks (verified real source).
    lesson, gaps, _ = _build_from_set("catalog", "G5-L8", with_keypoints=True)
    match_ex = _ex(lesson, "ex-match")
    assert match_ex is not None, "match answers were silently dropped!"
    assert match_ex.question.kind == "custom"
    assert match_ex.needs_review is True  # custom MUST be needs_review (contract) + honest
    # answer is machine-comparable (list of right-hand values), not prose
    assert isinstance(match_ex.answer, list) and len(match_ex.answer) >= 1
    assert all(isinstance(a, str) and a for a in match_ex.answer)
    assert "matching_type_unsupported" in _reasons(gaps, lesson.lesson_code)
    # round-trips as soft (manual grader), never fail
    assert ev.answer_round_trip(match_ex) == "soft"
    # contract was NOT extended: no new 'match' kind leaked into the schema union
    from app.schemas import lesson_content as lc
    assert not hasattr(lc, "MatchQuestion")


def test_gap3_match_preserves_every_pair():
    """Every left→right pair in the source match blocks is preserved (count parity)."""
    path = _SPOTLIGHT_ROOT / "catalog" / "G5-L8.spotlight.yml"
    spot = adapter.load_spotlight(path)
    src_pairs = 0
    for b in spot.get("blocks", []) or []:
        if b.get("type") == "match":
            for r in b.get("rows", []) or []:
                if isinstance(r, dict) and str(r.get("left") or "").strip() and str(r.get("right") or "").strip():
                    src_pairs += 1
    assert src_pairs >= 1
    lesson, _, _ = _build_from_set("catalog", "G5-L8")
    match_ex = _ex(lesson, "ex-match")
    assert len(match_ex.answer) == src_pairs, (len(match_ex.answer), src_pairs)


def test_gap3_fill_table_stub_logged_not_silent():
    """A lesson containing a bare fill_table {type} stub logs
    fill_table_stub_no_inline_content (the empty-stub skip is on the record, not silent)."""
    # G6-L22 has exactly one fill_table stub (verified real source) + a real keypoints source.
    lesson, gaps, _ = _build_from_set("dev7", "G6-L22", with_keypoints=True)
    assert "fill_table_stub_no_inline_content" in _reasons(gaps, lesson.lesson_code)
    # the stub yields NO fill_table block (its content is recovered as ex-keypoints instead)
    assert _ex(lesson, "ex-keypoints") is not None
    kinds = {b.question.kind for b in lesson.blocks if b.type == "exercise"}
    assert "keypoints_table" in kinds


def test_gap3_guide_self_check_not_emitted_as_exercise():
    """guide / self_check are 教學鷹架 / 後設認知檢核 — never emitted as exercises. A lesson made
    of only guide/self_check/passage yields no spotlight/match exercise for those types."""
    # G8-L9a source = guide/figure/self_check only (no single/multi/free_text/match) → the only
    # exercise it can produce is the recovered ex-keypoints, never a guide/self_check exercise.
    lesson, _, _ = _build_from_set("catalog", "G8-L9a", with_keypoints=True)
    ex_ids = {b.id for b in lesson.blocks if b.type == "exercise"}
    assert "ex-spotlight" not in ex_ids  # no single/multi/free_text steps to build one
    assert "ex-match" not in ex_ids      # no match blocks
    # (the recovered keypoints IS allowed; that comes from _parsed, not from guide/self_check)


# ═══════════════════════════════════════════════════════════════════════════
#  CORPUS-WIDE HONESTY — zero silent drop of any answer-bearing block
# ═══════════════════════════════════════════════════════════════════════════


def test_no_answer_bearing_block_silently_dropped_corpus_wide():
    """For EVERY spotlight in the full corpus, any answer-bearing block type (match, or a
    fill_table carrying inline content) is either surfaced as an exercise OR logged as a known
    gap — never dropped without a trace."""
    drops: list[tuple[str, str]] = []
    for setname in ("dev7", "test15", "catalog"):
        set_dir = _SPOTLIGHT_ROOT / setname
        if not set_dir.is_dir():
            continue
        for p in sorted(set_dir.glob("*.spotlight.yml")):
            spot = adapter.load_spotlight(p)
            code = normalize_manifest_code(str(spot.get("lesson") or ""))
            parsed, kind = adapter.load_parsed(code)
            gaps = adapter.GapLog()
            lesson_dict = adapter.assemble_lesson(spot, parsed, gaps, True, kind)
            Lesson.model_validate(lesson_dict)  # also proves 0 schema-fail corpus-wide
            emitted_kinds = {
                b["question"]["kind"] for b in lesson_dict["blocks"] if b.get("type") == "exercise"
            }
            reasons = _reasons(gaps, code)
            for b in spot.get("blocks", []) or []:
                t = b.get("type")
                if t == "match":
                    if "matching_type_unsupported" not in reasons and "custom" not in emitted_kinds:
                        drops.append((code, "match"))
                elif t == "fill_table" and set(b.keys()) != {"type"}:
                    # a fill_table WITH inline content would need explicit handling
                    drops.append((code, "fill_table_with_content"))
    assert drops == [], f"silently dropped answer-bearing blocks: {drops}"
