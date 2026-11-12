"""Issue 3615: story-pack validation errors shown in the admin studio must be
Chinese and field-level. Each error is {"loc", "field", "msg"}:
  - loc   : machine path (unchanged, e.g. "chest.name")
  - field : Chinese label of the field (e.g. "寶箱名稱")
  - msg   : Chinese description of what is wrong (no Pydantic English such
            as "Value error," / "String should have at most ...")
"""
from __future__ import annotations

import copy
import re

import pytest

from app.schemas.story_pack import BANNED_POLITICAL_TERMS
from app.services import story_pack_service as svc
from app.services.story_pack_defaults import BUILTIN_PACKS, TANG_PACK_KEY


def _good() -> dict:
    p = BUILTIN_PACKS[TANG_PACK_KEY].model_dump(mode="json")
    p["key"] = "custom-qa"
    return p


def _errors(payload: dict) -> list[dict]:
    pack, errors = svc.validate_pack_payload(payload)
    assert pack is None, "payload was expected to be invalid"
    assert errors, "invalid payload must produce at least one error"
    return errors


def _only(errors: list[dict], loc: str) -> dict:
    hits = [e for e in errors if e["loc"] == loc]
    assert len(hits) == 1, f"expected one error at {loc}, got {errors}"
    return hits[0]


# Text inside 「」 is quoted user content / examples, not prose.
_QUOTED = re.compile(r"「[^」]*」")
# Two ASCII words next to each other = English prose ("Value error", "should have").
_ENGLISH_PROSE = re.compile(r"[A-Za-z]{2,}[\s,.:;]+[A-Za-z]{2,}")
# A lone ASCII word is only OK for these technical names.
_ALLOWED_ASCII_WORDS = {"SVG", "HTML"}


def _english_in(text: str) -> list[str]:
    bare = _QUOTED.sub("", text)
    problems = _ENGLISH_PROSE.findall(bare)
    problems += [w for w in re.findall(r"[A-Za-z]{2,}", bare) if w not in _ALLOWED_ASCII_WORDS]
    return problems


class TestFieldLevelChineseErrors:
    def test_banned_word_in_chest_name_names_field_and_word(self):
        p = _good()
        p["chest"]["name"] = "中國寶箱"
        e = _only(_errors(p), "chest.name")
        assert e["field"] == "寶箱名稱"
        assert "「中國」" in e["msg"]
        assert "Value error" not in e["msg"]

    def test_banned_word_in_second_intro_paragraph_points_at_that_paragraph(self):
        p = _good()
        p["intro"] = ["第一段沒問題。", "這段寫了祖國。"]
        e = _only(_errors(p), "intro.1")
        assert e["field"] == "開場白第 2 段"
        assert "「祖國」" in e["msg"]

    def test_banned_word_in_second_badge_description(self):
        p = _good()
        p["badges"][1]["description"] = "全班一起大一統"
        e = _only(_errors(p), "badges.1.description")
        assert e["field"] == "第 2 個徽章說明"
        assert "「大一統」" in e["msg"]

    def test_too_long_title_is_chinese(self):
        p = _good()
        p["title"] = "長" * 41
        e = _only(_errors(p), "title")
        assert e["field"] == "標題"
        assert "40" in e["msg"]
        assert _english_in(e["msg"]) == []

    def test_missing_and_extra_fields(self):
        p = _good()
        del p["era"]
        p["badge_threshold"] = 1
        errs = _errors(p)
        assert _only(errs, "era")["field"] == "時代標籤"
        assert "必填" in _only(errs, "era")["msg"]
        extra = _only(errs, "badge_threshold")
        assert "不允許" in extra["msg"]


# ── Class-level sweep ──────────────────────────────────────────────────────

FREE_TEXT_PATHS = [
    ("era",), ("title",), ("intro", 0), ("faction_labels", 0), ("faction_labels", 1),
    ("energy_bar_label",), ("milestones", 0, "message"), ("chest", "name"),
    ("chest", "description"), ("badges", 0, "name"), ("badges", 0, "description"),
    ("badges", 1, "name"), ("badges", 1, "description"), ("result_copy", "win"),
    ("result_copy", "lose"), ("result_copy", "draw"),
]


def _set(p: dict, path: tuple, value) -> None:
    cur = p
    for part in path[:-1]:
        cur = cur[part]
    cur[path[-1]] = value


def _mut(path: tuple, value):
    def apply(p: dict) -> None:
        _set(p, path, value)
    return apply


def _del(*path):
    def apply(p: dict) -> None:
        cur = p
        for part in path[:-1]:
            cur = cur[part]
        del cur[path[-1]]
    return apply


