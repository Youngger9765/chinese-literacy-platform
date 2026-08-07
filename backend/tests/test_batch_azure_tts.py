"""TDD lock for the testable units in backend/scripts/batch_azure_tts.py (#2614).

Only covers module-level functions (_ssml/_escape/_upload_if_absent) — the
generation/upload loop itself lives inside main() as a nested closure and is
exercised in production, not unit tests; this repo's testing-strategy.md
calls that out explicitly (contract-test what a type checker can't catch,
not every closure).

_validate() used to be nested inside main() too, which is exactly why it had
zero test coverage before #2614 — see test_tts_audio_validation.py for its
replacement (app.services.tts.audio_validation.validate_mp3_bytes), now
importable and tested directly.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "batch_azure_tts.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("batch_azure_tts_under_test", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def batch_mod():
    return _load_module()


class FakeBlob:
    def __init__(self, exists: bool = False):
        self.exists_already = exists
        self.uploaded_bytes: bytes | None = None
        self.upload_kwargs: dict | None = None

    def upload_from_string(self, data, content_type=None, if_generation_match=None):
        if self.exists_already and if_generation_match == 0:
            from google.api_core.exceptions import PreconditionFailed

            raise PreconditionFailed("object already exists")
        self.uploaded_bytes = data
        self.upload_kwargs = {"content_type": content_type, "if_generation_match": if_generation_match}


class FakeBucket:
    def __init__(self, blob: FakeBlob):
        self._blob = blob

    def blob(self, name):
        return self._blob


class TestUploadIfAbsent:
    def test_uploads_when_object_does_not_exist(self, batch_mod):
        blob = FakeBlob(exists=False)
        bucket = FakeBucket(blob)
        result = batch_mod._upload_if_absent(bucket, "azure/sentences/aaa.mp3", b"ID3fakeaudio")
        assert result is True
        assert blob.uploaded_bytes == b"ID3fakeaudio"
        assert blob.upload_kwargs["if_generation_match"] == 0

    def test_skips_when_object_already_exists(self, batch_mod):
        """Simulates the race: another run already won and wrote this key."""
        blob = FakeBlob(exists=True)
        bucket = FakeBucket(blob)
        result = batch_mod._upload_if_absent(bucket, "azure/sentences/aaa.mp3", b"ID3fakeaudio")
        assert result is False
        assert blob.uploaded_bytes is None  # never overwrote the winner

    def test_uses_correct_content_type(self, batch_mod):
        blob = FakeBlob(exists=False)
        bucket = FakeBucket(blob)
        batch_mod._upload_if_absent(bucket, "azure/sentences/aaa.mp3", b"ID3fakeaudio")
        assert blob.upload_kwargs["content_type"] == "audio/mpeg"


class TestSsmlUsesSharedValidatorImport:
    def test_module_imports_shared_validator_not_a_local_copy(self, batch_mod):
        """Locks the #2614 refactor: batch_azure_tts.py must call the shared,
        tested validator — not reinvent its own inline closure the way the
        original _validate() did (which is why it had no test coverage)."""
        from app.services.tts.audio_validation import validate_mp3_bytes

        assert batch_mod.validate_mp3_bytes is validate_mp3_bytes

    def test_ssml_still_escapes_and_wraps_voice(self, batch_mod):
        out = batch_mod._ssml("喝采")
        assert "zh-TW-HsiaoChenNeural" in out or batch_mod.VOICE in out
        assert "<speak" in out and "</speak>" in out


# ---------------------------------------------------------------------------
# #2614 follow-up: punctuation-only fragments produce Azure HTTP-200-empty-body
# ---------------------------------------------------------------------------
#
# Root cause found by team-lead after the batch run finished: the 3 confirmed
# 0-byte objects were not an Azure reliability problem — they were sentences
# that are ENTIRELY punctuation ('。', '」', '」。'), left over from upstream
# sentence segmentation. _clean_for_tts only strips a specific punctuation
# subset (~, ──, …), so these survive cleaning unchanged, pass the
# `if not cleaned: continue` check (they are non-empty strings!), and get
# sent to Azure — which answers 200 with an empty body because there is
# nothing to speak. This is a *different* failure path than validate_mp3_bytes
# (which catches Azure misbehaving on a *normal* input) — both guards stay.


class TestHasSpeakableContent:
    """Unit tests for the new input-side filter, using team-lead's exact
    reported cases plus the boundary ones they specified."""

    @pytest.mark.parametrize(
        "text,expected",
        [
            ("。", False),
            ("」", False),
            ("」。", False),
            ("  ", False),
            ("——", False),
            ("，、；：", False),  # more punctuation-only, same failure shape
            ("好。", True),
            ("A", True),
            ("214周", True),
            ("你好，世界！", True),
        ],
    )
    def test_speakable_detection(self, batch_mod, text, expected):
        assert batch_mod._has_speakable_content(text) is expected


class TestLoadSentencesSkipsUnspeakable:
    """Integration-level: load_sentences() must actually apply the filter and
    log what it dropped — team-lead's requirement was "不要靜默丟掉"."""

    def _write_jsonl(self, path, rows):
        path.write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8"
        )

    def test_punctuation_only_sentences_are_skipped(self, batch_mod, tmp_path, monkeypatch):
        rows = [
            {"text": "。", "lesson_id": "L1146", "paragraph_idx": 0, "sentence_idx": 30},
            {"text": "」", "lesson_id": "L1115", "paragraph_idx": 0, "sentence_idx": 48},
            {"text": "」。", "lesson_id": "L1080", "paragraph_idx": 0, "sentence_idx": 10},
            {"text": "他說好。", "lesson_id": "L1080", "paragraph_idx": 0, "sentence_idx": 11},
        ]
        jsonl_path = tmp_path / "sentences.jsonl"
        self._write_jsonl(jsonl_path, rows)
        monkeypatch.setattr(batch_mod, "JSONL", jsonl_path)

        items = batch_mod.load_sentences()

        assert [it["raw_text"] for it in items] == ["他說好。"]

    def test_skip_is_logged_not_silent(self, batch_mod, tmp_path, monkeypatch, caplog):
        import logging

        rows = [
            {"text": "。", "lesson_id": "L1146", "paragraph_idx": 0, "sentence_idx": 30},
            {"text": "」", "lesson_id": "L1115", "paragraph_idx": 0, "sentence_idx": 48},
        ]
        jsonl_path = tmp_path / "sentences.jsonl"
        self._write_jsonl(jsonl_path, rows)
        monkeypatch.setattr(batch_mod, "JSONL", jsonl_path)

        with caplog.at_level(logging.INFO, logger="batch-azure"):
            batch_mod.load_sentences()

        assert "2" in caplog.text  # skipped count surfaces somewhere in the log
        assert "L1146" in caplog.text
        assert "L1115" in caplog.text

    def test_normal_sentences_unaffected(self, batch_mod, tmp_path, monkeypatch):
        rows = [
            {"text": "今天天氣很好。", "lesson_id": "L1", "paragraph_idx": 0, "sentence_idx": 0},
            {"text": "214周年紀念", "lesson_id": "L2", "paragraph_idx": 0, "sentence_idx": 0},
        ]
        jsonl_path = tmp_path / "sentences.jsonl"
        self._write_jsonl(jsonl_path, rows)
        monkeypatch.setattr(batch_mod, "JSONL", jsonl_path)

        items = batch_mod.load_sentences()

        assert len(items) == 2
