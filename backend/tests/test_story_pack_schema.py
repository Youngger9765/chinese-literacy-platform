"""Tests for app.schemas.story_pack — the StoryPack content schema.

PRD §13: this schema is what an LLM-generated or back-office-pasted theme
payload must pass before it can go live. Scoring (league_scoring.py) is
untouched by this module, so these tests focus on: (a) a valid payload
round-trips, (b) every "fail-closed" rule actually rejects the thing it
claims to reject (no-markup, unknown keys, SVG allow-list, badge-key
coverage, milestone ordering).
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.story_pack import (
    BADGE_KEY_CLASS,
    BADGE_KEY_INDIVIDUAL,
    StoryPack,
    StoryPackArt,
    sanitize_svg,
    SvgValidationError,
)


def _valid_payload(**overrides) -> dict:
    payload = {
        "key": "tang-dynasty",
        "era": "唐",
        "title": "大唐風雲賽",
        "intro": ["長安城外，兩隊讀家受命守護絲路驛站。", "誰先讀完任務卷軸，就能點亮下一座烽火台。"],
        "faction_labels": ["長安守軍", "塞外行旅"],
        "energy_bar_label": "軍糧",
        "milestones": [
            {"ratio": 0.5, "message": "糧倉過半，士氣大振"},
            {"ratio": 1.0, "message": "糧倉全滿，烽火點亮"},
        ],
        "chest": {
            "name": "絲路寶箱",
            "description": "全班過半參與即可開啟",
            "art": {"kind": "emoji", "value": "📦"},
        },
        "badges": [
            {
                "key": BADGE_KEY_INDIVIDUAL,
                "name": "行者勳章",
                "description": "累積達標，獨得殊榮",
                "art": {"kind": "emoji", "value": "🎖"},
            },
            {
                "key": BADGE_KEY_CLASS,
                "name": "全隊勳章",
                "description": "班級平均達標",
                "art": {"kind": "emoji", "value": "🏯"},
            },
        ],
        "result_copy": {"win": "大獲全勝！", "lose": "雖敗猶榮，繼續精進", "draw": "勢均力敵，再戰一回"},
    }
    payload.update(overrides)
    return payload


class TestValidThemeRoundTrips:
    def test_valid_payload_parses(self):
        theme = StoryPack(**_valid_payload())
        assert theme.key == "tang-dynasty"
        assert len(theme.badges) == 2
        assert theme.model_dump()["chest"]["art"]["kind"] == "emoji"

    def test_milestones_may_be_empty(self):
        theme = StoryPack(**_valid_payload(milestones=[]))
        assert theme.milestones == []

    def test_schema_version_defaults_to_1(self):
        theme = StoryPack(**_valid_payload())
        assert theme.schema_version == 1

    def test_background_art_defaults_to_none(self):
        theme = StoryPack(**_valid_payload())
        assert theme.background_art is None

    def test_background_art_accepts_svg(self):
        payload = _valid_payload(
            background_art={
                "kind": "svg",
                "value": '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#111"/></svg>',
            }
        )
        theme = StoryPack(**payload)
        assert theme.background_art is not None
        assert theme.background_art.kind == "svg"


class TestSchemaVersionAndSceneReservation:
    def test_schema_version_other_than_1_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(schema_version=2))

    def test_scenes_key_rejected_until_story_mode_schema_lands(self):
        """Trip-wire (see module docstring): a future story-mode schema
        bump must consciously touch this file + this test, not silently
        start accepting arbitrary scene data via extra="forbid" laxing."""
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(scenes=[{"id": "intro", "dialogue": "..."}]))


class TestRejectCases:
    def test_unknown_top_level_key_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(badge_threshold=999))

    def test_unknown_nested_key_rejected(self):
        payload = _valid_payload()
        payload["chest"]["threshold"] = 120
        with pytest.raises(ValidationError):
            StoryPack(**payload)

    def test_key_must_be_slug(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(key="唐朝 Theme!!"))

    @pytest.mark.parametrize(
        "bad_text",
        [
            "<script>alert(1)</script>",
            "點我 <img src=x onerror=alert(1)>",
            "javascript:alert(1)",
        ],
    )
    def test_title_rejects_html_and_script(self, bad_text):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(title=bad_text))

    def test_intro_paragraph_too_long_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(intro=["x" * 161]))

    def test_intro_empty_list_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(intro=[]))

    def test_faction_labels_must_be_exactly_two(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(faction_labels=["單隊"]))
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(faction_labels=["隊A", "隊B", "隊C"]))

    def test_milestones_must_be_ascending(self):
        payload = _valid_payload(
            milestones=[{"ratio": 1.0, "message": "a"}, {"ratio": 0.5, "message": "b"}]
        )
        with pytest.raises(ValidationError):
            StoryPack(**payload)

    def test_milestones_ratio_duplicate_rejected(self):
        payload = _valid_payload(
            milestones=[{"ratio": 0.5, "message": "a"}, {"ratio": 0.5, "message": "b"}]
        )
        with pytest.raises(ValidationError):
            StoryPack(**payload)

    def test_milestone_ratio_out_of_range_rejected(self):
        payload = _valid_payload(milestones=[{"ratio": 1.5, "message": "a"}])
        with pytest.raises(ValidationError):
            StoryPack(**payload)
        payload = _valid_payload(milestones=[{"ratio": 0, "message": "a"}])
        with pytest.raises(ValidationError):
            StoryPack(**payload)

    def test_badges_missing_one_fixed_key_rejected(self):
        payload = _valid_payload()
        payload["badges"] = [payload["badges"][0], payload["badges"][0]]
        with pytest.raises(ValidationError):
            StoryPack(**payload)

    def test_badges_with_invented_third_key_rejected(self):
        payload = _valid_payload()
        payload["badges"].append(
            {"key": "secret_badge", "name": "x", "description": "y", "art": {"kind": "emoji", "value": "x"}}
        )
        with pytest.raises(ValidationError):
            StoryPack(**payload)

    def test_badges_more_than_two_rejected_even_if_keys_valid(self):
        payload = _valid_payload()
        # Duplicate the individual badge a third time — still invalid because
        # list length must be exactly 2 AND key coverage must be exact.
        payload["badges"] = payload["badges"] + [payload["badges"][0]]
        with pytest.raises(ValidationError):
            StoryPack(**payload)

    def test_result_copy_text_too_long_rejected(self):
        payload = _valid_payload()
        payload["result_copy"]["win"] = "x" * 61
        with pytest.raises(ValidationError):
            StoryPack(**payload)


class TestArtSchema:
    def test_emoji_art_valid(self):
        art = StoryPackArt(kind="emoji", value="🏯")
        assert art.value == "🏯"

    def test_emoji_too_long_rejected(self):
        with pytest.raises(ValidationError):
            StoryPackArt(kind="emoji", value="🏯" * 20)

    def test_emoji_with_markup_rejected(self):
        with pytest.raises(ValidationError):
            StoryPackArt(kind="emoji", value="<b>x</b>")

    def test_svg_art_allowlisted_tags_valid(self):
        art = StoryPackArt(
            kind="svg",
            value='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f59e0b"/></svg>',
        )
        assert "circle" in art.value

    def test_svg_without_root_svg_tag_rejected(self):
        with pytest.raises(ValidationError):
            StoryPackArt(kind="svg", value='<circle cx="1" cy="1" r="1"/>')

    def test_svg_script_tag_rejected(self):
        with pytest.raises(ValidationError):
            StoryPackArt(
                kind="svg", value='<svg><script>alert(1)</script></svg>'
            )

    def test_svg_event_handler_attribute_rejected(self):
        with pytest.raises(ValidationError):
            StoryPackArt(
                kind="svg", value='<svg onload="alert(1)"><circle r="1"/></svg>'
            )

    def test_svg_foreignobject_rejected(self):
        with pytest.raises(ValidationError):
            StoryPackArt(
                kind="svg",
                value='<svg><foreignObject><body>x</body></foreignObject></svg>',
            )

    def test_svg_external_url_rejected(self):
        with pytest.raises(ValidationError):
            StoryPackArt(
                kind="svg",
                value='<svg><rect fill="url(http://evil.example/x.png)"/></svg>',
            )

    def test_svg_disallowed_tag_rejected(self):
        with pytest.raises(ValidationError):
            StoryPackArt(kind="svg", value='<svg><image href="http://x"/></svg>')

    def test_svg_disallowed_attribute_rejected(self):
        with pytest.raises(ValidationError):
            StoryPackArt(
                kind="svg", value='<svg><circle r="1" data-evil="x"/></svg>'
            )

    def test_sanitize_svg_direct_call_too_long(self):
        with pytest.raises(SvgValidationError):
            sanitize_svg("<svg>" + "x" * 5000 + "</svg>")


class TestPoliticalNeutralityValidator:
    """Young 2026-10-16: Taiwan-school political neutrality — the schema
    itself must hard-reject nation/ethnicity framing words and 「大戰」
    combat framing in ANY free-text field, not just rely on content review.
    Mutation-confirmed (see test_story_pack_schema_banned_terms_mutation.py
    note below, or run the two-line removal by hand): removing
    `_forbid_banned_terms` from `_forbid_markup` makes every one of these
    go from raising to silently accepting — i.e. this suite is not vacuous.
    """

    BANNED_SAMPLES = [
        "中華", "中國", "祖國", "民族", "我國", "炎黃子孫", "統一", "收復", "大一統", "大戰",
    ]

    @pytest.mark.parametrize("banned", BANNED_SAMPLES)
    def test_banned_term_in_title_rejected(self, banned):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(title=f"測試{banned}主題"))

    @pytest.mark.parametrize("banned", BANNED_SAMPLES)
    def test_banned_term_in_intro_rejected(self, banned):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(intro=[f"這段提到{banned}的文字"]))

    def test_banned_term_in_era_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(era="中國"))

    def test_banned_term_in_faction_label_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(faction_labels=["我國隊", "對手隊"]))

    def test_banned_term_in_energy_bar_label_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(energy_bar_label="民族力"))

    def test_banned_term_in_milestone_message_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(milestones=[{"ratio": 1.0, "message": "完成統一大業"}]))

    def test_banned_term_in_chest_text_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(chest={
                "name": "祖國寶箱", "description": "開啟", "art": {"kind": "emoji", "value": "🎁"},
            }))

    def test_banned_term_in_badge_text_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(badges=[
                {"key": "individual_badge", "name": "炎黃子孫勳章", "description": "x", "art": {"kind": "emoji", "value": "⭐"}},
                {"key": "class_badge", "name": "y", "description": "z", "art": {"kind": "emoji", "value": "🏅"}},
            ]))

    def test_banned_term_in_result_copy_rejected(self):
        with pytest.raises(ValidationError):
            StoryPack(**_valid_payload(result_copy={"win": "收復失土", "lose": "l", "draw": "d"}))

    def test_banned_term_in_emoji_art_rejected(self):
        """Code review 2026-10-16 gap: emoji art.value is free text reachable
        via background_art/chest.art/badge.art, all writable through the
        admin endpoint — it must clear the same check as every other field."""
        with pytest.raises(ValidationError):
            StoryPackArt(kind="emoji", value="中國")

    def test_banned_term_in_svg_art_rejected(self):
        """Same gap, SVG branch — a <text> node (allow-listed) can carry the
        banned term; sanitize_svg's tag/attribute allow-list does not
        inspect text content, so this needs its own explicit check."""
        with pytest.raises(ValidationError):
            StoryPackArt(kind="svg", value='<svg><text>統一祖國</text></svg>')

    def test_clean_payload_without_banned_terms_still_valid(self):
        """Positive control — the validator doesn't over-fire on ordinary
        content (same payload shape the shipped packs actually use)."""
        pack = StoryPack(**_valid_payload())
        assert pack.title == "大唐風雲賽"
