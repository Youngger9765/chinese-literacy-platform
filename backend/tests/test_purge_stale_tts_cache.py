"""TDD lock for backend/scripts/purge_stale_tts_cache.py (#2649 items 3 & 4a).

The script deletes objects out of the production TTS bucket, so the tests that
matter are the ones proving it deletes *only* what it flagged, and that what it
flags is derived from the live correction table rather than a copy that can
drift.

Loaded via importlib.util (same pattern as test_audit_tts_objects.py) because
it's a standalone script, not a package module. All tests run against fake
Blob/Bucket doubles — never touches real GCS.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "purge_stale_tts_cache.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("purge_stale_tts_cache_under_test", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def purge():
    return _load_module()


class FakeBlob:
    def __init__(self, name: str):
        self.name = name
        self.deleted = False

    def delete(self) -> None:
        if self.deleted:
            from google.api_core.exceptions import NotFound
            raise NotFound(self.name)
        self.deleted = True


class FakeBucket:
    def __init__(self, names):
        self._blobs = {n: FakeBlob(n) for n in names}

    def list_blobs(self, prefix: str = ""):
        return [b for n, b in self._blobs.items() if n.startswith(prefix)]

    def blob(self, name: str):
        return self._blobs.setdefault(name, FakeBlob(name))

    def live(self):
        return sorted(n for n, b in self._blobs.items() if not b.deleted)


# --- selection -------------------------------------------------------------


def test_flags_the_words_hans_reported_and_leaves_clean_sentences_alone(purge):
    """攻擊 and 嘆息 are in the table since c53c68d3; a sentence with neither
    must not be dragged in. Both halves matter — a selector that flags
    everything would 'fix' the bug by re-synthesizing the whole corpus."""
    rows = [
        {"lesson_id": 1, "paragraph_idx": 0, "sentence_idx": 0, "text": "她的攻擊很凌厲。"},
        {"lesson_id": 1, "paragraph_idx": 0, "sentence_idx": 1, "text": "他發出一聲嘆息。"},
        {"lesson_id": 2, "paragraph_idx": 0, "sentence_idx": 0, "text": "今天天氣很好。"},
    ]
    affected = purge.select_pronunciation_affected(rows)

    assert [a["text"] for a in affected] == ["她的攻擊很凌厲。", "他發出一聲嘆息。"]


def test_key_matches_the_runtime_lookup(purge):
    """A key computed any other way deletes nothing and reports success."""
    from app.services.tts.normalization import _cache_key

    rows = [{"lesson_id": 1, "paragraph_idx": 0, "sentence_idx": 0, "text": "她的攻擊很凌厲。"}]
    affected = purge.select_pronunciation_affected(rows)

    assert affected[0]["key"] == _cache_key("她的攻擊很凌厲。")


def test_polyphones_the_table_excludes_are_not_flagged(purge):
    """摸不著 and 和 were deliberately left out — 著 has five readings, 和 six,
    and correcting them blind fixes 摸不著 while breaking 顯著. If this ever
    turns red, the table grew an unsafe entry, not the purger."""
    rows = [
        {"lesson_id": 1, "paragraph_idx": 0, "sentence_idx": 0, "text": "他摸不著頭緒。"},
    ]
    assert purge.select_pronunciation_affected(rows) == []


def test_selection_follows_the_live_table_not_a_copy(purge, monkeypatch):
    """Empty the table and nothing is affected. A hardcoded word list here
    would keep flagging sentences after the table is regenerated."""
    monkeypatch.setattr(purge, "_has_phoneme_corrections", lambda text: False)

    rows = [{"lesson_id": 1, "paragraph_idx": 0, "sentence_idx": 0, "text": "她的攻擊很凌厲。"}]
    assert purge.select_pronunciation_affected(rows) == []


def test_corpus_loader_skips_blank_lines_and_empty_text(purge, tmp_path):
    path = tmp_path / "sentences.jsonl"
    path.write_text(
        json.dumps({"lesson_id": 1, "paragraph_idx": 0, "sentence_idx": 0, "text": "有字。"}, ensure_ascii=False)
        + "\n\n"
        + json.dumps({"lesson_id": 1, "paragraph_idx": 0, "sentence_idx": 1, "text": "   "}, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )

    assert [r["text"] for r in purge.load_corpus_sentences(path)] == ["有字。"]


def test_the_real_corpus_is_reachable_and_has_affected_sentences(purge):
    """Positive control against the shipped data. Without it every other test
    here passes on fixtures while the script points at a path that moved."""
    sentences = purge.load_corpus_sentences()
    affected = purge.select_pronunciation_affected(sentences)

    assert len(sentences) > 6000
    assert 0 < len(affected) < len(sentences), "table fires on none, or on everything"


# --- what exists in the bucket --------------------------------------------


def test_only_cached_sentences_are_flagged(purge):
    """A sentence with a wrong reading but no cached object needs no delete —
    it already synthesizes fresh."""
    cached = purge._cache_key("她的攻擊很凌厲。")
    uncached = purge._cache_key("他發出一聲嘆息。")
    bucket = FakeBucket([f"{purge.AZURE_PREFIX}/{cached}.mp3"])

    hits = purge.find_existing(
        bucket,
        [{"key": cached, "text": "她的攻擊很凌厲。"}, {"key": uncached, "text": "他發出一聲嘆息。"}],
        [purge.AZURE_PREFIX],
    )

    assert [h["key"] for h in hits] == [cached]
    assert hits[0]["paths"] == [f"{purge.AZURE_PREFIX}/{cached}.mp3"]


def test_dormant_prefixes_are_left_out_unless_asked_for(purge):
    """With cross-prefix read-through gone (abad95d7) only the azure copy can
    reach a student. Deleting the others by default would throw away cache for
    no listener-visible gain."""
    key = purge._cache_key("她的攻擊很凌厲。")
    bucket = FakeBucket([
        f"{purge.AZURE_PREFIX}/{key}.mp3",
        f"{purge.GEMINI_PREFIX}/{key}.mp3",
        f"{purge.GOOGLE_PREFIX}/{key}.mp3",
    ])
    cand = [{"key": key, "text": "她的攻擊很凌厲。"}]

    default_only = purge.find_existing(bucket, cand, [purge.AZURE_PREFIX])
    all_three = purge.find_existing(
        bucket, cand, [purge.AZURE_PREFIX, purge.GEMINI_PREFIX, purge.GOOGLE_PREFIX]
    )

    assert default_only[0]["paths"] == [f"{purge.AZURE_PREFIX}/{key}.mp3"]
    assert len(all_three[0]["paths"]) == 3


def test_non_mp3_objects_are_ignored(purge):
    key = purge._cache_key("她的攻擊很凌厲。")
    bucket = FakeBucket([f"{purge.AZURE_PREFIX}/{key}.txt"])

    assert purge.find_existing(bucket, [{"key": key, "text": "x"}], [purge.AZURE_PREFIX]) == []


# --- mainland orphans ------------------------------------------------------


def test_orphans_are_google_objects_with_no_azure_twin(purge):
    """The 2026-08-08 outage wrote mainland-accent audio for sentences azure
    never got. Those are the hazard."""
    bucket = FakeBucket([
        f"{purge.GOOGLE_PREFIX}/orphan.mp3",
        f"{purge.GOOGLE_PREFIX}/shared.mp3",
        f"{purge.AZURE_PREFIX}/shared.mp3",
    ])

    orphans = purge.select_mainland_orphans(bucket)

    assert [o["key"] for o in orphans] == ["orphan"]


def test_a_google_object_shadowed_by_azure_is_kept(purge):
    """azure wins the lookup, so the google copy is dormant history. Deleting
    it is not this script's call — it is not reaching anyone."""
    bucket = FakeBucket([
        f"{purge.GOOGLE_PREFIX}/shared.mp3",
        f"{purge.AZURE_PREFIX}/shared.mp3",
    ])

    assert purge.select_mainland_orphans(bucket) == []


