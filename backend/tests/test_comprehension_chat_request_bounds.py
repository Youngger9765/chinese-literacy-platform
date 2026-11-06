"""ComprehensionChatRequest server-enforced field bounds.

Claude Security finding find_018AtiqbKoZV9Tfdco1x8ezD (medium, CWE-770):
start_session copies every one of these fields into a SessionState kept in
the process-wide SessionStore for 30 minutes, keyed on the client-chosen
session_id. Only story_title/story_text were bounded before this fix --
session_id, mispronounced_words, genre and reading_strategy had no
server-enforced limit at all.

These are pure Pydantic schema tests -- they don't need AI_CHATBOT_ENABLED
or a running app, since field validation happens independent of that flag.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from pydantic import ValidationError

from app.routes.learning.learning_comprehension import ComprehensionChatRequest


def _base_payload(**overrides) -> dict:
    payload = {
        "session_id": "sess-1",
        "story_title": "測試課文",
        "story_text": "測試內容",
    }
    payload.update(overrides)
    return payload


class TestSessionIdBound:
    def test_normal_session_id_accepted(self):
        ComprehensionChatRequest(**_base_payload(session_id="sess-" + "a" * 20))

    def test_oversized_session_id_rejected(self):
        with pytest.raises(ValidationError):
            ComprehensionChatRequest(**_base_payload(session_id="x" * 101))


class TestGenreAndReadingStrategyBounds:
    def test_normal_genre_accepted(self):
        ComprehensionChatRequest(**_base_payload(genre="記敘文"))

    def test_oversized_genre_rejected(self):
        with pytest.raises(ValidationError):
            ComprehensionChatRequest(**_base_payload(genre="x" * 51))

    def test_oversized_reading_strategy_rejected(self):
        with pytest.raises(ValidationError):
            ComprehensionChatRequest(**_base_payload(reading_strategy="x" * 51))


class TestMispronouncedWordsBounds:
    def test_normal_list_accepted(self):
        ComprehensionChatRequest(**_base_payload(mispronounced_words=["的", "了", "嗎"]))

    def test_oversized_list_length_rejected(self):
        """200-item cap -- this is the primary memory-growth vector the
        finding's attack scenario relies on (a list of a million strings)."""
        with pytest.raises(ValidationError):
            ComprehensionChatRequest(
                **_base_payload(mispronounced_words=["字"] * 201)
            )

    def test_oversized_single_item_rejected_even_in_a_short_list(self):
        """A single oversized item must not substitute for a long list --
        Field(max_length=N) on a list bounds item COUNT, not per-item
        length, which is why a separate validator is needed."""
        with pytest.raises(ValidationError):
            ComprehensionChatRequest(
                **_base_payload(mispronounced_words=["x" * 100_000])
            )
