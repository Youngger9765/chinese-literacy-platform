"""Batch builder for demo-reading audio MP3s + QR PNGs.

Issue #2622 Phase 1 — D1 (audio generation) and D3 (QR codes).

Public interfaces (tested in backend/tests/test_demo_reading.py):
  - plan_demo_audio(lessons) -> list[AudioPlan]
  - validate_mp3_bytes(audio) -> bool
  - build_qr_rows(plans, base_url) -> list[dict]
  - build_failure_report(lessons) -> list[dict]

CLI:
  python -m scripts.build_demo_reading --base-url https://example.com [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import io
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class AudioPlan:
    """One TTS job: a specific lesson × kind (full or passage)."""

    lesson_id: int
    kind: str  # "full" or "passage"
    text: str
    object_path: str
    grade: int | None = None


# ---------------------------------------------------------------------------
# Grade rules
# ---------------------------------------------------------------------------

_PASSAGE_ONLY_GRADES = {8, 9}
_FULL_AND_PASSAGE_GRADES = {4, 5, 6, 7}


# ---------------------------------------------------------------------------
# Public: plan_demo_audio
# ---------------------------------------------------------------------------


def plan_demo_audio(lessons: list[dict]) -> list[AudioPlan]:
    """Return a list of AudioPlan items based on grade rules.

    G4-G7: full + passage (if passage text exists).
    G8-G9: passage only.
    """
    plans: list[AudioPlan] = []

    for lesson in lessons:
        lid = lesson["id"]
        grade = lesson["grade"]
        paragraphs: list[str] = lesson.get("paragraphs") or []
        full_text = "\n".join(paragraphs)

        key_reading = lesson.get("key_reading") or {}
        passage_text: str | None = key_reading.get("passage") if key_reading else None

        if grade in _FULL_AND_PASSAGE_GRADES:
            # Always produce full
            plans.append(
                AudioPlan(
                    lesson_id=lid,
                    kind="full",
                    text=full_text,
                    object_path=f"demo-reading/{lid}/full.mp3",
                    grade=grade,
                )
            )
            # Passage only if text is present
            if passage_text:
                plans.append(
                    AudioPlan(
                        lesson_id=lid,
                        kind="passage",
                        text=passage_text,
                        object_path=f"demo-reading/{lid}/passage.mp3",
                        grade=grade,
                    )
                )
        elif grade in _PASSAGE_ONLY_GRADES:
            # Passage only
            if passage_text:
                plans.append(
                    AudioPlan(
                        lesson_id=lid,
                        kind="passage",
                        text=passage_text,
                        object_path=f"demo-reading/{lid}/passage.mp3",
                        grade=grade,
                    )
                )

    return plans


# ---------------------------------------------------------------------------
# Public: validate_mp3_bytes  (re-export of shared validator)
# ---------------------------------------------------------------------------


def validate_mp3_bytes(audio: bytes | None) -> bool:
    """Return True when the shared validator accepts the actual MP3 bytes."""
    from app.services.tts.audio_validation import validate_mp3_bytes as shared_validator

    return shared_validator(audio) is None


# ---------------------------------------------------------------------------
# Public: build_qr_rows
# ---------------------------------------------------------------------------


def build_qr_rows(plans: list[AudioPlan], base_url: str) -> list[dict]:
    """Build QR delivery metadata rows from audio plans.

    Each row contains the course id, grade, audio kind, public URL, and both
    the MP3 and QR object paths needed by the delivery team.
    """
    base_url = base_url.rstrip("/")
    rows: list[dict] = []

    for plan in plans:
        url = f"{base_url}/demo-reading/{plan.lesson_id}/{plan.kind}"
        rows.append(
            {
                "course_id": plan.lesson_id,
                "grade": plan.grade,
                "lesson_id": plan.lesson_id,
                "kind": plan.kind,
                "url": url,
                "audio_asset_path": f"demo-reading/{plan.lesson_id}/{plan.kind}.mp3",
                "qr_asset_path": f"demo-reading/{plan.lesson_id}/{plan.kind}.png",
            }
        )

    return rows


# ---------------------------------------------------------------------------
# Public: build_failure_report
# ---------------------------------------------------------------------------


def build_failure_report(lessons: list[dict]) -> list[dict]:
    """Identify lessons that CANNOT produce required audio.

    G8-G9 lessons without passage text are failures.
    G4-G7 lessons without passage are NOT failures (full is sufficient).
    """
    failures: list[dict] = []

    for lesson in lessons:
        lid = lesson["id"]
        grade = lesson["grade"]
        key_reading = lesson.get("key_reading") or {}
        passage_text: str | None = key_reading.get("passage") if key_reading else None

        if grade not in _PASSAGE_ONLY_GRADES and grade not in _FULL_AND_PASSAGE_GRADES:
            # The planner has no branch for this grade, so it produces nothing.
            # Without this entry the lesson would disappear from a run that
            # still reported success — silent truncation reads as "covered
            # everything" when it isn't.
            failures.append(
                {
                    "lesson_id": lid,
                    "grade": grade,
                    "reason": "unsupported_grade",
                    "message": f"grade {grade!r} matches no rule (expected 4-9)",
                }
            )
        elif grade in _PASSAGE_ONLY_GRADES and not passage_text:
            failures.append(
                {
                    "lesson_id": lid,
                    "grade": grade,
                    "reason": "missing_passage",
                    "message": "G8-G9 lesson has no passage",
                }
            )

    return failures


# ---------------------------------------------------------------------------
# CLI helpers (lazy imports for network/cloud/QR)
# ---------------------------------------------------------------------------


def _fetch_stories(base_api_url: str, page_size: int = 300) -> list[dict]:
    """Paginated GET /api/stories, assert count == API total."""
    import requests

    base_api_url = base_api_url.rstrip("/")
    all_stories: list[dict] = []
    page = 1
    total: int | None = None

    while True:
        resp = requests.get(
            f"{base_api_url}/api/stories",
            params={"page": page, "page_size": page_size},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if total is None:
            total = int(data["total"])

        items = data.get("items") or data.get("stories") or []
        all_stories.extend(items)

        if len(all_stories) >= total or not items:
            break
        page += 1

    assert len(all_stories) == total, (
        f"Fetched {len(all_stories)} stories but API reported total={total}"
    )
    return all_stories


def _fetch_story_detail(base_api_url: str, story_id: int) -> dict:
    """GET single story detail for paragraphs and key_reading."""
    import requests

    base_api_url = base_api_url.rstrip("/")
    resp = requests.get(f"{base_api_url}/api/stories/{story_id}", timeout=30)
    resp.raise_for_status()
    return resp.json()


def _synthesize(text: str) -> bytes:
    """Use existing app.services.tts.synthesize_speech (no provider hardcoding)."""
    from app.services.tts import synthesize_speech

    return synthesize_speech(text)


def _upload_to_gcs(object_path: str, data: bytes, content_type: str = "audio/mpeg") -> None:
    """Upload bytes to settings.gcs_bucket."""
    from google.cloud import storage  # type: ignore[import]

    from app.config import settings

    client = storage.Client()
    bucket = client.bucket(settings.gcs_bucket)
    blob = bucket.blob(object_path)
    blob.upload_from_string(data, content_type=content_type)
    logger.info("Uploaded %s (%d bytes)", object_path, len(data))


def _generate_qr_png(url: str) -> bytes:
    """Generate QR code PNG bytes for a URL. Uses pinned qrcode[pil]."""
    import qrcode  # type: ignore[import]

    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    logger.info("Wrote %s (%d rows)", path, len(rows))


# ---------------------------------------------------------------------------
# CLI main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build demo-reading audio MP3s and QR PNGs."
    )
    parser.add_argument(
        "--base-url",
        required=True,
        help="Public base URL for demo-reading pages.",
    )
    parser.add_argument(
        "--api-url",
        default=None,
        help="Backend API base URL (default: DEMO_READING_API_URL or http://localhost:8000).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("demo-reading-output"),
        help="Directory for local QR PNGs and CSV reports.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Plan only — no TTS synthesis, no GCS upload.",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=300,
        help="Page size for /api/stories pagination.",
    )

    args = parser.parse_args(argv)
    api_url = args.api_url or os.environ.get("DEMO_READING_API_URL", "http://localhost:8000")
    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    # 1. Fetch all stories
    logger.info("Fetching stories from %s ...", api_url)
    stories = _fetch_stories(api_url, page_size=args.page_size)
    logger.info("Fetched %d stories.", len(stories))

    # 2. Fetch detail for each story (paragraphs + key_reading)
    lessons: list[dict] = []
    for story in stories:
        sid = story["id"]
        detail = _fetch_story_detail(api_url, sid)
        lessons.append(
            {
                "id": sid,
                "grade": detail.get("grade", story.get("grade")),
                "grade_code": detail.get("grade_code", story.get("grade_code", "")),
                "title": detail.get("title", story.get("title", "")),
                "paragraphs": detail.get("paragraphs", []),
                "key_reading": detail.get("key_reading"),
            }
        )

    # 3. Plan
    plans = plan_demo_audio(lessons)
    logger.info("Planned %d audio items.", len(plans))

    # 4. Failure report
    failures = build_failure_report(lessons)
    failure_path = output_dir / "failures.csv"
    _write_csv(
        failure_path,
        failures,
        ["lesson_id", "grade", "reason", "message"],
    )
    if failures:
        logger.warning("%d lessons cannot produce required audio.", len(failures))

    # 5. QR rows
    qr_rows = build_qr_rows(plans, args.base_url)

    if args.dry_run:
        logger.info("[DRY RUN] Would synthesize %d items. Exiting.", len(plans))
        delivery_path = output_dir / "delivery.csv"
        _write_csv(
            delivery_path,
            qr_rows,
            [
                "course_id",
                "grade",
                "lesson_id",
                "kind",
                "url",
                "audio_asset_path",
                "qr_asset_path",
            ],
        )
        return 0

    # 6. Synthesize + validate + upload audio
    success_rows: list[dict] = []
    synth_failures: list[dict] = []

    for plan in plans:
        try:
            audio = _synthesize(plan.text)
        except Exception as exc:
            logger.error("TTS failed for %s: %s", plan.object_path, exc)
            synth_failures.append(
                {
                    "lesson_id": plan.lesson_id,
                    "kind": plan.kind,
                    "reason": "tts_error",
                    "message": str(exc),
                }
            )
            continue

        if not validate_mp3_bytes(audio):
            logger.error("Invalid MP3 for %s", plan.object_path)
            synth_failures.append(
                {
                    "lesson_id": plan.lesson_id,
                    "kind": plan.kind,
                    "reason": "invalid_mp3",
                    "message": "MP3 validation failed",
                }
            )
            continue

        # Upload MP3 to GCS
        _upload_to_gcs(plan.object_path, audio, content_type="audio/mpeg")

        # Find matching QR row
        matching = [r for r in qr_rows if r["audio_asset_path"] == plan.object_path]
        if matching:
            row = matching[0]
            # Generate and upload QR PNG
            qr_png = _generate_qr_png(row["url"])
            _upload_to_gcs(row["qr_asset_path"], qr_png, content_type="image/png")

            # Also save QR locally
            local_qr = output_dir / f"{plan.lesson_id}_{plan.kind}.png"
            local_qr.write_bytes(qr_png)

            success_rows.append(row)

    # 7. Write delivery CSV
    delivery_path = output_dir / "delivery.csv"
    _write_csv(
        delivery_path,
        success_rows,
        [
            "course_id",
            "grade",
            "lesson_id",
            "kind",
            "url",
            "audio_asset_path",
            "qr_asset_path",
        ],
    )

    # 8. Write synthesis failure CSV (append to failures)
    if synth_failures:
        synth_failure_path = output_dir / "synthesis_failures.csv"
        _write_csv(
            synth_failure_path,
            synth_failures,
            ["lesson_id", "kind", "reason", "message"],
        )

    logger.info(
        "Done: %d succeeded, %d failed, %d structural failures.",
        len(success_rows),
        len(synth_failures),
        len(failures),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