# --- deleting --------------------------------------------------------------


def test_delete_removes_exactly_the_flagged_paths(purge):
    """The negative half is the point: an unflagged object in the same prefix
    must survive. A prefix sweep would pass a 'did it delete' test and wipe
    the bucket."""
    bucket = FakeBucket([
        f"{purge.AZURE_PREFIX}/flagged.mp3",
        f"{purge.AZURE_PREFIX}/innocent.mp3",
    ])

    deleted = purge.apply_delete(bucket, [{"paths": [f"{purge.AZURE_PREFIX}/flagged.mp3"]}])

    assert deleted == [f"{purge.AZURE_PREFIX}/flagged.mp3"]
    assert bucket.live() == [f"{purge.AZURE_PREFIX}/innocent.mp3"]


def test_already_deleted_object_is_not_an_error(purge):
    """Second run, or a concurrent partial delete."""
    bucket = FakeBucket([f"{purge.AZURE_PREFIX}/gone.mp3"])
    bucket.blob(f"{purge.AZURE_PREFIX}/gone.mp3").delete()

    deleted = purge.apply_delete(bucket, [{"paths": [f"{purge.AZURE_PREFIX}/gone.mp3"]}])

    assert deleted == []


# --- the CLI contract ------------------------------------------------------


def _run(purge, monkeypatch, bucket, argv):
    monkeypatch.setattr(purge, "get_bucket", lambda name: bucket)
    monkeypatch.setattr(
        purge, "load_corpus_sentences",
        lambda *a, **k: [{"lesson_id": 1, "paragraph_idx": 0, "sentence_idx": 0,
                          "text": "她的攻擊很凌厲。"}],
    )
    return purge.main(argv)


