#!/usr/bin/env python3
"""Pre-generate example sentences for all lesson vocabulary characters (Issue #780).

This script extracts every unique (story_title, character) pair from the 57
lesson YAML files, then either:

  --mode api   : calls the local/staging backend API to generate and cache
                 real AI sentences (default when --api-url is provided)
  --mode placeholder : writes placeholder entries with empty sentence arrays
                 so the cache file exists and downstream tooling can inspect
                 the expected structure without real AI calls

Usage examples:

  # Generate placeholders (no AI calls, no server needed):
  python scripts/pre-generate-example-sentences.py --mode placeholder

  # Warm the cache against a running local backend:
  python scripts/pre-generate-example-sentences.py \\
      --api-url http://localhost:8000 \\
      --token <JWT_TOKEN>

  # Warm the cache against staging (add --delay to respect rate limits):
  python scripts/pre-generate-example-sentences.py \\
      --api-url https://lingoleap-backend-staging-xxx.run.app \\
      --token <JWT_TOKEN> \\
      --delay 0.5

Exit codes:
  0  success
  1  partial failure (some chars failed, see --output-failures)
  2  fatal error (bad args, can't read lessons, etc.)
"""

import argparse
import glob
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml not installed. Run: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

try:
    import requests
except ImportError:
    requests = None  # type: ignore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_SCRIPT_DIR = Path(__file__).parent
_REPO_ROOT = _SCRIPT_DIR.parent
_LESSONS_DIR = _REPO_ROOT / "backend" / "data" / "lessons"
_CACHE_PATH = _REPO_ROOT / "backend" / "data" / "example_sentence_cache.json"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_cjk(ch: str) -> bool:
    return bool(re.match(r"[\u4e00-\u9fa5]", ch))


def extract_vocab_chars(lessons_dir: Path) -> list[tuple[str, str]]:
    """Return sorted list of (story_title, char) pairs from all YAML lessons.

    For each lesson we iterate over the vocabulary words and decompose each
    word into its constituent CJK characters.  Duplicate (title, char) pairs
    are deduplicated.
    """
    pairs: set[tuple[str, str]] = set()
    lesson_files = sorted(glob.glob(str(lessons_dir / "*.yml")))
    if not lesson_files:
        logger.error("No lesson YAML files found in %s", lessons_dir)
        sys.exit(2)

    for fpath in lesson_files:
        with open(fpath, encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        title = (data.get("title") or "").strip()
        if not title:
            logger.warning("Lesson %s has no title — skipping", fpath)
            continue
        vocab = data.get("vocabulary") or []
        for item in vocab:
            word = (item.get("word") or "").strip()
            for ch in word:
                if _is_cjk(ch):
                    pairs.add((title, ch))

    return sorted(pairs)


def load_cache(cache_path: Path) -> dict:
    if cache_path.exists():
        try:
            with open(cache_path, encoding="utf-8") as fh:
                return json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Could not read existing cache (%s) — starting fresh", exc)
    return {}


def save_cache(cache_path: Path, cache: dict) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False, indent=2)
    logger.info("Saved cache with %d entries to %s", len(cache), cache_path)


# ---------------------------------------------------------------------------
# Placeholder mode
# ---------------------------------------------------------------------------

def run_placeholder(pairs: list[tuple[str, str]], cache_path: Path) -> None:
    """Write placeholder entries (empty sentence arrays) without calling AI."""
    cache = load_cache(cache_path)
    written = 0
    skipped = 0
    for title, ch in pairs:
        key = f"{title}:{ch}"
        if cache.get(key, {}).get("source") == "pregenerated" and cache[key].get("sentences"):
            skipped += 1
            continue
        cache[key] = {
            "sentences": [],
            "source": "pregenerated",
            "cached_at": "",
            "_placeholder": True,
        }
        written += 1

    save_cache(cache_path, cache)
    logger.info(
        "Placeholder mode complete: wrote %d new entries, skipped %d existing",
        written,
        skipped,
    )


# ---------------------------------------------------------------------------
# API mode
# ---------------------------------------------------------------------------

def call_api(
    api_url: str,
    token: str,
    title: str,
    character: str,
    timeout: int = 30,
) -> Optional[list]:
    """Call the example-sentences endpoint and return the sentences list or None."""
    if requests is None:
        logger.error("requests library not installed — run: pip install requests")
        sys.exit(2)

    url = f"{api_url.rstrip('/')}/api/learning/sentence-practice/example-sentences"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {"character": character, "story_title": title}

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("sentences", [])
        logger.warning(
            "API returned %d for char=%s title=%s: %s",
            resp.status_code,
            character,
            title,
            resp.text[:200],
        )
        return None
    except requests.RequestException as exc:
        logger.warning("Request failed for char=%s title=%s: %s", character, title, exc)
        return None


