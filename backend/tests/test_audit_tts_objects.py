"""TDD lock for backend/scripts/audit_tts_objects.py (#2614).

This audits objects ALREADY uploaded to the GCS TTS cache for the same
empty-body/corrupt-audio failure that validate_mp3_bytes() now blocks at
write time (see test_tts_audio_validation.py) — a real batch run produced
2 confirmed 0-byte objects before that guard existed, and they are still
sitting in the bucket winning the runtime cache until something removes
them.

Loaded via importlib.util (same pattern as test_ai_base_split_1953.py)
because it's a standalone script, not a package module.

All tests run against fake Blob/Bucket doubles — never touches real GCS.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "audit_tts_objects.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("audit_tts_objects_under_test", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def audit_mod():
    # fresh module per test — main() mutates module-level `storage` in some tests
    return _load_module()


class FakeBlob:
    """Stand-in for google.cloud.storage.Blob. `size` mirrors GCS metadata
    (free to read); download_as_bytes() mirrors a ranged GET."""

    def __init__(self, name, content: bytes = b"", size: int | None = None, unreadable: bool = False):
        self.name = name
        self._content = content
        self.size = size if size is not None else len(content)
        self._unreadable = unreadable
        self.deleted = False

    def download_as_bytes(self, start: int = 0, end: int | None = None) -> bytes:
        if self._unreadable:
            raise RuntimeError("simulated network error")
        end = (self.size - 1) if end is None else end
        return self._content[start : end + 1]

    def delete(self) -> None:
        self.deleted = True


class FakeBucket:
    """Stand-in for google.cloud.storage.Bucket."""

    def __init__(self, blobs):
        self._blobs = {b.name: b for b in blobs}

    def list_blobs(self, prefix: str = ""):
        return [b for name, b in self._blobs.items() if name.startswith(prefix)]

    def blob(self, name: str):
        return self._blobs[name]


def _good_mp3(n: int = 5000) -> bytes:
    return b"ID3" + b"\x00" * n


# ---------------------------------------------------------------------------
# scan() — the read-only detection logic
# ---------------------------------------------------------------------------


class TestScan:
    def test_all_valid_returns_empty(self, audit_mod):
        bucket = FakeBucket(
            [
                FakeBlob("azure/sentences/aaa.mp3", content=_good_mp3()),
                FakeBlob("azure/sentences/bbb.mp3", content=_good_mp3()),
            ]
        )
        bad = audit_mod.scan(bucket, "azure/sentences", min_bytes=2000)
        assert bad == []

    def test_zero_byte_object_is_flagged(self, audit_mod):
        bucket = FakeBucket(
            [
                FakeBlob("azure/sentences/zero.mp3", content=b"", size=0),
                FakeBlob("azure/sentences/good.mp3", content=_good_mp3()),
            ]
        )
        bad = audit_mod.scan(bucket, "azure/sentences", min_bytes=2000)
        names = [b[0] for b in bad]
        assert "azure/sentences/zero.mp3" in names
        assert "azure/sentences/good.mp3" not in names
        assert len(bad) == 1

    def test_too_small_object_is_flagged(self, audit_mod):
        bucket = FakeBucket([FakeBlob("azure/sentences/tiny.mp3", content=b"ID3" + b"\x00" * 20)])
        bad = audit_mod.scan(bucket, "azure/sentences", min_bytes=2000)
        assert len(bad) == 1
        assert "small" in bad[0][1].lower()

    def test_wrong_magic_bytes_is_flagged(self, audit_mod):
        bucket = FakeBucket([FakeBlob("azure/sentences/bad.mp3", content=b"RIFF" + b"\x00" * 5000)])
        bad = audit_mod.scan(bucket, "azure/sentences", min_bytes=2000)
        assert len(bad) == 1
        assert "mp3" in bad[0][1].lower()

    def test_non_mp3_extension_is_excluded(self, audit_mod):
        """A stray manifest/metadata object under the same prefix must never
        be treated as audio, valid or not."""
        bucket = FakeBucket(
            [
                FakeBlob("azure/sentences/manifest.json", content=b"{}"),
                FakeBlob("azure/sentences/good.mp3", content=_good_mp3()),
            ]
        )
        bad = audit_mod.scan(bucket, "azure/sentences", min_bytes=2000)
        assert bad == []

    def test_unreadable_object_is_flagged_not_crashed(self, audit_mod):
        bucket = FakeBucket(
            [FakeBlob("azure/sentences/broken.mp3", content=_good_mp3(), unreadable=True)]
        )
        bad = audit_mod.scan(bucket, "azure/sentences", min_bytes=2000)
        assert len(bad) == 1
        assert "unreadable" in bad[0][1].lower()

    def test_only_scans_matching_prefix(self, audit_mod):
        """A broken object under the Gemini prefix must never surface (or be
        touched) when auditing the Azure prefix — no cross-prefix bleed."""
        bucket = FakeBucket(
            [
                FakeBlob("gemini31-prompt-only-v2/sentences/zero.mp3", content=b"", size=0),
                FakeBlob("azure/sentences/good.mp3", content=_good_mp3()),
            ]
        )
        bad = audit_mod.scan(bucket, "azure/sentences", min_bytes=2000)
        assert bad == []

    def test_returns_size_alongside_name_and_reason(self, audit_mod):
        bucket = FakeBucket([FakeBlob("azure/sentences/zero.mp3", content=b"", size=0)])
        bad = audit_mod.scan(bucket, "azure/sentences", min_bytes=2000)
        name, reason, size = bad[0]
        assert name == "azure/sentences/zero.mp3"
        assert size == 0

    def test_large_valid_object_does_not_trigger_full_download(self, audit_mod):
        """A valid object must be checked via size + a short peek only — never
        a full download_as_bytes(start=0, end=None) covering the whole file.
        This is the whole point of using metadata instead of the batch
        generator's full-payload check when scanning thousands of objects."""

        class TrackingBlob(FakeBlob):
            def download_as_bytes(self, start=0, end=None):
                assert end is not None and end < 100, "audit must peek, not fully download"
                return super().download_as_bytes(start, end)

        bucket = FakeBucket([TrackingBlob("azure/sentences/good.mp3", content=_good_mp3(n=50000))])
        bad = audit_mod.scan(bucket, "azure/sentences", min_bytes=2000)
        assert bad == []


