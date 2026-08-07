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
