#!/usr/bin/env python3
"""
Generate missing Layer-2 lesson thumbnails using Vertex AI Imagen 3.

Reads /tmp/lingoleap-thumbs/missing.json (108 entries) — only generates
thumbnails for lessons that 404 on GCS. Existing 57 lesson-*.webp untouched.

Output: /tmp/lingoleap-thumbs/{grade_code}.webp at 400x300 (4:3, matches Layer-1).
Then uploads to gs://lingoleap-assets/stories/thumbnails/{grade_code}.webp

Usage:
    backend/.venv/bin/python3 scripts/generate_layer2_thumbnails.py
    backend/.venv/bin/python3 scripts/generate_layer2_thumbnails.py --upload
    backend/.venv/bin/python3 scripts/generate_layer2_thumbnails.py --dry-run
"""
from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import vertexai
from vertexai.generative_models import GenerativeModel
from vertexai.preview.vision_models import ImageGenerationModel

PROJECT = "lingoleap-dev"
LOCATION = "us-central1"
OUT_DIR = Path("/tmp/lingoleap-thumbs")
GCS_PATH = "gs://lingoleap-assets/stories/thumbnails"
MISSING_JSON = OUT_DIR / "missing.json"


def _load_lesson_content(code: str) -> str:
    """Load actual lesson paragraphs from prod yml so Gemini can ground its prompt
    in the real story (not just title/intro). Returns first 600 chars of body."""
    prod_yml = Path("/Users/young/project/chinese-literacy-platform/backend/data/lessons/_parsed_2026-05-01") / f"{code}.yml"
    if not prod_yml.exists():
        return ""
    try:
        d = yaml.safe_load(prod_yml.read_text(encoding="utf-8"))
    except Exception:
        return ""
    paras = d.get("paragraphs") or []
    if paras:
        return " ".join(paras)[:600]
    return (d.get("story_text") or "")[:600]


def gen_prompts(lessons: list[dict]) -> dict[str, str]:
    """Batch generate English image prompts via Gemini for all lessons.

    Per Young 2026-05-03: prompts MUST be grounded in actual lesson paragraphs,
    not just title/intro. Title alone produces generic/wrong prompts (e.g.
    'forest fox' for a lesson about 蝴蝶蘭 cultivation).
    """
    import yaml as _yaml  # local import for _load_lesson_content
    model = GenerativeModel("gemini-2.5-flash")
    info_lines = []
    for l in lessons:
        body = _load_lesson_content(l["code"])
        info_lines.append(
            f"{l['code']}: title=\"{l['title']}\", genre={l.get('genre','')}, body=\"{body}\""
        )
    info = "\n".join(info_lines)
    prompt = f"""For each lesson below, write ONE short English image prompt (max 25 words) for a 兒童閱讀教材 illustrated thumbnail.

CRITICAL — read the lesson BODY carefully. Your prompt must depict a SPECIFIC scene/object that ACTUALLY APPEARS in the body text. Never default to generic "child reading book" or "forest animals" — that's wrong.

Examples of body-grounded prompts:
- body about 蝴蝶蘭花期日照時數 → "Purple orchid in greenhouse with sundial and thermometer"
- body about 巴斯德煮沸鵝頸瓶 → "Swan-neck glass flask with bubbling broth on lab bench"
- body about 蜘蛛網預測天氣 → "Spider weaving large web with morning dew on leaves"

Style: digital illustration, warm bright colors, children's storybook, NO TEXT in image, NO labels, NO words.

SAFETY (Imagen blocks problematic prompts silently — be careful):
- Replace abstract sad/dark concepts with neutral OBJECTS instead (e.g. "death" → "old letter", "war" → "historical map")
- For science topics: focus on the EQUIPMENT or PROCESS, not the subject (e.g. "experiment" not "infection")
- For social topics: show OBJECTS or LANDSCAPES, not people in conflict
- NEVER mention: violence, weapons, blood, injury, fighting, real people by name

Output format — one line per lesson, exactly:
GRADE_CODE|english prompt

No numbering, no extra commentary.

{info}
"""
    resp = model.generate_content(prompt)
    out: dict[str, str] = {}
    for line in resp.text.strip().split("\n"):
        line = line.strip()
        if "|" not in line:
            continue
        code, p = line.split("|", 1)
        out[code.strip()] = p.strip()
    return out


