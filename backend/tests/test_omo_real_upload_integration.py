"""Integration test for OMO upload-worksheet flow using real principal-scanned PDFs.

Tests the full service-layer identify → grade pipeline against two real worksheet
PDF samples that the school principal sent us (Sharp MX-M4050 scanner output):

  - PDF #1 (135902): 第3課「昆蟲會思考嗎？」(L24, G6-L03)
  - PDF #2 (140118): 第7課「堅持到底的棒球人生—周思齊（後篇）」(G5-L07)

Ground truth source: private/omo-real-samples/2026-05-14/test-report.md
Updated 2026-05-20: OMO identifier now matches against full 158-lesson catalog
(not just the original 7-lesson set), so PDF #2 is now expected to hit G5-L07.

Run policy — local-only, network-required, NEVER on CI:
  Run with:
      RUN_OMO_INTEGRATION=1 pytest backend/tests/test_omo_real_upload_integration.py -v

  Auto-skips when:
      1. RUN_OMO_INTEGRATION env var not set (default `pytest` and CI never run these)
      2. Sample images missing (private/ is gitignored, never on CI)
      3. Vertex AI ADC not configured (no GCP credentials)

  Calls real Gemini API — uses quota each run.
"""

import asyncio
import os
from pathlib import Path

import pytest
import yaml


# Hard gate: env var must be set explicitly to run these. Default `pytest` /
# CI runs / IDE test discovery all skip without touching network.
pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_OMO_INTEGRATION") != "1",
    reason="Set RUN_OMO_INTEGRATION=1 to run real OMO integration tests (local + network only)",
)


# Where the two principal-scanned samples live (gitignored)
SAMPLES_DIR = Path(__file__).resolve().parents[2] / "private" / "omo-real-samples" / "2026-05-14"
IMAGES_DIR = SAMPLES_DIR / "images"
LESSONS_DIR = Path(__file__).resolve().parents[1] / "data" / "lessons"


def _require_image(filename: str) -> bytes:
    """Load image bytes or skip the test if the sample isn't present locally."""
    path = IMAGES_DIR / filename
    if not path.exists():
        pytest.skip(
            f"Real sample image missing: {path} — these PDFs are gitignored, "
            "this test only runs on machines with private/omo-real-samples/ available."
        )
    return path.read_bytes()


def _require_vertex_ai() -> None:
    """Skip the test if Vertex AI credentials aren't available."""
    # ADC discovery is implicit; we just confirm a project is configured so we
    # can fail-fast with a clear skip message instead of an opaque RPC error.
    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("VERTEX_AI_PROJECT")
    if not project and not os.path.exists(os.path.expanduser("~/.config/gcloud")):
        pytest.skip("Vertex AI credentials not configured — set GOOGLE_CLOUD_PROJECT or run gcloud auth")


def _run(coro):
    """Run a coroutine in a fresh event loop, robust against pytest-asyncio absence."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


# ---------------------------------------------------------------------------
# 1. PDF #1 — identifier should hit L24「昆蟲會思考嗎？」 with high confidence
# ---------------------------------------------------------------------------

@pytest.mark.real
def test_pdf1_identifier_hits_l24():
    """Page 1 of PDF #1 contains lesson title — identifier must hit L24."""
    _require_vertex_ai()
    image_bytes = _require_image("135902-p-1.jpg")

    from app.services.omo_identifier import identify_lesson_from_image

    candidates = _run(identify_lesson_from_image(image_bytes, mime_type="image/jpeg"))

    assert candidates, (
        "REGRESSION: identifier returned 0 candidates for PDF #1 page 1 "
        "(L24「昆蟲會思考嗎？」). Ground truth: should hit with confidence ≥ 0.85."
    )

    top = candidates[0]
    # Title matching: lesson title text or contains 昆蟲
    assert "昆蟲" in top.title, (
        f"Top candidate title '{top.title}' does not contain '昆蟲' — "
        f"identifier mismatched L24. All candidates: "
        f"{[(c.title, c.confidence) for c in candidates]}"
    )
    assert top.confidence >= 0.85, (
        f"Top confidence {top.confidence:.2f} below 0.85 threshold — "
        f"regression from 5/14 ground truth (was 0.99). Reasoning: {top.reasoning}"
    )


