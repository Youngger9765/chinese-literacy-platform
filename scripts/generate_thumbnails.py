#!/usr/bin/env python
"""
Generate lesson thumbnails using Vertex AI Imagen.

Two-step process:
1. Use Gemini to translate lesson titles into English image prompts
2. Use Imagen 3 to generate 4:3 thumbnails

Usage:
    gcloud config configurations activate lingoleap
    source backend/.venv/bin/activate
    python scripts/generate_thumbnails.py
"""

import json
import os
import time
import glob
import sys
import re

import vertexai
from vertexai.generative_models import GenerativeModel
from vertexai.preview.vision_models import ImageGenerationModel

PROJECT_ID = "lingoleap-dev"
LOCATION = "us-central1"
LESSONS_DIR = "data/parsed"
OUTPUT_DIR = "frontend/public/images/lessons"

def load_lessons() -> list[dict]:
    """Load all parsed lesson JSONs."""
    files = sorted(glob.glob(f"{LESSONS_DIR}/grade-*/*.json"))
    lessons = []
    for f in files:
        with open(f) as fh:
            lessons.append(json.load(fh))
    lessons.sort(key=lambda x: x["lesson_number"])
    return lessons


def generate_prompts(lessons: list[dict]) -> dict[int, str]:
    """Use Gemini to generate English image prompts for all lessons."""
    model = GenerativeModel("gemini-2.5-flash")

    # Build a batch request with all lesson titles + first paragraphs
    lesson_info = []
    for l in lessons:
        first_para = l["paragraphs"][0][:150] if l["paragraphs"] else ""
        lesson_info.append(
            f"Lesson {l['lesson_number']}: title=\"{l['title']}\", "
            f"genre={l['genre']}, first_paragraph=\"{first_para}\""
        )

    prompt = f"""You are generating image prompts for a children's educational reading platform (grades 4-9).

For each lesson below, generate a SHORT English image prompt (max 30 words) that:
- Captures the lesson's main theme/scene
- Is suitable for children's educational content
- Describes a vivid scene, NOT abstract concepts
- Style: digital illustration, warm colors, educational

Output format: one line per lesson, exactly:
LESSON_NUMBER|prompt text

No extra text, no numbering, no explanation.

Lessons:
{chr(10).join(lesson_info)}
"""

    response = model.generate_content(prompt)

    # Parse response — handle various formats like "1|...", "**1**|...", "L1|..."
    prompts = {}
    for line in response.text.strip().split("\n"):
        line = line.strip()
        if not line or "|" not in line:
            continue
        parts = line.split("|", 1)
        # Extract number from left side (strip markdown, "L" prefix, etc.)
        num_str = re.sub(r'[^0-9]', '', parts[0])
        try:
            num = int(num_str)
            prompts[num] = parts[1].strip()
        except (ValueError, IndexError):
            continue

    return prompts


def generate_images(prompts: dict[int, str]):
    """Generate images using Imagen 3."""
    model = ImageGenerationModel.from_pretrained("imagen-3.0-generate-002")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    total = len(prompts)
    for i, (lesson_num, prompt) in enumerate(sorted(prompts.items()), 1):
        output_path = f"{OUTPUT_DIR}/lesson-{lesson_num}.png"

        # Skip if already generated
        if os.path.exists(output_path):
            print(f"  [{i}/{total}] L{lesson_num} — already exists, skipping")
            continue

        full_prompt = (
            f"Digital illustration for children's educational book cover. "
            f"{prompt}. "
            f"Warm, inviting colors. No text or words in the image."
        )

        print(f"  [{i}/{total}] L{lesson_num} — generating...")
        try:
            response = model.generate_images(
                prompt=full_prompt,
                number_of_images=1,
                aspect_ratio="4:3",
                safety_filter_level="block_few",
                person_generation="allow_adult",
            )

            if response.images:
                response.images[0].save(location=output_path, include_generation_parameters=False)
                print(f"           saved → {output_path}")
            else:
                print(f"           WARNING: no image returned for L{lesson_num}")

        except Exception as e:
            print(f"           ERROR L{lesson_num}: {e}")

        # Rate limit: ~5 images per minute to be safe
        if i < total:
            time.sleep(3)


def main():
    print(f"Initializing Vertex AI (project={PROJECT_ID}, location={LOCATION})...")
    vertexai.init(project=PROJECT_ID, location=LOCATION)

    print("Loading lessons...")
    lessons = load_lessons()
    print(f"  Found {len(lessons)} lessons")

    print("Generating English prompts with Gemini...")
    prompts = generate_prompts(lessons)
    print(f"  Generated {len(prompts)} prompts")

    # Show prompts for review
    for num, prompt in sorted(prompts.items()):
        print(f"  L{num}: {prompt}")

    if len(prompts) < len(lessons):
        missing = set(l["lesson_number"] for l in lessons) - set(prompts.keys())
        print(f"\n  WARNING: Missing prompts for lessons: {missing}")

    print(f"\nGenerating {len(prompts)} images with Imagen 3...")
    generate_images(prompts)

    # Verify
    generated = glob.glob(f"{OUTPUT_DIR}/lesson-*.png")
    print(f"\nDone! {len(generated)} images in {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