def run_api(
    pairs: list[tuple[str, str]],
    cache_path: Path,
    api_url: str,
    token: str,
    delay: float,
    skip_existing: bool,
    output_failures: Optional[Path],
) -> int:
    """Call API for each pair, store in cache.  Returns 0 on full success, 1 on partial."""
    cache = load_cache(cache_path)
    failed: list[tuple[str, str]] = []
    success = 0
    skipped = 0

    total = len(pairs)
    for idx, (title, ch) in enumerate(pairs, 1):
        key = f"{title}:{ch}"
        existing = cache.get(key, {})
        if skip_existing and existing.get("source") == "pregenerated" and existing.get("sentences"):
            skipped += 1
            continue

        logger.info("[%d/%d] Generating: %s | %s", idx, total, title, ch)
        sentences = call_api(api_url, token, title, ch)
        if sentences is None:
            failed.append((title, ch))
        else:
            cache[key] = {
                "sentences": sentences,
                "source": "pregenerated",
                "cached_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            }
            success += 1

        if delay > 0:
            time.sleep(delay)

        # Save incrementally every 50 entries to avoid losing progress
        if idx % 50 == 0:
            save_cache(cache_path, cache)

    save_cache(cache_path, cache)

    logger.info(
        "API mode complete: success=%d, skipped=%d, failed=%d",
        success,
        skipped,
        len(failed),
    )

    if failed:
        if output_failures:
            with open(output_failures, "w", encoding="utf-8") as fh:
                json.dump([{"title": t, "char": c} for t, c in failed], fh, ensure_ascii=False, indent=2)
            logger.info("Failures written to %s", output_failures)
        else:
            for title, ch in failed:
                logger.warning("FAILED: %s | %s", title, ch)
        return 1

    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--mode",
        choices=["api", "placeholder"],
        default="placeholder",
        help="'placeholder' writes empty entries; 'api' calls the backend (default: placeholder)",
    )
    p.add_argument(
        "--lessons-dir",
        default=str(_LESSONS_DIR),
        help=f"Path to lesson YAML directory (default: {_LESSONS_DIR})",
    )
    p.add_argument(
        "--cache-path",
        default=str(_CACHE_PATH),
        help=f"Path to cache JSON file (default: {_CACHE_PATH})",
    )
    p.add_argument(
        "--api-url",
        default="http://localhost:8000",
        help="Backend base URL for API mode (default: http://localhost:8000)",
    )
    p.add_argument(
        "--token",
        default="",
        help="JWT bearer token for API authentication (required for --mode api)",
    )
    p.add_argument(
        "--delay",
        type=float,
        default=0.2,
        help="Seconds to wait between API calls to respect rate limits (default: 0.2)",
    )
    p.add_argument(
        "--no-skip-existing",
        action="store_true",
        help="Re-generate even if pre-generated entry already exists",
    )
    p.add_argument(
        "--output-failures",
        type=Path,
        default=None,
        help="Write failed (title, char) pairs as JSON to this file",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the list of (title, char) pairs without writing anything",
    )
    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    lessons_dir = Path(args.lessons_dir)
    cache_path = Path(args.cache_path)

    if not lessons_dir.exists():
        logger.error("Lessons directory not found: %s", lessons_dir)
        return 2

    pairs = extract_vocab_chars(lessons_dir)
    logger.info("Found %d unique (story_title, char) pairs across all lessons", len(pairs))

    if args.dry_run:
        for title, ch in pairs:
            print(f"{title}\t{ch}")
        return 0

    if args.mode == "placeholder":
        run_placeholder(pairs, cache_path)
        return 0

    # API mode
    if not args.token:
        logger.error(
            "--token is required for --mode api. "
            "Get a token by logging in to the app and copying the JWT from "
            "localStorage (key: 'token') or from the Authorization header in "
            "any API request."
        )
        return 2

    return run_api(
        pairs=pairs,
        cache_path=cache_path,
        api_url=args.api_url,
        token=args.token,
        delay=args.delay,
        skip_existing=not args.no_skip_existing,
        output_failures=args.output_failures,
    )


if __name__ == "__main__":
    sys.exit(main())
