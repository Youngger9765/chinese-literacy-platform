"""Locks the Taiwan pronunciation corrections to their data file.

The four cases Hans reported on 2026-08-09 (攻擊/嘆息/摸不著/和) were none of
them in PHONEME_CORRECTIONS, which had held the same four hand-added entries
since the 2026-05-01 expert review flagged 破音字 as a risk. That review's audit
scanned 31 characters and surfaced 4298 items needing human review; 22 were ever
fixed. Hand-maintaining the table does not converge.

The corrections now come from a generated data file whose authority is the MOE
dictionary, so adding coverage means regenerating rather than appending.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parents[1] / "data" / "tts" / "taiwan_pronunciation.json"


@pytest.fixture(scope="module")
def data() -> dict:
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_data_file_exists_and_is_attributed(data: dict) -> None:
    assert data["_source"].startswith("教育部")
    assert "corrections" in data
    assert len(data["corrections"]) >= 50


def test_every_alias_differs_from_its_word(data: dict) -> None:
    # An alias identical to the word is a no-op that looks like coverage.
    for row in data["corrections"]:
        assert row["alias"] != row["word"], row["word"]


def test_alias_preserves_length(data: dict) -> None:
    # <sub> replaces the whole span; a different length means the substitution
    # would change the sentence's character count and break cursor alignment.
    for row in data["corrections"]:
        assert len(row["alias"]) == len(row["word"]), row["word"]


def test_alias_is_plain_han_characters(data: dict) -> None:
    # Azure reads the alias as text. Anything non-Han would be spelled out.
    for row in data["corrections"]:
        assert re.fullmatch(r"[一-鿿]+", row["alias"]), row


def test_no_word_is_a_substring_of_another(data: dict) -> None:
    # Sequential replacement over overlapping keys double-substitutes: an alias
    # emitted by one rule can match a later rule's key. Caught this way in #2612.
    words = [r["word"] for r in data["corrections"]]
    for w in words:
        for other in words:
            if w != other:
                assert w not in other, f"{w} is inside {other}"


def test_corrections_load_into_the_tts_table() -> None:
    from app.services.tts.normalization import PHONEME_CORRECTIONS

    keys = {k for k, _ in PHONEME_CORRECTIONS}
    # The four hand-added entries must survive alongside the generated ones.
    assert "喝采" in keys
    # And the generated set must actually be wired in.
    assert "音樂" in keys, "data file is not reaching PHONEME_CORRECTIONS"


def test_generated_entries_wrap_in_sub_alias() -> None:
    from app.services.tts.normalization import PHONEME_CORRECTIONS

    table = dict(PHONEME_CORRECTIONS)
    # Azure rejects <phoneme> outright — every alphabet returns HTTP 400 — so
    # <sub alias> is the only pronunciation control available here (#2612).
    assert table["音樂"] == '<sub alias="音岳">音樂</sub>'
