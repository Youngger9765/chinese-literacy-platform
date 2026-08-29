#!/usr/bin/env python3
"""generate_lesson_thumbnails.py — lesson cover images for the uid tree (#2683).

Two steps, same as the first edition's `generate_thumbnails.py`:
  1. Gemini turns the Chinese title + opening paragraph into a short English prompt
  2. Imagen 3 renders a 4:3 illustration

Writes to `backend/data/lessons/<uid>/<version>/assets/thumbnail.png` so the image
lives with the lesson it belongs to, rather than in a flat directory keyed by lesson
number — the numbering is what the second edition changed.

WHY IT NEEDED REWRITING RATHER THAN RERUNNING
---------------------------------------------
The original reads `data/parsed/*.yml` and writes
`frontend/public/images/lessons/<lesson_number>.png`. Both are first-edition paths:
the source directory is gone, and the destination is keyed by a number that now
means a different lesson. Pointing the old script at the new corpus would have
produced correct images filed under the wrong lessons.

The prompt step needs the lesson's opening paragraph, which is why this could not run
until the body text existed.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

PROJECT_ID = "lingoleap-dev"
LOCATION = "us-central1"
LESSONS = ROOT / "backend" / "data" / "lessons"

PROMPT_MODEL = "gemini-2.5-flash"
# Imagen is gone from this project: every 3.x and 4.x name returns 404, including
# `imagen-3.0-fast-generate-001` — the exact model that generated the May 2026 batch
# from this same project and region. Google retired the line. `gemini-2.5-flash-image`
# is what remains reachable, and it renders through generateContent rather than
# predict, so the call shape below is not the old one.
IMAGE_MODEL = "gemini-2.5-flash-image"

# Imagen 3 standard is rate-limited well below the fast tier; batching the prompt
# step and pacing the image step keeps a full run inside quota.
_PACE_SECONDS = 3.5


def _lessons(limit: int, only: list[str] | None, force: bool = False) -> list[dict]:
    from app.services.lesson_loader import get_all_lessons

    out = []
    for l in get_all_lessons():
        if only and l["lesson_uid"] not in only:
            continue
        if not l.get("paragraphs"):
            continue          # no text to describe — skip rather than invent a scene
        if not force:
            # 105 lessons already carry a cover reused from the first edition. Those
            # were drawn for the same story and reviewed; regenerating them would
            # spend quota to replace known-good art with unknown art.
            vdirs = sorted((c for c in (LESSONS / l["lesson_uid"]).iterdir()
                            if c.is_dir() and c.name.startswith("v")), key=lambda c: c.name)
            if vdirs and any((vdirs[-1] / "assets" / f"thumbnail{e}").exists()
                             for e in (".webp", ".png")):
                continue
        out.append(l)
        if limit and len(out) >= limit:
            break
    return out


def build_prompts(lessons: list[dict]) -> dict[str, str]:
    """One Gemini call for the whole batch — a call per lesson is 175 round trips."""
    import vertexai
    from vertexai.generative_models import GenerativeModel

    vertexai.init(project=PROJECT_ID, location=LOCATION)
    model = GenerativeModel(PROMPT_MODEL)

    lines = [
        f'{l["lesson_uid"]}: title="{l["title"]}", opening="{l["paragraphs"][0][:150]}"'
        for l in lessons
    ]
    ask = f"""You are generating cover-image prompts for a Chinese-language reading
platform used by students in grades 4-9 in Taiwan.

For each lesson, write ONE short English image prompt (max 30 words) that:
- depicts the lesson's central scene, concretely — a place, a person doing something,
  an object — never an abstract concept
- is appropriate for children
- avoids text, letters, numbers, and signage in the image
- style: warm digital illustration, soft light, educational picture-book feel
- the people are TAIWANESE — East Asian faces, local school uniforms and settings.
  This is a Taiwanese classroom; a generic Western cast reads as someone else's book

Output exactly one line per lesson: UID|prompt
No numbering, no commentary.

Lessons:
{chr(10).join(lines)}
"""
    text = model.generate_content(ask).text
    prompts: dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r"\**\s*(L\d{4})\s*\**\s*\|\s*(.+)", line.strip())
        if m:
            prompts[m.group(1)] = m.group(2).strip()
    return prompts


def render(uid: str, prompt: str, version_dir: Path) -> Path | None:
    from google import genai
    from google.genai import types

    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
    full = (f"{prompt} Warm digital illustration, soft light, children's picture-book "
            f"style. Taiwanese setting and East Asian characters. "
            f"4:3 landscape composition. No text, letters or numbers anywhere.")
    try:
        resp = client.models.generate_content(
            model=IMAGE_MODEL,
            contents=full,
            config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
        )
    except Exception as exc:  # noqa: BLE001 — one lesson failing must not stop the run
        print(f"       ❌ {type(exc).__name__}: {str(exc)[:88]}")
        return None

    # A blocked response is not an error and not a text part — `content.parts` comes
    # back as None, so indexing into it raised TypeError and killed the whole batch
    # 21 lessons in. Every layer here is optional.
    cand = (resp.candidates or [None])[0]
    parts = getattr(getattr(cand, "content", None), "parts", None) or []
    data = next((p.inline_data.data for p in parts if getattr(p, "inline_data", None)), None)
    if not data:
        reason = getattr(cand, "finish_reason", None)
        print(f"       ⚠️  沒有影像回傳（finish_reason={reason}），跳過")
        return None

    assets = version_dir / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    out = assets / "thumbnail.webp"

    # The model returns ~1.4 MB square PNGs. The library card renders 400×300, so
    # store that: 69 covers at native size would be 99 MB of repository for images
    # nobody sees above 400 px. Cropped rather than squashed — the model composes
    # square, and centring slightly high keeps faces out of the cut.
    import io

    from PIL import Image, ImageOps

    img = ImageOps.fit(
        Image.open(io.BytesIO(data)).convert("RGB"),
        (400, 300), Image.LANCZOS, centering=(0.5, 0.45),
    )
    img.save(out, "WEBP", quality=80, method=6)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--uid", action="append")
    ap.add_argument("--dry-run", action="store_true", help="只產 prompt，不生圖")
    ap.add_argument("--force", action="store_true", help="連已有封面的課也重生")
    a = ap.parse_args()

    lessons = _lessons(a.limit, a.uid, a.force)
    print(f"  對象: {len(lessons)} 課")
    prompts = build_prompts(lessons)
    print(f"  Gemini 產出 prompt: {len(prompts)}/{len(lessons)}\n")

    ok = 0
    for l in lessons:
        uid = l["lesson_uid"]
        p = prompts.get(uid)
        if not p:
            print(f"  ⚠️  {uid} 沒拿到 prompt")
            continue
        print(f"  {uid} {l['grade_code']:9s} 《{l['title'][:16]}》")
        print(f"       {p[:96]}")
        if a.dry_run:
            ok += 1
            continue
        vdir = sorted(
            (c for c in (LESSONS / uid).iterdir() if c.is_dir() and c.name.startswith("v")),
            key=lambda c: c.name,
        )[-1]
        out = render(uid, p, vdir)
        if out:
            ok += 1
            print(f"       ✅ {out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")
        time.sleep(_PACE_SECONDS)

    print(f"\n  完成 {ok}/{len(lessons)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