# ---------------------------------------------------------------------------
# apply_delete() — the only place that mutates the bucket
# ---------------------------------------------------------------------------


class TestApplyDelete:
    def test_deletes_only_flagged_objects(self, audit_mod):
        good = FakeBlob("azure/sentences/good.mp3", content=_good_mp3())
        bad = FakeBlob("azure/sentences/zero.mp3", content=b"", size=0)
        bucket = FakeBucket([good, bad])
        flagged = [(bad.name, "empty object (0 bytes)", 0)]
        deleted = audit_mod.apply_delete(bucket, flagged)
        assert deleted == 1
        assert bad.deleted is True
        assert good.deleted is False

    def test_empty_flagged_list_deletes_nothing(self, audit_mod):
        good = FakeBlob("azure/sentences/good.mp3", content=_good_mp3())
        bucket = FakeBucket([good])
        deleted = audit_mod.apply_delete(bucket, [])
        assert deleted == 0
        assert good.deleted is False

    def test_delete_tolerates_already_deleted_object(self, audit_mod):
        """Two overlapping audit runs (or a re-run after a partial delete)
        must not crash on an object someone else already removed."""

        class VanishingBlob(FakeBlob):
            def delete(self):
                from google.api_core.exceptions import NotFound

                raise NotFound("already gone")

        gone = VanishingBlob("azure/sentences/zero.mp3", content=b"", size=0)
        bucket = FakeBucket([gone])
        flagged = [(gone.name, "empty object (0 bytes)", 0)]
        deleted = audit_mod.apply_delete(bucket, flagged)
        assert deleted == 0  # not counted as a fresh deletion, and no crash


# ---------------------------------------------------------------------------
# main() — CLI wiring: --dry-run default, --delete opt-in
# ---------------------------------------------------------------------------


class TestMainCliWiring:
    def _patch_client(self, audit_mod, monkeypatch, bucket):
        class FakeClient:
            def bucket(self, name):
                return bucket

        fake_storage = type("m", (), {"Client": staticmethod(FakeClient)})()
        monkeypatch.setattr(audit_mod, "storage", fake_storage)

    def test_dry_run_is_the_default_and_deletes_nothing(self, audit_mod, monkeypatch):
        bad_blob = FakeBlob("azure/sentences/zero.mp3", content=b"", size=0)
        bucket = FakeBucket([bad_blob])
        self._patch_client(audit_mod, monkeypatch, bucket)
        monkeypatch.setattr(
            "sys.argv", ["audit_tts_objects.py", "--prefix", "azure/sentences", "--min-bytes", "2000"]
        )
        audit_mod.main()
        assert bad_blob.deleted is False

    def test_delete_flag_removes_only_the_bad_objects(self, audit_mod, monkeypatch):
        bad_blob = FakeBlob("azure/sentences/zero.mp3", content=b"", size=0)
        good_blob = FakeBlob("azure/sentences/good.mp3", content=_good_mp3())
        bucket = FakeBucket([bad_blob, good_blob])
        self._patch_client(audit_mod, monkeypatch, bucket)
        monkeypatch.setattr(
            "sys.argv",
            ["audit_tts_objects.py", "--prefix", "azure/sentences", "--min-bytes", "2000", "--delete"],
        )
        audit_mod.main()
        assert bad_blob.deleted is True
        assert good_blob.deleted is False
