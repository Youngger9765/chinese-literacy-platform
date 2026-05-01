"""
Pre-generate story_structure_rows for all lessons that lack story_structure_table.

Usage:
  python scripts/pregenerate_structure_yaml.py --dry-run   # estimate, no AI calls
  python scripts/pregenerate_structure_yaml.py --confirm   # actually call Gemini

Design:
  - Layer-1 lessons: backend/data/lessons/L*.yml
  - Layer-2 lessons: backend/data/lessons/_parsed_2026-05-01/*.yml
  - Existing story_structure_table (docx-parsed or ground truth) → SKIP (never overwrite)
  - Existing story_structure_rows (already AI-generated) → SKIP unless --force
  - AI result stored as `story_structure_rows` (list of dicts, native YAML format)
  - Source flag: `story_structure_table_source: ai-generated-YYYY-MM-DD`
  - Concurrency: 5 workers (Vertex AI rate limit safe)
  - Retry: 3 attempts per lesson on transient errors
  - Fail-fast: stop if >10 failures

Note: story_structure_rows stores AI's rich format (with checkbox/options/correct_options).
      story_structure_table stores docx-parsed list-of-lists format.
      The route handler checks story_structure_rows first, then story_structure_table.
"""

import argparse
import asyncio
import json
import logging
import pathlib
import sys
import time
from datetime import date
from typing import Optional

import yaml

# Allow running from backend/ directory
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Paths
BACKEND_DIR = pathlib.Path(__file__).parent.parent
LESSONS_DIR = BACKEND_DIR / "data" / "lessons"
PARSED_DIR = LESSONS_DIR / "_parsed_2026-05-01"
SOURCE_TAG = f"ai-generated-{date.today().isoformat()}"
MAX_FAILURES = 10
CONCURRENCY = 5
MAX_RETRIES = 3


def find_all_lesson_files() -> list[pathlib.Path]:
    """Return all lesson YAML files across layer-1 and layer-2."""
    layer1 = sorted(LESSONS_DIR.glob("L*.yml"))
    layer2 = sorted(PARSED_DIR.glob("*.yml")) if PARSED_DIR.exists() else []
    return layer1 + layer2


def needs_generation(data: dict) -> bool:
    """Return True if this lesson needs AI generation."""
    # Already has docx-parsed ground truth → skip
    if data.get("story_structure_table"):
        return False
    # Already has AI-generated rows → skip (use --force to regenerate)
    if data.get("story_structure_rows"):
        return False
    return True


def get_story_text(data: dict) -> str:
    """Extract the story text from lesson data."""
    if data.get("story_text"):
        return data["story_text"]
    if data.get("full_text"):
        return data["full_text"]
    paragraphs = data.get("paragraphs", [])
    if paragraphs:
        return "\n".join(str(p) for p in paragraphs)
    return ""


def write_yaml_safely(file_path: pathlib.Path, data: dict) -> None:
    """Write YAML preserving structure; uses ruamel.yaml if available else PyYAML."""
    try:
        from ruamel.yaml import YAML

        ryaml = YAML()
        ryaml.preserve_quotes = True
        ryaml.width = 4096  # prevent line wrapping
        ryaml.default_flow_style = False

        # Read original with ruamel to preserve comments/order
        with open(file_path) as f:
            original = ryaml.load(f)

        # Update only the new fields
        original["story_structure_rows"] = data["story_structure_rows"]
        original["story_structure_table_source"] = data["story_structure_table_source"]

        with open(file_path, "w") as f:
            ryaml.dump(original, f)

    except ImportError:
        # Fallback: PyYAML (may lose comments but preserves data)
        logger.warning("ruamel.yaml not available — using PyYAML (may lose comments)")
        with open(file_path) as f:
            original = yaml.safe_load(f)

        original["story_structure_rows"] = data["story_structure_rows"]
        original["story_structure_table_source"] = data["story_structure_table_source"]

        with open(file_path, "w", encoding="utf-8") as f:
            yaml.dump(
                original,
                f,
                allow_unicode=True,
                default_flow_style=False,
                sort_keys=False,
            )


async def generate_for_lesson(
    file_path: pathlib.Path, data: dict, semaphore: asyncio.Semaphore
) -> tuple[str, bool, str, float]:
    """
    Generate story_structure_rows for one lesson.
    Returns (lesson_title, success, error_msg, latency_seconds).
    """
    from app.services.ai_generation import generate_story_structure

    title = data.get("title", file_path.stem)
    story_text = get_story_text(data)
    genre = data.get("genre")

    if not story_text:
        return title, False, "no story_text found", 0.0

    for attempt in range(1, MAX_RETRIES + 1):
        async with semaphore:
            start = time.monotonic()
            try:
                result = await generate_story_structure(
                    story_title=title,
                    story_text=story_text,
                    genre=genre,
                )
                latency = time.monotonic() - start

                rows = result.get("rows", [])
                if not rows or (
                    len(rows) == 1
                    and rows[0].get("interactive_type") == "display"
                    and "無法載入" in rows[0].get("value", "")
                ):
                    return title, False, f"AI returned error row: {rows}", latency

                # Write to YAML
                write_yaml_safely(
                    file_path,
                    {
                        "story_structure_rows": rows,
                        "story_structure_table_source": SOURCE_TAG,
                    },
                )
                return title, True, "", latency

            except Exception as e:
                latency = time.monotonic() - start
                err = str(e)
                if attempt < MAX_RETRIES:
                    wait = 2**attempt  # exponential backoff: 2s, 4s
                    logger.warning(
                        "[%s] attempt %d/%d failed (%s), retry in %ds",
                        title[:30],
                        attempt,
                        MAX_RETRIES,
                        err[:60],
                        wait,
                    )
                    await asyncio.sleep(wait)
                else:
                    return title, False, err[:120], latency