# ---------------------------------------------------------------------------
# 2. PDF #2 — identifier should now hit G5-L07「堅持到底的棒球人生—周思齊(後篇)」
# (was fail-closed in 5/14 when OMO catalog had only 7 lessons; now 158 lessons)
# ---------------------------------------------------------------------------

@pytest.mark.real
def test_pdf2_identifier_hits_zhou_siqi():
    """Page 1 of PDF #2 contains lesson title — should hit G5-L07 with high confidence."""
    _require_vertex_ai()
    image_bytes = _require_image("140118-p-1.jpg")

    from app.services.omo_identifier import identify_lesson_from_image

    candidates = _run(identify_lesson_from_image(image_bytes, mime_type="image/jpeg"))

    assert candidates, (
        "REGRESSION: identifier returned 0 candidates for PDF #2 page 1 "
        "(周思齊 G5-L07). Catalog expansion to 158 lessons should cover this."
    )

    top = candidates[0]
    assert "周思齊" in top.title, (
        f"Top candidate title '{top.title}' does not contain '周思齊' — "
        f"identifier mismatched G5-L07. All candidates: "
        f"{[(c.title, c.confidence) for c in candidates]}"
    )
    assert top.confidence >= 0.85, (
        f"Top confidence {top.confidence:.2f} below 0.85 threshold. "
        f"Reasoning: {top.reasoning}"
    )


# ---------------------------------------------------------------------------
# 3. PDF #1 — grader must read real PDF text, not fabricate student_answer
# ---------------------------------------------------------------------------

@pytest.mark.real
def test_pdf1_grader_student_answer_not_fabricated():
    """The 5 fill_in_blank questions in L24.yml are 「四 語詞應用」section
    (lettered choices A-G). PDF #1 shows the student circled B/E/F/G/C — all
    correct. Therefore grader.student_answer MUST be one of:
      - A letter A-G (the student's circled choice), OR
      - A word from lesson vocabulary (resolved choice), OR
      - Empty string (no answer)

    Any other string proves the grader is fabricating answers without reading
    the PDF (#1614 follow-up — 'not all 1.0' is not enough; we must verify the
    answer text matches what's actually on the page).
    """
    _require_vertex_ai()

    images = []
    for page in range(1, 9):
        path = IMAGES_DIR / f"135902-p-{page}.jpg"
        if path.exists():
            images.append((path.read_bytes(), "image/jpeg"))

    if not images:
        pytest.skip("PDF #1 page images not present")

    lesson_path = LESSONS_DIR / "L24.yml"
    if not lesson_path.exists():
        pytest.skip(f"L24.yml not found at {lesson_path}")
    lesson = yaml.safe_load(lesson_path.read_text(encoding="utf-8"))
    vocab_words = {v.get("word", "") for v in lesson.get("vocabulary", [])}

    from app.services.omo_grader import grade_worksheet_images

    results = _run(grade_worksheet_images(
        image_bytes_list=[img for img, _ in images],
        mime_types=[mime for _, mime in images],
        lesson=lesson,
    ))

    fb_results = [r for r in results if r.question_id.startswith("fb_")]
    assert fb_results, "Grader returned no fill_in_blank results"

    fabricated = []
    for r in fb_results:
        sa = (r.student_answer or "").strip()
        is_letter = len(sa) == 1 and sa.upper() in "ABCDEFG"
        is_vocab = sa in vocab_words
        is_empty = sa == ""
        if not (is_letter or is_vocab or is_empty):
            fabricated.append((r.question_id, sa))

    assert not fabricated, (
        f"FABRICATION: {len(fabricated)}/{len(fb_results)} fill_in_blank answers "
        f"are not letters (A-G), not vocab words, not empty — grader invented them.\n"
        f"Vocab list: {sorted(vocab_words)}\n"
        f"Fabricated: {fabricated}\n"
        f"PDF page 18-19「四 語詞應用」shows student circled B/E/F/G/C (all correct). "
        f"#1614 'not all 1.0' fix is incomplete — grader still doesn't read PDF."
    )