OTHER_CASES = {
    "missing title": _del("title"),
    "missing chest art": _del("chest", "art"),
    "extra top-level field": _mut(("badge_threshold",), 3),
    "extra nested field": _mut(("chest", "ratio"), 0.5),
    "title too long": _mut(("title",), "長" * 41),
    "empty title": _mut(("title",), ""),
    "intro empty list": _mut(("intro",), []),
    "intro too many": _mut(("intro",), ["一", "二", "三", "四", "五"]),
    "intro paragraph too long": _mut(("intro",), ["長" * 161]),
    "intro item not text": _mut(("intro",), [123]),
    "three faction labels": _mut(("faction_labels",), ["甲", "乙", "丙"]),
    "faction label too long": _mut(("faction_labels",), ["長" * 13, "乙"]),
    "ratio zero": _mut(("milestones", 0, "ratio"), 0),
    "ratio above one": _mut(("milestones", 0, "ratio"), 2),
    "ratio not a number": _mut(("milestones", 0, "ratio"), "很多"),
    "duplicate ratios": _mut(("milestones",), [{"ratio": 0.5, "message": "一"}, {"ratio": 0.5, "message": "二"}]),
    "unsorted ratios": _mut(("milestones",), [{"ratio": 0.9, "message": "一"}, {"ratio": 0.5, "message": "二"}]),
    "badge keys wrong": _mut(("badges", 1, "key"), "individual_badge"),
    "badge key unknown": _mut(("badges", 0, "key"), "gold_badge"),
    "one badge only": _mut(("badges",), []),
    "art kind unknown": _mut(("chest", "art", "kind"), "png"),
    "emoji too long": _mut(("chest", "art"), {"kind": "emoji", "value": "🎁" * 9}),
    "emoji with markup": _mut(("chest", "art"), {"kind": "emoji", "value": "<b>"}),
    "svg with script": _mut(("chest", "art"), {"kind": "svg", "value": "<svg><script>x</script></svg>"}),
    "svg bad tag": _mut(("chest", "art"), {"kind": "svg", "value": "<svg><marquee/></svg>"}),
    "svg bad attribute": _mut(("chest", "art"), {"kind": "svg", "value": "<svg><rect style='x'/></svg>"}),
    "svg no root": _mut(("chest", "art"), {"kind": "svg", "value": "<g></g>"}),
    "svg too long": _mut(("chest", "art"), {"kind": "svg", "value": "<svg>" + "a" * 4000 + "</svg>"}),
    "markup in title": _mut(("title",), "<b>標題</b>"),
    "bad key slug": _mut(("key",), "Bad Key"),
    "schema version 2": _mut(("schema_version",), 2),
    "chest not an object": _mut(("chest",), "寶箱"),
    "result copy missing draw": _del("result_copy", "draw"),
    "energy label too long": _mut(("energy_bar_label",), "長" * 11),
    "background art wrong type": _mut(("background_art",), "藍天"),
}

_CJK = re.compile(r"[一-鿿]")


def _assert_chinese_field_level(case: str, errors: list[dict]) -> None:
    for e in errors:
        assert e.get("loc"), f"{case}: error without loc: {e}"
        for key in ("field", "msg"):
            text = e.get(key) or ""
            assert _CJK.search(text), f"{case}: {key} has no Chinese: {e}"
            assert _english_in(text) == [], f"{case}: English in {key}: {e}"


class TestEveryValidatorErrorIsChinese:
    def test_banned_term_in_every_free_text_field_is_reported_at_that_field(self):
        ran = 0
        for path in FREE_TEXT_PATHS:
            for term in BANNED_POLITICAL_TERMS:
                p = _good()
                _set(p, path, "這裡有" + term)
                errors = _errors(p)
                _assert_chinese_field_level(f"{path}/{term}", errors)
                e = _only(errors, ".".join(str(x) for x in path))
                assert "「" + term + "」" in e["msg"]
                ran += 1
        # Positive control: every path x every banned term was exercised.
        assert ran == len(FREE_TEXT_PATHS) * len(BANNED_POLITICAL_TERMS)

    @pytest.mark.parametrize("case", sorted(OTHER_CASES))
    def test_other_invalid_payloads_have_chinese_field_level_errors(self, case):
        p = copy.deepcopy(_good())
        OTHER_CASES[case](p)
        _assert_chinese_field_level(case, _errors(p))

    def test_sweep_covers_many_error_kinds(self):
        # Positive control for the parametrized sweep above.
        assert len(OTHER_CASES) >= 30

    def test_english_detector_has_teeth(self):
        # Negative control: the detector must flag the old Pydantic wording.
        assert _english_in("Value error, title 不可包含") != []
        assert _english_in("String should have at most 40 characters") != []
        assert _english_in("寶箱名稱不可包含「中國」") == []
