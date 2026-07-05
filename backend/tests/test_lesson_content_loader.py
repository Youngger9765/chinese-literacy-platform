"""Tests for app/services/lesson_content_loader.py — runtime supply of the typed
``Lesson`` contract to the story-detail API (閱讀聚光燈 EDD, DARK wiring).

Covers the handoff §4-#2 wiring contract:
  * flag OFF (default)                          → None (byte-identical premise)
  * no spotlight_v2 source                      → None
  * flag ON + real spotlight_v2                 → dict that passes Lesson.model_validate,
                                                  top-level keys == {id, lesson_code, title,
                                                  blocks}, JSON-serializable
  * identity (content-mapping-integrity 鐵律)   → lesson_code == normalize(spot["lesson"]),
                                                  block-level needs_review honestly carried,
                                                  GREEN course has no needs_review
  * fail-closed                                 → adapter ValidationError/Exception → None,
                                                  never raised
  * lru_cache                                   → same story id ⇒ same object, adapter runs once
  * supply regression                           → ALL spotlight_v2-bearing stories produce a
                                                  json-dumpable dict, 0 FAIL, 0 identity drift

Reads the REAL in-memory lessons + REAL dev7/catalog spotlight sources (never mocked,
except the deliberate fail-closed monkeypatch). Uses the loader's own
``_reset_caches_for_test`` between flag/env changes.

Run: cd backend && python -m pytest tests/test_lesson_content_loader.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "backend"))
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

from app.schemas.lesson_content import Lesson  # noqa: E402
from app.services import lesson_content_loader as L  # noqa: E402
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402
from app.services.lesson_loader import get_all_lessons  # noqa: E402

FLAG = "LESSON_RENDERER_V1"


# ─── fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """Each test starts flag-OFF (set explicitly, since the code default is now ON) with
    cleared caches; restore after."""
    monkeypatch.setenv(FLAG, "false")
    L._reset_caches_for_test()
    yield
    L._reset_caches_for_test()


def _spotlight_stories() -> list[dict]:
    return [s for s in get_all_lessons() if s.get("spotlight_v2")]


def _first_spotlight_story() -> dict:
    stories = _spotlight_stories()
    assert stories, "expected at least one lesson with spotlight_v2 in the corpus"
    return stories[0]


def _flag_on(monkeypatch):
    monkeypatch.setenv(FLAG, "true")
    L._reset_caches_for_test()


# ─── 1. flag OFF → None (byte-identical premise) ────────────────────────────────


def test_flag_off_returns_none():
    story = _first_spotlight_story()
    # flag explicitly OFF (autouse fixture set it to "false")
    assert L.get_lesson_content(story) is None


def test_flag_off_case_insensitive_and_non_true_values(monkeypatch):
    story = _first_spotlight_story()
    for val in ("", "false", "0", "TRUE!", "yes", "on"):
        monkeypatch.setenv(FLAG, val)
        L._reset_caches_for_test()
        assert L.get_lesson_content(story) is None, f"{val!r} must NOT enable supply"


def test_flag_default_on_when_unset(monkeypatch):
    # Code default is now ON: an UNSET flag must ENABLE supply (go-live default).
    story = _first_spotlight_story()
    monkeypatch.delenv(FLAG, raising=False)
    L._reset_caches_for_test()
    assert L.get_lesson_content(story) is not None


# ─── 2. no source → None ────────────────────────────────────────────────────────


def test_no_spotlight_v2_returns_none(monkeypatch):
    _flag_on(monkeypatch)
    assert L.get_lesson_content({"id": 999999, "grade_code": "G4-L04"}) is None


def test_empty_spotlight_v2_returns_none(monkeypatch):
    _flag_on(monkeypatch)
    assert L.get_lesson_content({"id": 999998, "spotlight_v2": {}}) is None


def test_non_dict_story_returns_none(monkeypatch):
    _flag_on(monkeypatch)
    assert L.get_lesson_content(None) is None  # type: ignore[arg-type]
    assert L.get_lesson_content("not a dict") is None  # type: ignore[arg-type]


def test_story_without_id_returns_none(monkeypatch):
    _flag_on(monkeypatch)
    story = dict(_first_spotlight_story())
    story.pop("id", None)
    assert L.get_lesson_content(story) is None


# ─── 3. flag ON + real source → valid Lesson dict ───────────────────────────────


def test_flag_on_returns_valid_lesson_dict(monkeypatch):
    _flag_on(monkeypatch)
    story = _first_spotlight_story()
    out = L.get_lesson_content(story)
    assert isinstance(out, dict)
    # Passes the SAME validator the adapter's to_lesson uses.
    Lesson.model_validate(out)
    assert set(out.keys()) == {"id", "lesson_code", "title", "blocks"}
    assert out["blocks"], "expected at least one block"


def test_flag_on_dict_is_json_serializable(monkeypatch):
    """The route serializes this through FastAPI — no enum objects may leak."""
    _flag_on(monkeypatch)
    out = L.get_lesson_content(_first_spotlight_story())
    s = json.dumps(out, ensure_ascii=False)
    assert len(s) > 0
    # answer_space / grader must be plain strings (str-enum dumped in json mode).
    for b in out["blocks"]:
        if b.get("type") == "exercise":
            assert isinstance(b["answer_space"], str)
            assert isinstance(b["grader"], str)
            assert isinstance(b["needs_review"], bool)


# ─── 4. identity (content-mapping-integrity 鐵律) ───────────────────────────────


def test_identity_lesson_code_matches_spotlight_lesson(monkeypatch):
    _flag_on(monkeypatch)
    for story in _spotlight_stories():
        out = L.get_lesson_content(story)
        assert out is not None, f"story {story['id']} produced None unexpectedly"
        expected = normalize_manifest_code(
            str(story["spotlight_v2"].get("lesson") or story.get("grade_code"))
        )
        assert out["lesson_code"] == expected, (
            f"IDENTITY DRIFT story {story['id']}: {out['lesson_code']} != {expected}"
        )


def test_title_is_display_authoritative(monkeypatch):
    """張冠李戴 regression (verifier 2026-07): the emitted title must be the DISPLAY
    lesson's own title (story['title']), never a neighbour's borrowed from a mis-resolved
    _parsed file. Locks the G8 catalog↔Layer-2 offset fix (e.g. display G8-L4 玻璃娃娃 must
    NOT show 植物肉). Corpus-level, no hardcoded ids."""
    _flag_on(monkeypatch)
    mism: list[str] = []
    for story in _spotlight_stories():
        out = L.get_lesson_content(story)
        assert out is not None
        display_title = story.get("title")
        if display_title and out.get("title") != display_title:
            mism.append(f"{story['id']}: title={out.get('title')!r} != display {display_title!r}")
    assert not mism, "lesson_content title diverged from the display title:\n" + "\n".join(mism)


def test_neighbor_identity_source_is_never_a_silent_green(monkeypatch):
    """張冠李戴 regression (verifier 2026-07): when the spotlight's OWN declared identity
    (spot['lesson']) resolves to a DIFFERENT _parsed file than the display lesson's
    authoritative twin (catalog_to_parsed_code(grade_code)), the spotlight source was
    authored against a different lesson than the one displayed — its body/exercise may be a
    neighbour's. Such a lesson must NEVER render as a clean green: every exercise block must
    carry needs_review=True. This is the content-dimension gate the old lesson_code-only
    check missed (4 of 5 G8 offset lessons were silently green)."""
    import spotlight_to_lesson_content as adapter  # noqa: E402
    from app.services.lesson_code_normalization import catalog_to_parsed_code  # noqa: E402

    _flag_on(monkeypatch)
    offenders: list[str] = []
    checked = 0
    for story in _spotlight_stories():
        out = L.get_lesson_content(story)
        assert out is not None
        display_code = story.get("grade_code")
        if not display_code:
            continue
        spot_code = normalize_manifest_code(
            str(story["spotlight_v2"].get("lesson") or display_code)
        )
        parsed_code = catalog_to_parsed_code(str(display_code))
        spot_path, _ = adapter.resolve_parsed_source(spot_code)
        auth_path, _ = adapter.resolve_parsed_source(parsed_code)
        if spot_path is None or auth_path is None or spot_path == auth_path:
            continue  # spotlight identity aligns with the display — not a mis-binding risk
        checked += 1
        exercises = [b for b in out["blocks"] if b.get("type") == "exercise"]
        if exercises and not all(b["needs_review"] for b in exercises):
            offenders.append(
                f"{story['id']} ({display_code}): spot resolves to {spot_path.name} but "
                f"display authority resolves to {auth_path.name}; unflagged exercises exist"
            )
    assert checked > 0, "expected the corpus to contain at least one identity-offset lesson (G8)"
    assert not offenders, "silent 張冠李戴 green (foreign-identity source, no needs_review):\n" + "\n".join(offenders)


def test_needs_review_flag_is_honestly_carried(monkeypatch):
    """A needs_review course must surface block-level needs_review=True (honest 🟡);
    a GREEN course must carry needs_review=False on every exercise (no fake flag)."""
    _flag_on(monkeypatch)
    saw_review = saw_green = False
    for story in _spotlight_stories():
        out = L.get_lesson_content(story)
        assert out is not None
        exercises = [b for b in out["blocks"] if b.get("type") == "exercise"]
        if not exercises:
            continue
        if any(b["needs_review"] for b in exercises):
            saw_review = True
        else:
            saw_green = True
        if saw_review and saw_green:
            break
    assert saw_review, "expected at least one course with a block-level needs_review flag"
    assert saw_green, "expected at least one course with all exercises needs_review=False"


def test_needs_review_matches_source_gaps(monkeypatch):
    """Spot-check: a course whose spotlight source has ZERO anchorable passage blocks
    must land needs_review (no_anchorable_passage_in_source) — an honest 🟡, not a fake 🟢."""
    _flag_on(monkeypatch)
    checked = 0
    for story in _spotlight_stories():
        spot = story["spotlight_v2"]
        blocks = spot.get("blocks") or []
        # spotlight source with no passage/figure presentation → adapter must flag review.
        has_presentation = any(
            b.get("type") in ("passage", "figure") for b in blocks
        )
        out = L.get_lesson_content(story)
        assert out is not None
        exercises = [b for b in out["blocks"] if b.get("type") == "exercise"]
        if exercises and not has_presentation:
            assert any(b["needs_review"] for b in exercises), (
                f"story {story['id']} has no presentation blocks but no needs_review flag"
            )
            checked += 1
        if checked >= 2:
            break


# ─── 5. fail-closed ─────────────────────────────────────────────────────────────


def test_fail_closed_on_adapter_validation_error(monkeypatch):
    """A ValidationError (or any exception) out of the adapter yields None, not a raise."""
    _flag_on(monkeypatch)
    story = _first_spotlight_story()

    adapter = L._get_adapter()

    def _boom(*_a, **_k):
        raise ValueError("simulated adapter failure")

    monkeypatch.setattr(adapter, "assemble_lesson", _boom)
    L._reset_caches_for_test()
    # Must NOT raise.
    assert L.get_lesson_content(story) is None


def test_fail_closed_on_validation_error_type(monkeypatch):
    _flag_on(monkeypatch)
    story = _first_spotlight_story()
    adapter = L._get_adapter()
    from pydantic import ValidationError

    def _bad_to_lesson(_d):
        # Trigger a real ValidationError by validating an empty dict.
        return Lesson.model_validate({})

    monkeypatch.setattr(adapter, "to_lesson", _bad_to_lesson)
    L._reset_caches_for_test()
    try:
        result = L.get_lesson_content(story)
    except ValidationError:  # pragma: no cover - would be the bug we're guarding against
        pytest.fail("get_lesson_content must swallow ValidationError, not raise it")
    assert result is None


# ─── 6. lru_cache ───────────────────────────────────────────────────────────────


def test_cache_returns_same_object(monkeypatch):
    _flag_on(monkeypatch)
    story = _first_spotlight_story()
    a = L.get_lesson_content(story)
    b = L.get_lesson_content(story)
    assert a is not None and a is b, "same story id must return the cached object"


def test_adapter_runs_once_per_story(monkeypatch):
    _flag_on(monkeypatch)
    story = _first_spotlight_story()
    adapter = L._get_adapter()
    calls = {"n": 0}
    real = adapter.assemble_lesson

    def _counting(*a, **k):
        calls["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(adapter, "assemble_lesson", _counting)
    L._reset_caches_for_test()
    L.get_lesson_content(story)
    L.get_lesson_content(story)
    L.get_lesson_content(story)
    assert calls["n"] == 1, f"adapter should run once (cached), ran {calls['n']}x"


# ─── 7. supply regression (handoff: 119 OK / 0 FAIL) ────────────────────────────


def test_supply_regression_all_spotlight_stories(monkeypatch):
    _flag_on(monkeypatch)
    stories = _spotlight_stories()
    assert len(stories) >= 100, "expected the full spotlight_v2 corpus to be loaded"
    failures: list[str] = []
    for story in stories:
        out = L.get_lesson_content(story)
        if out is None:
            failures.append(f"{story['id']}: None")
            continue
        try:
            json.dumps(out, ensure_ascii=False)
        except Exception as e:  # noqa: BLE001
            failures.append(f"{story['id']}: not JSON-serializable ({e})")
            continue
        try:
            Lesson.model_validate(out)
        except Exception as e:  # noqa: BLE001
            failures.append(f"{story['id']}: schema-fail ({e})")
    assert not failures, "supply regression failures:\n" + "\n".join(failures)