def gen_image(model: ImageGenerationModel, prompt: str, dst: Path) -> bool:
    """Single attempt — NO fallback. Fail loudly so we know which lessons need rework.

    Per Young 2026-05-03: silent fallbacks waste money on duplicate generic
    images that don't match lesson topic. Better to fail clearly than fake-succeed.
    """
    base_prefix = (
        "Digital illustration for a children's educational reading book cover, "
        "warm bright colors, friendly cartoon style, NO text NO words. "
    )
    full = base_prefix + prompt
    try:
        resp = model.generate_images(
            prompt=full,
            number_of_images=1,
            aspect_ratio="4:3",
            safety_filter_level="block_few",
            person_generation="allow_adult",
        )
        if not resp.images:
            print(f"  FAIL_SAFETY: Imagen returned no image (content filter)", flush=True)
            return False
        tmp_png = dst.with_suffix(".png")
        resp.images[0].save(location=str(tmp_png), include_generation_parameters=False)
        return True
    except Exception as e:
        print(f"  FAIL_ERROR: {str(e)[:120]}", flush=True)
        return False


def png_to_webp_400x300(png_path: Path, webp_path: Path) -> bool:
    """Convert PNG to 400x300 webp using cwebp (matches Layer-1 dimensions)."""
    try:
        # Imagen 3 4:3 outputs 1408x1056. Resize to 400x300 + encode webp.
        # Use sips (built-in macOS) to resize, then cwebp to encode.
        resized = webp_path.with_suffix(".resized.png")
        subprocess.run(
            ["sips", "-z", "300", "400", str(png_path), "--out", str(resized)],
            check=True, capture_output=True,
        )
        subprocess.run(
            ["cwebp", "-q", "85", str(resized), "-o", str(webp_path)],
            check=True, capture_output=True,
        )
        resized.unlink(missing_ok=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"  CONVERT ERROR: {e.stderr.decode() if e.stderr else e}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--upload", action="store_true", help="Upload to GCS after generation")
    ap.add_argument("--dry-run", action="store_true", help="Print prompts only, no API calls")
    ap.add_argument("--limit", type=int, help="Cap number to process (testing)")
    ap.add_argument("--input", type=str, help="JSON file to read (default: missing.json)")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    input_file = Path(args.input) if args.input else MISSING_JSON
    if not input_file.exists():
        print(f"ERROR: {input_file} not found")
        sys.exit(1)

    missing = json.loads(input_file.read_text())
    if args.limit:
        missing = missing[: args.limit]

    # Skip already-generated locally (resume)
    todo = [m for m in missing if not (OUT_DIR / m["fname"]).exists()]
    print(f"Total missing: {len(missing)}, already generated locally: {len(missing)-len(todo)}, to generate: {len(todo)}")

    if not todo:
        print("Nothing to do.")
        if args.upload:
            print("\nUploading existing files to GCS...")
            for m in missing:
                local = OUT_DIR / m["fname"]
                if local.exists():
                    subprocess.run(["gcloud", "storage", "cp", str(local), f"{GCS_PATH}/{m['fname']}"], check=False)
        return

    print("Initializing Vertex AI...")
    vertexai.init(project=PROJECT, location=LOCATION)

    print(f"\nGenerating {len(todo)} prompts via Gemini...")
    prompts = gen_prompts(todo)
    print(f"  got {len(prompts)} prompts")

    if args.dry_run:
        for m in todo:
            p = prompts.get(m["code"], "(NO PROMPT)")
            print(f"  {m['code']:10}: {p[:100]}")
        return

    img_model = ImageGenerationModel.from_pretrained("imagen-3.0-fast-generate-001")
    failures: list[str] = []

    for i, m in enumerate(todo, 1):
        code = m["code"]
        fname = m["fname"]
        webp = OUT_DIR / fname
        if webp.exists():
            print(f"  [{i}/{len(todo)}] {code} — already exists, skip")
            continue
        prompt = prompts.get(code)
        if not prompt:
            print(f"  [{i}/{len(todo)}] {code} — NO PROMPT, skip")
            failures.append(code)
            continue

        print(f"  [{i}/{len(todo)}] {code} — \"{prompt[:50]}...\"")
        if not gen_image(img_model, prompt, webp):
            failures.append(code)
            continue
        png = webp.with_suffix(".png")
        if not png_to_webp_400x300(png, webp):
            failures.append(code)
            continue
        png.unlink(missing_ok=True)

        if args.upload:
            r = subprocess.run(
                ["gcloud", "storage", "cp", str(webp), f"{GCS_PATH}/{fname}"],
                capture_output=True,
            )
            if r.returncode == 0:
                print(f"           uploaded → {GCS_PATH}/{fname}")
            else:
                print(f"           UPLOAD ERROR: {r.stderr.decode()}")

        # Rate limit
        time.sleep(0.5)

    print()
    print(f"Done. Generated: {len(todo)-len(failures)}/{len(todo)}, failures: {len(failures)}")
    if failures:
        print(f"  Failed: {failures[:10]}{'...' if len(failures)>10 else ''}")


if __name__ == "__main__":
    main()