async def run_pregenerate(dry_run: bool, force: bool) -> int:
    """Main async runner. Returns exit code (0 = success)."""
    all_files = find_all_lesson_files()
    logger.info("Found %d total lesson files", len(all_files))

    # Load and filter
    to_generate: list[tuple[pathlib.Path, dict]] = []
    skip_existing = 0
    skip_no_text = 0

    for f in all_files:
        with open(f) as fh:
            data = yaml.safe_load(fh)
        if data is None:
            continue

        if not force and not needs_generation(data):
            skip_existing += 1
            continue

        story_text = get_story_text(data)
        if not story_text:
            skip_no_text += 1
            logger.warning("SKIP (no text): %s", f.name)
            continue

        to_generate.append((f, data))

    logger.info(
        "Summary: %d to generate | %d skip (already have data) | %d skip (no text)",
        len(to_generate),
        skip_existing,
        skip_no_text,
    )

    if dry_run:
        est_seconds = len(to_generate) * 5  # ~5s per lesson
        est_cost_usd = len(to_generate) * 0.003  # rough estimate
        logger.info(
            "DRY RUN — would generate %d lessons | est time: %dm%ds | est cost: ~$%.2f",
            len(to_generate),
            est_seconds // 60,
            est_seconds % 60,
            est_cost_usd,
        )
        logger.info("Lessons to generate:")
        for f, data in to_generate[:20]:
            logger.info("  %s — %s", f.name, data.get("title", "?")[:40])
        if len(to_generate) > 20:
            logger.info("  ... and %d more", len(to_generate) - 20)
        return 0

    # Actual generation
    semaphore = asyncio.Semaphore(CONCURRENCY)
    tasks = [generate_for_lesson(f, data, semaphore) for f, data in to_generate]

    success_count = 0
    failure_count = 0
    failures: list[tuple[str, str]] = []
    total_latency = 0.0

    start_all = time.monotonic()
    completed = 0

    for coro in asyncio.as_completed(tasks):
        title, ok, err, latency = await coro
        completed += 1
        total_latency += latency

        if ok:
            success_count += 1
            logger.info(
                "[%d/%d] OK  %s (%.1fs)",
                completed,
                len(tasks),
                title[:40],
                latency,
            )
        else:
            failure_count += 1
            failures.append((title, err))
            logger.error(
                "[%d/%d] FAIL %s — %s",
                completed,
                len(tasks),
                title[:40],
                err[:80],
            )
            if failure_count > MAX_FAILURES:
                logger.error(
                    "STOP: exceeded %d failures — check Vertex AI connectivity",
                    MAX_FAILURES,
                )
                break

    wall_time = time.monotonic() - start_all
    avg_latency = total_latency / max(success_count, 1)

    logger.info(
        "\n=== DONE === success: %d | fail: %d | wall: %.0fs | avg latency: %.1fs",
        success_count,
        failure_count,
        wall_time,
        avg_latency,
    )

    if failures:
        logger.error("Failed lessons (%d):", len(failures))
        for title, err in failures:
            logger.error("  %s — %s", title[:50], err[:80])

    return 0 if failure_count == 0 else 1


def audit_coverage() -> None:
    """Print coverage summary after generation."""
    all_files = find_all_lesson_files()
    has_any = 0
    has_table = 0
    has_rows = 0
    missing = 0

    for f in all_files:
        with open(f) as fh:
            data = yaml.safe_load(fh)
        if data is None:
            continue
        t = bool(data.get("story_structure_table"))
        r = bool(data.get("story_structure_rows"))
        if t or r:
            has_any += 1
            if t:
                has_table += 1
            if r:
                has_rows += 1
        else:
            missing += 1
            logger.warning("MISSING: %s — %s", f.name, data.get("title", "?")[:40])

    logger.info(
        "Coverage: %d/%d total | %d docx-parsed (table) | %d AI-generated (rows) | %d missing",
        has_any,
        len(all_files),
        has_table,
        has_rows,
        missing,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Pre-generate story_structure_rows for all lessons"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Estimate only — list lessons, show time/cost estimate, no AI calls",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Actually run AI generation and write to YAML files",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate even if story_structure_rows already exists",
    )
    parser.add_argument(
        "--audit",
        action="store_true",
        help="Print coverage audit and exit",
    )
    args = parser.parse_args()

    if args.audit:
        audit_coverage()
        return

    if not args.dry_run and not args.confirm:
        parser.print_help()
        print("\nERROR: must specify --dry-run or --confirm")
        sys.exit(1)

    gcloud_check = __import__("subprocess").run(
        ["gcloud", "config", "get-value", "project"],
        capture_output=True,
        text=True,
    )
    current_project = gcloud_check.stdout.strip()
    logger.info("gcloud active project: %s", current_project)
    if current_project != "lingoleap-dev":
        logger.warning(
            "Expected project 'lingoleap-dev', got '%s'. Run: gcloud config configurations activate lingoleap",
            current_project,
        )

    exit_code = asyncio.run(run_pregenerate(dry_run=args.dry_run, force=args.force))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