def test_dry_run_is_the_default(purge, monkeypatch):
    """The most important test in the file. Nothing is destroyed by a plain
    invocation — you have to ask."""
    key = purge._cache_key("她的攻擊很凌厲。")
    bucket = FakeBucket([f"{purge.AZURE_PREFIX}/{key}.mp3"])

    assert _run(purge, monkeypatch, bucket, ["--mode", "pronunciation"]) == 0
    assert bucket.live() == [f"{purge.AZURE_PREFIX}/{key}.mp3"]


def test_delete_flag_actually_deletes(purge, monkeypatch):
    key = purge._cache_key("她的攻擊很凌厲。")
    bucket = FakeBucket([f"{purge.AZURE_PREFIX}/{key}.mp3"])

    assert _run(purge, monkeypatch, bucket, ["--mode", "pronunciation", "--delete"]) == 0
    assert bucket.live() == []


def test_cli_default_purges_only_the_serving_prefix(purge, monkeypatch):
    """The unit test above proves find_existing() can be narrowed; this proves
    main() actually narrows it. Without this, widening the default to all three
    prefixes passes every other test in the file."""
    key = purge._cache_key("她的攻擊很凌厲。")
    bucket = FakeBucket([
        f"{purge.AZURE_PREFIX}/{key}.mp3",
        f"{purge.GEMINI_PREFIX}/{key}.mp3",
        f"{purge.GOOGLE_PREFIX}/{key}.mp3",
    ])

    _run(purge, monkeypatch, bucket, ["--mode", "pronunciation", "--delete"])

    assert bucket.live() == [f"{purge.GEMINI_PREFIX}/{key}.mp3", f"{purge.GOOGLE_PREFIX}/{key}.mp3"]


def test_cli_can_opt_into_the_dormant_prefixes(purge, monkeypatch):
    key = purge._cache_key("她的攻擊很凌厲。")
    bucket = FakeBucket([
        f"{purge.AZURE_PREFIX}/{key}.mp3",
        f"{purge.GEMINI_PREFIX}/{key}.mp3",
        f"{purge.GOOGLE_PREFIX}/{key}.mp3",
    ])

    _run(purge, monkeypatch, bucket,
         ["--mode", "pronunciation", "--delete", "--include-dormant-prefixes"])

    assert bucket.live() == []


def test_limit_caps_the_blast_radius(purge, monkeypatch):
    """For a small first pass — listen to a handful before committing to the
    whole set."""
    key = purge._cache_key("她的攻擊很凌厲。")
    other = "deadbeef"
    bucket = FakeBucket([
        f"{purge.AZURE_PREFIX}/{key}.mp3",
        f"{purge.AZURE_PREFIX}/{other}.mp3",
    ])
    monkeypatch.setattr(
        purge, "select_pronunciation_affected",
        lambda rows: [{"key": key, "text": "a"}, {"key": other, "text": "b"}],
    )

    _run(purge, monkeypatch, bucket, ["--mode", "pronunciation", "--delete", "--limit", "1"])

    assert bucket.live() == [f"{purge.AZURE_PREFIX}/{other}.mp3"]


def test_report_names_every_deleted_object(purge, monkeypatch, tmp_path):
    """Evidence, per the project's fail-closed rule: a run that claims success
    has to say what it removed."""
    key = purge._cache_key("她的攻擊很凌厲。")
    bucket = FakeBucket([f"{purge.AZURE_PREFIX}/{key}.mp3"])
    report = tmp_path / "report.json"

    _run(purge, monkeypatch, bucket,
         ["--mode", "pronunciation", "--delete", "--report", str(report)])

    data = json.loads(report.read_text(encoding="utf-8"))
    assert data["applied"] is True
    assert data["deleted_objects"] == [f"{purge.AZURE_PREFIX}/{key}.mp3"]
    assert data["items"][0]["text"] == "她的攻擊很凌厲。"


def test_dry_run_report_records_that_nothing_was_applied(purge, monkeypatch, tmp_path):
    key = purge._cache_key("她的攻擊很凌厲。")
    bucket = FakeBucket([f"{purge.AZURE_PREFIX}/{key}.mp3"])
    report = tmp_path / "report.json"

    _run(purge, monkeypatch, bucket, ["--mode", "pronunciation", "--report", str(report)])

    data = json.loads(report.read_text(encoding="utf-8"))
    assert data["applied"] is False
    assert data["deleted_objects"] == []
    assert data["flagged_objects"] == 1
