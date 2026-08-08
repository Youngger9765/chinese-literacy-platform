"""TDD contract for the reusable QR-manifest QA (Issue #2622 / #2625 follow-up).

Why this file exists
--------------------
There are two QR generators that must never disagree:

  * backend  build_demo_reading.plan_demo_audio  — the authoritative plan of
    which audio objects get generated (and therefore which QR codes are real).
  * frontend LessonAudioTable.buildQrManifestRows — the xlsx the 教材端 prints.

They drifted once already (#2622): the frontend emitted a 段落 QR for every
lesson, while the backend only produces a passage clip when the lesson has a
念順順段. 58 of 165 lessons therefore carried a QR that plays nothing.

This QA locks the *rule* both sides must obey, against the real data sources
(the key_reading_passages.yml SOT + the generator's own grade sets), so a
future course import is validated by re-running it — no hand-checking, no
hard-coded lesson numbers.

The rule (gated on data, never on a stale assumption):
  * 全文 QR exists  iff  the batch produces a whole-text clip  (grade in
    _FULL_AND_PASSAGE_GRADES — imported, so it moves in lockstep if the policy
    changes).
  * 段落 QR exists  iff  a passage exists for the lesson  (grade_code present
    in the yml with non-empty text), which must equal the DB's has_key_reading.
"""
from __future__ import annotations

import importlib

qa = importlib.import_module("scripts.verify_qr_manifest")
gen = importlib.import_module("scripts.build_demo_reading")


def _lesson(id, grade, code, has_kr):
    return {"id": id, "grade": grade, "grade_code": code, "has_key_reading": has_kr}


class TestExpectedQr:
    def test_full_gated_on_generator_grade_set_not_a_literal(self):
        # Boundary between 7 and 8 is the whole point of #2626.
        assert qa.expected_qr(_lesson(1, 7, "G7-L01", True), {"G7-L01"})["full"] is True
        assert qa.expected_qr(_lesson(2, 8, "G8-L02", True), {"G8-L02"})["full"] is False

    def test_full_rule_tracks_the_generator_import(self):
        # Not a copied literal {4,5,6,7}: prove it reads the generator's set, so
        # if the audio policy ever produces full for grade 8 the QA follows
        # without a separate edit (and this test would then need updating —
        # which is the signal that the policy changed).
        for g in gen._FULL_AND_PASSAGE_GRADES:
            assert qa.expected_qr(_lesson(1, g, f"G{g}-L01", False), set())["full"] is True
        for g in gen._PASSAGE_ONLY_GRADES:
            assert qa.expected_qr(_lesson(1, g, f"G{g}-L01", True), {f"G{g}-L01"})["full"] is False

    def test_passage_gated_on_actual_passage_presence(self):
        assert qa.expected_qr(_lesson(1, 5, "G5-L01", True), {"G5-L01"})["passage"] is True
        # grade 5, but no passage in the yml -> no 段落 QR (the 空砲 the frontend
        # used to emit).
        assert qa.expected_qr(_lesson(2, 5, "G5-L02", False), set())["passage"] is False
        # passage-only grade with a passage still gets one.
        assert qa.expected_qr(_lesson(3, 9, "G9-L03", True), {"G9-L03"})["passage"] is True


class TestReconcile:
    def test_clean_data_is_ok_with_no_mismatches(self):
        lessons = [
            _lesson(1, 4, "G4-L01", True),
            _lesson(2, 8, "G8-L02", False),
            _lesson(3, 9, "G9-L03", True),
        ]
        yml = {"G4-L01": {"passage": "x"}, "G9-L03": {"passage": "y"}}
        r = qa.reconcile(lessons, yml)
        assert r.ok is True
        assert r.flag_mismatches == []
        assert r.plan[1] == {"full": True, "passage": True}
        assert r.plan[2] == {"full": False, "passage": False}
        assert r.plan[3] == {"full": False, "passage": True}

    def test_flag_says_passage_but_yml_has_none_is_a_mismatch(self):
        # DB claims a passage the SOT does not have -> the loader/DB drifted.
        lessons = [_lesson(1, 5, "G5-L01", True)]
        r = qa.reconcile(lessons, {})  # yml empty
        assert r.ok is False
        assert any(m["grade_code"] == "G5-L01" for m in r.flag_mismatches)

    def test_yml_has_passage_but_flag_says_no_is_a_mismatch(self):
        lessons = [_lesson(1, 5, "G5-L01", False)]
        r = qa.reconcile(lessons, {"G5-L01": {"passage": "x"}})
        assert r.ok is False
        assert any(m["grade_code"] == "G5-L01" for m in r.flag_mismatches)

    def test_empty_passage_text_in_yml_counts_as_no_passage(self):
        # A blank/whitespace passage is not a passage; a flag of True over it is
        # still a mismatch, and it must not produce a 段落 QR.
        lessons = [_lesson(1, 8, "G8-L02", False)]
        r = qa.reconcile(lessons, {"G8-L02": {"passage": "   "}})
        assert r.plan[1]["passage"] is False
        assert r.ok is True  # flag False matches "no real passage"

    def test_orphan_yml_codes_reported_but_not_fatal(self):
        # 32 such orphans exist in prod today (course codes changed / not in DB).
        # Surfaced so a change in the count is visible, but they do not fail QA.
        lessons = [_lesson(1, 4, "G4-L01", True)]
        yml = {"G4-L01": {"passage": "x"}, "G4-L99": {"passage": "orphan"}}
        r = qa.reconcile(lessons, yml)
        assert "G4-L99" in r.orphan_codes
        assert r.ok is True

    def test_lessons_with_zero_qr_are_surfaced(self):
        # A passage-only grade with no passage yields no QR at all — must be
        # visible, not silently absent (matches build_failure_report intent).
        lessons = [_lesson(1, 8, "G8-L02", False)]
        r = qa.reconcile(lessons, {})
        assert 1 in r.no_qr_lesson_ids
